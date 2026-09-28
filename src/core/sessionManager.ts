import * as vscode from 'vscode';
import { ChatMessage } from '../providers/modelProvider';
import { AgentMode } from '../agent/agentLoop';

const SESSIONS_STORAGE_KEY = 'localforge.workspaceSessions';
const ACTIVE_SESSION_STORAGE_KEY = 'localforge.activeSessionId';

export interface ChatSession {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  mode: AgentMode;
  model?: string;
  messages: ChatMessage[];
  filesModified: string[];
  lastContextPreview?: string;
}

export class SessionManager {
  constructor(private readonly workspaceState: vscode.Memento) {}

  public getSessions(): ChatSession[] {
    return this.workspaceState.get<ChatSession[]>(SESSIONS_STORAGE_KEY, []);
  }

  public getActiveSession(): ChatSession {
    const activeId = this.workspaceState.get<string>(ACTIVE_SESSION_STORAGE_KEY);
    const sessions = this.getSessions();
    if (activeId) {
      const found = sessions.find((s) => s.id === activeId);
      if (found) return found;
    }

    if (sessions.length > 0) {
      return sessions[0];
    }

    return this.createNewSession('New Session');
  }

  public async setActiveSession(id: string): Promise<ChatSession | undefined> {
    const sessions = this.getSessions();
    const found = sessions.find((s) => s.id === id);
    if (found) {
      await this.workspaceState.update(ACTIVE_SESSION_STORAGE_KEY, id);
      return found;
    }
    return undefined;
  }

  public createNewSession(title = 'New Session', mode: AgentMode = 'agent'): ChatSession {
    const id = `sess-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const session: ChatSession = {
      id,
      title,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      mode,
      messages: [],
      filesModified: []
    };

    const sessions = [session, ...this.getSessions().slice(0, 49)];
    void this.workspaceState.update(SESSIONS_STORAGE_KEY, sessions);
    void this.workspaceState.update(ACTIVE_SESSION_STORAGE_KEY, id);
    return session;
  }

  public async saveSession(session: ChatSession): Promise<void> {
    session.updatedAt = Date.now();
    const sessions = this.getSessions();
    const index = sessions.findIndex((s) => s.id === session.id);
    if (index >= 0) {
      sessions[index] = session;
    } else {
      sessions.unshift(session);
    }
    await this.workspaceState.update(SESSIONS_STORAGE_KEY, sessions);
  }

  public async deleteSession(id: string): Promise<void> {
    const sessions = this.getSessions().filter((s) => s.id !== id);
    await this.workspaceState.update(SESSIONS_STORAGE_KEY, sessions);
    const activeId = this.workspaceState.get<string>(ACTIVE_SESSION_STORAGE_KEY);
    if (activeId === id) {
      const nextActive = sessions[0]?.id;
      await this.workspaceState.update(ACTIVE_SESSION_STORAGE_KEY, nextActive);
    }
  }

  public async clearAllSessions(): Promise<void> {
    await this.workspaceState.update(SESSIONS_STORAGE_KEY, []);
    await this.workspaceState.update(ACTIVE_SESSION_STORAGE_KEY, undefined);
  }
}
