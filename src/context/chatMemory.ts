import type { ChatSession, ConversationStore, SessionMessage } from '../core/conversationStore';

export type ChatMemoryScope = 'current' | 'all';

export interface ChatMemoryOptions {
  enabled: boolean;
  scope: ChatMemoryScope;
  recentCharacters: number;
  memoryCharacters: number;
  resultCount: number;
}

export interface ChatMemoryMatch {
  chatId: string;
  messageId: string;
  turnId?: string;
  historyEpoch?: string;
  role: 'user' | 'assistant';
  timestamp: number;
  startCharacter: number;
  endCharacter: number;
  text: string;
  score: number;
  matchedTerms: string[];
}

interface MemoryDocument extends Omit<ChatMemoryMatch, 'score' | 'matchedTerms'> {
  terms: Map<string, number>;
  length: number;
}

const STOP_WORDS = new Set(['the', 'a', 'an', 'is', 'was', 'were', 'be', 'to', 'of', 'and', 'or', 'in', 'on', 'it', 'i', 'you', 'me', 'my', 'we', 'our', 'what', 'which', 'that', 'this', 'earlier', 'gave', 'please']);

export function sanitizeContext(text: string): string {
  return text
    .replace(/-----BEGIN [^-\r\n]*PRIVATE KEY-----[\s\S]*?(?:-----END [^-\r\n]*PRIVATE KEY-----|$)/g, '[REDACTED PRIVATE KEY]')
    .replace(/(\b(?:authorization|proxy-authorization)\s*:\s*)(?:Bearer|Basic)\s+[^\s"'`,;]+/gi, '$1[REDACTED]')
    .replace(/(["']?\b(?:[\w.-]*(?:api[_-]?key|access[_-]?token|auth[_-]?token|password|passwd|secret|credential)[\w.-]*)["']?\s*[:=]\s*)(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s,;\r\n}]+)/gi, '$1[REDACTED]')
    .replace(/\b(?:sk-[a-zA-Z0-9_-]{16,}|gh[pousr]_[a-zA-Z0-9]{20,}|AKIA[A-Z0-9]{16}|eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+)\b/g, '[REDACTED TOKEN]')
    .replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/gi, '$1[REDACTED]@');
}

export function readChatMemoryOptions(get: <Value>(key: string, fallback: Value) => Value): ChatMemoryOptions {
  const bounded = (key: string, fallback: number, minimum: number, maximum: number) => {
    const value = get(key, fallback);
    return Number.isInteger(value) ? Math.min(maximum, Math.max(minimum, value)) : fallback;
  };
  return {
    enabled: get('enabled', true) === true,
    scope: get<string>('scope', 'current') === 'all' ? 'all' : 'current',
    recentCharacters: bounded('recentCharacters', 6000, 0, 32000),
    memoryCharacters: bounded('retrievedCharacters', 3000, 0, 16000),
    resultCount: bounded('resultCount', 4, 1, 20)
  };
}

function termsFor(text: string): string[] {
  return (text.toLowerCase().match(/[\p{L}\p{N}_-]+/gu) ?? []).filter((term) => !STOP_WORDS.has(term) && term !== 'redacted');
}

function memorySourceValidator(sessions: ChatSession[]): (message: SessionMessage) => boolean {
  const chats = new Map(sessions.map((session) => [session.id, { epoch: session.historyEpoch, messages: new Map(session.messages.map((message) => [message.id, message])) }]));
  const verified = new Map<string, boolean>();
  const valid = (message: SessionMessage, ancestors: Set<string>): boolean => (message.memorySources ?? []).every((source) => {
    const key = JSON.stringify([source.chatId, source.messageId]);
    const chat = chats.get(source.chatId);
    const original = chat?.messages.get(source.messageId);
    if (!original || chat?.epoch !== source.historyEpoch || ancestors.has(key) || ancestors.size >= 200) return false;
    if (verified.has(key)) return verified.get(key)!;
    const next = new Set(ancestors);
    next.add(key);
    const available = valid(original, next);
    verified.set(key, available);
    return available;
  });
  return (message) => valid(message, new Set());
}

export function recentChatMessages(session: ChatSession, maximumCharacters: number, availableSessions: ChatSession[] = [session]): SessionMessage[] {
  const selected: SessionMessage[] = [];
  const sourcesAvailable = memorySourceValidator(availableSessions);
  let remaining = maximumCharacters;
  for (const message of session.messages.slice(-10).reverse()) {
    if (!['user', 'assistant'].includes(message.role) || message.tool_calls?.length || !sourcesAvailable(message)) continue;
    const content = sanitizeContext(message.content);
    if (content.length > remaining) continue;
    remaining -= content.length;
    selected.unshift({ ...message, content });
  }
  return selected;
}

export class ChatMemoryIndex {
  constructor(private readonly store: ConversationStore) {}

  public getSessions(): ChatSession[] { return this.store.getSessions(); }

  public async search(query: string, chatId: string, options: { scope?: ChatMemoryScope; excludeMessageIds?: ReadonlySet<string>; limit?: number; maximumCharacters?: number; signal?: AbortSignal } = {}): Promise<ChatMemoryMatch[]> {
    await this.store.flush();
    options.signal?.throwIfAborted();
    const queryTerms = [...new Set(termsFor(sanitizeContext(query)))].slice(0, 64);
    if (!queryTerms.length) return [];
    const availableSessions = this.store.getSessions();
    const sessions = availableSessions.filter((session) => options.scope === 'all' || session.id === chatId);
    const sourcesAvailable = memorySourceValidator(availableSessions);
    const documents: MemoryDocument[] = [];
    let processed = 0;
    for (const session of sessions) {
      for (const message of session.messages) {
        if (++processed % 100 === 0) { await new Promise<void>((resolve) => setImmediate(resolve)); options.signal?.throwIfAborted(); }
        if (!['user', 'assistant'].includes(message.role) || message.tool_calls?.length || options.excludeMessageIds?.has(message.id) || !sourcesAvailable(message)) continue;
        if (message.content.length > 8000 || message.content.includes('\0')) continue;
        const text = sanitizeContext(message.content);
        for (let offset = 0; offset < text.length;) {
          let end = Math.min(text.length, offset + 1000);
          const boundary = text.slice(offset, end).search(/\s+\S*$/);
          if (end < text.length && boundary > 600) end = offset + boundary;
          const chunk = text.slice(offset, end);
          const words = termsFor(chunk);
          if (!words.length) { offset = end; continue; }
          const terms = new Map<string, number>();
          for (const word of words) terms.set(word, (terms.get(word) ?? 0) + 1);
          documents.push({ chatId: session.id, historyEpoch: session.historyEpoch, messageId: message.id, turnId: message.turnId, role: message.role as 'user' | 'assistant', timestamp: message.timestamp, startCharacter: offset, endCharacter: end, text: chunk, terms, length: words.length });
          offset = end;
        }
      }
    }
    const frequencies = new Map(queryTerms.map((term) => [term, documents.filter((document) => document.terms.has(term)).length]));
    const averageLength = documents.reduce((total, document) => total + document.length, 0) / Math.max(1, documents.length);
    const ranked = documents.map(({ terms, length, ...document }) => {
      const matchedTerms = queryTerms.filter((term) => terms.has(term));
      const score = matchedTerms.reduce((total, term) => {
        const frequency = terms.get(term)!;
        const inverseFrequency = Math.log(1 + (documents.length - frequencies.get(term)! + 0.5) / (frequencies.get(term)! + 0.5));
        return total + inverseFrequency * frequency * 2.2 / (frequency + 1.2 * (0.25 + 0.75 * length / Math.max(1, averageLength)));
      }, 0);
      return { ...document, matchedTerms, score };
    }).filter((match) => match.score > 0).sort((first, second) => second.score - first.score || second.timestamp - first.timestamp || first.messageId.localeCompare(second.messageId));
    await this.store.flush();
    options.signal?.throwIfAborted();
    const current = new Map(this.store.getSessions().map((session) => [session.id, session]));
    const currentSourcesAvailable = memorySourceValidator([...current.values()]);
    const original = new Map(sessions.map((session) => [session.id, session]));
    const selected: ChatMemoryMatch[] = [];
    const used = new Set<string>();
    const usedText = new Set<string>();
    let remaining = Math.min(16000, Math.max(0, options.maximumCharacters ?? 3000));
    const limit = Math.min(20, Math.max(1, options.limit ?? 4));
    for (const match of ranked) {
      if (selected.length >= limit || remaining <= 0) break;
      const session = current.get(match.chatId);
      const message = session?.messages.find((entry) => entry.id === match.messageId);
      if (!session || !message || !currentSourcesAvailable(message) || session.revision !== original.get(match.chatId)?.revision || used.has(match.messageId)) continue;
      const hit = queryTerms.map((term) => match.text.toLowerCase().indexOf(term)).filter((offset) => offset >= 0).sort((first, second) => first - second)[0] ?? 0;
      const offset = match.text.length > remaining ? Math.max(0, hit - Math.min(40, Math.floor(remaining / 4))) : 0;
      const text = match.text.slice(offset, offset + remaining);
      if (!queryTerms.some((term) => termsFor(text).includes(term))) continue;
      if (usedText.has(text.trim())) continue;
      selected.push({ ...match, text, startCharacter: match.startCharacter + offset, endCharacter: match.startCharacter + offset + text.length });
      remaining -= text.length;
      used.add(match.messageId);
      usedText.add(text.trim());
    }
    return selected;
  }
}
