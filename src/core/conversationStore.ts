import type * as vscode from 'vscode';
import { AgentEffort, isAgentEffort } from '../agent/effort';
import { randomUUID, createHash } from 'node:crypto';
import { mkdir, readFile, rename, stat, open } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import type { ChatMessage } from '../providers/modelProvider';
import type { AgentMode, ExecutionStrategy } from '../agent/agentLoop';

const STORE_KEY = 'localforge.conversationStore.v2';
const MAX_STORE_BYTES = 16 * 1024 * 1024;

export interface SessionMessage extends ChatMessage {
  id: string;
  timestamp: number;
  model?: string;
  providerId?: string;
  turnId?: string;
  memorySources?: ChatMemorySource[];
}

export interface ChatMemorySource {
  chatId: string;
  messageId: string;
  historyEpoch?: string;
}

export interface ChatSession {
  schemaVersion: 2;
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  revision: number;
  mode: AgentMode;
  strategy: ExecutionStrategy;
  effort?: AgentEffort;
  model?: string;
  messages: SessionMessage[];
  filesModified: string[];
  artifactIds: string[];
  lastContextPreview?: string;
  historyEpoch?: string;
}

interface ConversationState {
  schemaVersion: 2;
  activeSessionId: string;
  legacyMigrated: true;
  sessions: ChatSession[];
}

type SessionConfiguration = Partial<Pick<ChatSession, 'mode' | 'strategy' | 'effort' | 'model' | 'filesModified' | 'artifactIds' | 'lastContextPreview'>>;

export class ConversationStore {
  private state: ConversationState;
  private queue: Promise<void> = Promise.resolve();
  private initialization?: Promise<void>;
  private readonly filename?: string;

  constructor(private readonly workspaceState: vscode.Memento, storageDirectory?: string) {
    this.filename = storageDirectory ? join(storageDirectory, 'conversations.v2.json') : undefined;
    const session = this.emptySession();
    this.state = { schemaVersion: 2, legacyMigrated: true, activeSessionId: session.id, sessions: [session] };
    if (!this.filename) {
      const saved = workspaceState.get<unknown>(STORE_KEY);
      this.state = saved ? this.validateState(saved) : this.migrateLegacy();
    }
  }

  public initialize(): Promise<void> {
    if (!this.initialization) this.initialization = this.load().catch((error) => { this.initialization = undefined; throw error; });
    return this.initialization;
  }

  private async load(): Promise<void> {
    if (this.filename) {
      try {
        const fileStat = await stat(this.filename);
        if (fileStat.size > MAX_STORE_BYTES) throw new Error('Conversation storage exceeds its 16 MiB limit.');
        this.state = this.validateState(JSON.parse(await readFile(this.filename, 'utf8')));
        return;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error(`Unable to load conversation history; it was preserved for recovery: ${error instanceof Error ? error.message : error}`);
      }
    }
    if (this.filename) this.state = this.migrateLegacy();
    await this.persist(this.state);
  }

  public getSessions(): ChatSession[] { return structuredClone(this.state.sessions); }

  public getActiveSession(): ChatSession {
    const active = this.state.sessions.find((session) => session.id === this.state.activeSessionId);
    if (!active) throw new Error('The active conversation is unavailable.');
    return structuredClone(active);
  }

  public async setActiveSession(id: string): Promise<ChatSession | undefined> {
    return this.mutate((state) => {
      const session = state.sessions.find((session) => session.id === id);
      if (!session) return undefined;
      state.activeSessionId = id;
      return session;
    });
  }

  public async createNewSession(title = 'New Session', mode: AgentMode = 'agent'): Promise<ChatSession> {
    return this.mutate((state) => {
      if (state.sessions.length >= 250) throw new Error('Conversation limit reached. Delete an unneeded chat before creating another.');
      const session = this.emptySession(title, mode);
      state.sessions.unshift(session);
      state.activeSessionId = session.id;
      return session;
    });
  }

  public async saveSession(session: ChatSession): Promise<void> {
    await this.mutate((state) => {
      const current = this.findSession(state, session.id);
      if (current.revision !== session.revision) throw new Error('This conversation changed. Reload it before saving stale state.');
      const replacement = this.normalizeSession({ ...session, revision: current.revision + 1, updatedAt: Date.now() });
      state.sessions[state.sessions.indexOf(current)] = replacement;
    });
  }

  public async updateSession(id: string, configuration: SessionConfiguration): Promise<ChatSession> {
    return this.mutate((state) => {
      const session = this.findSession(state, id);
      Object.assign(session, configuration, { revision: session.revision + 1, updatedAt: Date.now() });
      return session;
    });
  }

  public async appendMessages(id: string, messages: Array<ChatMessage & Partial<Omit<SessionMessage, keyof ChatMessage>>>, configuration: SessionConfiguration = {}, expectedHistory?: { epoch?: string }): Promise<ChatSession> {
    return this.mutate((state) => {
      const session = this.findSession(state, id);
      if (expectedHistory && session.historyEpoch !== expectedHistory.epoch) throw new Error('This chat was cleared while the response was running. Its old messages will not be restored.');
      if (session.messages.length + messages.length > 10000) throw new Error('Conversation message limit reached. Create a new chat to continue.');
      const added = messages.map((message) => this.normalizeMessage(message));
      session.messages.push(...added);
      if (session.title === 'New Session') {
        const firstUser = added.find((message) => message.role === 'user' && message.content.trim());
        if (firstUser) session.title = firstUser.content.trim().replace(/\s+/g, ' ').slice(0, 80);
      }
      const filesModified = [...new Set([...session.filesModified, ...(configuration.filesModified ?? [])])];
      Object.assign(session, configuration, { filesModified, revision: session.revision + 1, updatedAt: Date.now() });
      return session;
    });
  }

  public async renameSession(id: string, title: string): Promise<ChatSession> {
    return this.mutate((state) => {
      const session = this.findSession(state, id);
      session.title = this.validateTitle(title);
      session.revision += 1;
      session.updatedAt = Date.now();
      return session;
    });
  }

  public async clearSession(id: string): Promise<void> {
    await this.mutate((state) => {
      const session = this.findSession(state, id);
      session.messages = [];
      session.artifactIds = [];
      session.lastContextPreview = undefined;
      session.historyEpoch = randomUUID();
      session.revision += 1;
      session.updatedAt = Date.now();
    });
  }

  public async deleteSession(id: string): Promise<void> {
    await this.mutate((state) => {
      if (!state.sessions.some((session) => session.id === id)) return;
      state.sessions = state.sessions.filter((session) => session.id !== id);
      if (!state.sessions.length) state.sessions.push(this.emptySession());
      if (state.activeSessionId === id) state.activeSessionId = state.sessions[0].id;
    });
  }

  public async clearAllSessions(): Promise<void> {
    await this.mutate((state) => {
      const session = this.emptySession();
      state.sessions = [session];
      state.activeSessionId = session.id;
    });
  }

  public async flush(): Promise<void> { await this.initialize(); await this.queue; }

  private mutate<Result>(operation: (state: ConversationState) => Result): Promise<Result> {
    const transaction = this.queue.then(async () => {
      await this.initialize();
      const next = structuredClone(this.state);
      const result = operation(next);
      const validated = this.validateState(next);
      await this.persist(validated);
      this.state = validated;
      return structuredClone(result);
    });
    this.queue = transaction.then(() => undefined, () => undefined);
    return transaction;
  }

  private async persist(state: ConversationState): Promise<void> {
    const serialized = JSON.stringify(state);
    if (Buffer.byteLength(serialized) > MAX_STORE_BYTES) throw new Error('Conversation storage is full (16 MiB). Delete an unneeded chat; existing history was preserved.');
    if (!this.filename) {
      await this.workspaceState.update(STORE_KEY, structuredClone(state));
      return;
    }
    await mkdir(dirname(this.filename), { recursive: true });
    const temporary = `${this.filename}.${randomUUID()}.tmp`;
    const handle = await open(temporary, 'wx', 0o600);
    try { await handle.writeFile(serialized, 'utf8'); await handle.sync(); } finally { await handle.close(); }
    await rename(temporary, this.filename);
  }

  private migrateLegacy(): ConversationState {
    const legacy = this.workspaceState.get<unknown>('localforge.workspaceSessions', []);
    const sessions = Array.isArray(legacy) ? legacy.map((session) => this.normalizeSession(session)) : [];
    const oldUi = this.workspaceState.get<Record<string, unknown>>('localforge.conversations', {});
    for (const [model, history] of Object.entries(oldUi ?? {})) {
      if (!Array.isArray(history) || !history.length) continue;
      const messages = history.map((message) => this.normalizeMessage(message));
      const duplicate = sessions.some((session) => session.model === model && JSON.stringify(session.messages.slice(-messages.length).map(({ role, content }) => ({ role, content }))) === JSON.stringify(messages.map(({ role, content }) => ({ role, content }))));
      if (duplicate) continue;
      const session = this.emptySession(`Imported chat · ${model}`.slice(0, 120));
      session.id = `legacy-${createHash('sha256').update(model).digest('hex').slice(0, 24)}`;
      session.model = model;
      session.messages = messages;
      sessions.push(session);
    }
    if (!sessions.length) sessions.push(this.state.sessions[0]);
    const previousActive = this.workspaceState.get<string>('localforge.activeSessionId');
    return this.validateState({ schemaVersion: 2, legacyMigrated: true, activeSessionId: sessions.some((session) => session.id === previousActive) ? previousActive : sessions[0].id, sessions });
  }

  private emptySession(title = 'New Session', mode: AgentMode = 'agent'): ChatSession {
    return { schemaVersion: 2, id: `sess-${randomUUID()}`, title: this.validateTitle(title), mode, strategy: 'planning', revision: 0, messages: [], filesModified: [], artifactIds: [], createdAt: Date.now(), updatedAt: Date.now() };
  }

  private normalizeMessage(value: unknown): SessionMessage {
    if (!value || typeof value !== 'object') throw new Error('Invalid conversation message.');
    const message = value as SessionMessage;
    if (!['user', 'assistant', 'system', 'tool'].includes(message.role) || typeof message.content !== 'string') throw new Error('Invalid conversation message content or role.');
    if (message.memorySources !== undefined && (!Array.isArray(message.memorySources) || message.memorySources.length > 200 || message.memorySources.some((source) => !source || typeof source.chatId !== 'string' || !source.chatId || source.chatId.length > 200 || typeof source.messageId !== 'string' || !source.messageId || source.messageId.length > 200 || (source.historyEpoch !== undefined && (typeof source.historyEpoch !== 'string' || source.historyEpoch.length > 120))))) throw new Error('Invalid chat memory source provenance.');
    return { ...message, id: typeof message.id === 'string' && message.id ? message.id : randomUUID(), timestamp: Number.isFinite(message.timestamp) ? message.timestamp : Date.now() };
  }

  private normalizeSession(value: unknown): ChatSession {
    if (!value || typeof value !== 'object') throw new Error('Invalid stored conversation.');
    const session = value as ChatSession;
    if (typeof session.id !== 'string' || !session.id || !Array.isArray(session.messages) || !['ask', 'plan', 'agent'].includes(session.mode)) throw new Error('Invalid conversation identity, messages or mode.');
    if (session.messages.length > 10000) throw new Error('Stored conversation exceeds its message limit.');
    if (session.strategy && !['fast', 'planning'].includes(session.strategy)) throw new Error('Invalid conversation strategy.');
    if (session.effort !== undefined && !isAgentEffort(session.effort)) throw new Error('Invalid conversation effort.');
    if (session.model !== undefined && typeof session.model !== 'string') throw new Error('Invalid conversation model.');
    if (session.historyEpoch !== undefined && (typeof session.historyEpoch !== 'string' || !session.historyEpoch || session.historyEpoch.length > 120)) throw new Error('Invalid conversation history epoch.');
    const messages = session.messages.map((message) => this.normalizeMessage(message));
    if (new Set(messages.map((message) => message.id)).size !== messages.length) throw new Error('Duplicate conversation message IDs.');
    return { ...session, schemaVersion: 2, title: this.validateTitle(session.title), createdAt: Number.isFinite(session.createdAt) ? session.createdAt : Date.now(), updatedAt: Number.isFinite(session.updatedAt) ? session.updatedAt : Date.now(), revision: Number.isInteger(session.revision) ? session.revision : 0, strategy: session.strategy ?? 'planning', messages, filesModified: Array.isArray(session.filesModified) ? session.filesModified.filter((filename) => typeof filename === 'string') : [], artifactIds: Array.isArray(session.artifactIds) ? session.artifactIds.filter((id) => typeof id === 'string') : [] };
  }

  private validateState(value: unknown): ConversationState {
    const state = value as ConversationState;
    if (!state || state.schemaVersion !== 2 || state.legacyMigrated !== true || !Array.isArray(state.sessions) || !state.sessions.length || state.sessions.length > 250) throw new Error('Invalid conversation store schema.');
    const sessions = state.sessions.map((session) => this.normalizeSession(session));
    if (new Set(sessions.map((session) => session.id)).size !== sessions.length || !sessions.some((session) => session.id === state.activeSessionId)) throw new Error('Invalid or duplicate active conversation identity.');
    return { schemaVersion: 2, legacyMigrated: true, activeSessionId: state.activeSessionId, sessions };
  }

  private validateTitle(title: string): string {
    if (typeof title !== 'string' || !title.trim() || title.length > 120 || /[\u0000-\u001f]/.test(title)) throw new Error('Chat title must contain 1–120 characters without control characters.');
    return title.trim();
  }

  private findSession(state: ConversationState, id: string): ChatSession {
    const session = state.sessions.find((session) => session.id === id);
    if (!session) throw new Error('This conversation was deleted or is unavailable.');
    return session;
  }
}
