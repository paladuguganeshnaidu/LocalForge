import { createHash } from 'node:crypto';

export interface IndexedDocument {
  uri: string;
  path: string;
  content: string;
  lines: string[];
  hash?: string;
  mtime?: number;
  language?: string;
  chunks?: IndexedChunk[];
}
export interface IndexedChunk {
  id: string;
  uri: string;
  path: string;
  startLine: number;
  endLine: number;
  text: string;
  fileHash: string;
  mtime?: number;
  language?: string;
}
export interface SearchMatch extends IndexedChunk { chunkId: string; score: number; truncated: boolean }
export interface RetrievalOptions { maxFiles?: number; maxChars?: number; maxExcerptCharacters?: number; activeFileUri?: string }
export interface RetrievalEngine { retrieve(query: string, documents: IndexedDocument[], options?: RetrievalOptions): Promise<SearchMatch[]> }

export function createDocumentChunks(document: IndexedDocument): IndexedChunk[] {
  const chunks: IndexedChunk[] = [];
  const fileHash = document.hash ?? createHash('sha256').update(document.content).digest('hex');
  let text = '';
  let startLine = 1;
  let endLine = 1;
  const flush = () => {
    if (text.trim()) chunks.push({ id: createHash('sha256').update([document.uri, fileHash, startLine, endLine, chunks.length].join(':')).digest('hex'), uri: document.uri, path: document.path.replace(/\\/g, '/'), startLine, endLine, text, fileHash, mtime: document.mtime, language: document.language });
    text = '';
  };
  for (const [position, line] of document.lines.entries()) {
    for (let offset = 0; offset < Math.max(1, line.length); offset += 4000) {
      const part = line.slice(offset, offset + 4000);
      if (text && (text.length + part.length + 1 > 4000 || position + 1 - startLine >= 40)) flush();
      if (!text) startLine = position + 1;
      text += (text ? '\n' : '') + part;
      endLine = position + 1;
      if (offset + 4000 < line.length) flush();
    }
  }
  flush();
  return chunks;
}

function termsFor(text: string): string[] { return text.toLowerCase().match(/[\p{L}\p{N}_][\p{L}\p{N}_.-]*/gu) ?? []; }
export class LexicalRetrievalEngine implements RetrievalEngine {
  async retrieve(query: string, documents: IndexedDocument[], options: RetrievalOptions = {}): Promise<SearchMatch[]> {
    const bounded = (value: number | undefined, fallback: number, maximum: number) => typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(maximum, Math.floor(value))) : fallback;
    const maxFiles = bounded(options.maxFiles, 6, 20);
    let budget = bounded(options.maxChars, 12000, 64000);
    const excerptLimit = bounded(options.maxExcerptCharacters, 4000, 4000);
    const terms = [...new Set(termsFor(query).filter((term) => term.length >= 2))].slice(0, 64);
    if (!terms.length || !maxFiles || !budget) return [];
    const chunks = documents.flatMap((document) => document.chunks ?? createDocumentChunks(document));
    const counts: Map<string, number>[] = [];
    for (const [position, chunk] of chunks.entries()) {
      if (position % 100 === 0) await new Promise<void>((resolve) => setImmediate(resolve));
      const frequencies = new Map<string, number>();
      for (const term of termsFor(chunk.text)) if (terms.includes(term)) frequencies.set(term, (frequencies.get(term) ?? 0) + 1);
      counts.push(frequencies);
    }
    const averageLength = chunks.reduce((total, chunk) => total + chunk.text.length, 0) / Math.max(1, chunks.length);
    const documentFrequency = new Map(terms.map((term) => [term, counts.filter((count) => count.has(term)).length]));
    const bestByFile = new Map<string, { chunk: IndexedChunk; score: number }>();
    for (const [position, chunk] of chunks.entries()) {
      if (position % 100 === 0) await new Promise<void>((resolve) => setImmediate(resolve));
      let score = 0;
      const pathTerms = termsFor(chunk.path.replace(/\//g, ' '));
      for (const term of terms) {
        const frequency = counts[position].get(term) ?? 0;
        if (frequency) score += Math.log(1 + (chunks.length - documentFrequency.get(term)! + 0.5) / (documentFrequency.get(term)! + 0.5)) * frequency * 2.2 / (frequency + 1.2 * (0.25 + 0.75 * chunk.text.length / Math.max(1, averageLength)));
        if (pathTerms.includes(term)) score += 2;
      }
      if (!score) continue;
      if (chunk.uri === options.activeFileUri) score += 0.2;
      const previous = bestByFile.get(chunk.uri);
      if (!previous || score > previous.score) bestByFile.set(chunk.uri, { chunk, score });
    }
    const ranked = [...bestByFile.values()].sort((left, right) => right.score - left.score || left.chunk.path.localeCompare(right.chunk.path) || left.chunk.startLine - right.chunk.startLine);
    const seen = new Set<string>();
    const results: SearchMatch[] = [];
    for (const { chunk, score } of ranked) {
      if (!budget || !excerptLimit || results.length >= maxFiles) break;
      const normalized = chunk.text.replace(/\s+/g, ' ').trim();
      if (seen.has(normalized)) continue;
      seen.add(normalized);
      let start = 0;
      const excerptBudget = Math.min(budget, excerptLimit);
      if (chunk.text.length > excerptBudget) {
        const lower = chunk.text.toLowerCase();
        const positions = terms.map((term) => lower.indexOf(term)).filter((position) => position >= 0);
        if (positions.length) start = Math.max(0, Math.min(...positions) - Math.floor(excerptBudget / 4));
      }
      const text = chunk.text.slice(start, start + excerptBudget);
      const startLine = chunk.startLine + chunk.text.slice(0, start).split('\n').length - 1;
      results.push({ ...chunk, chunkId: chunk.id, startLine, endLine: startLine + text.split('\n').length - 1, text, score, truncated: text.length !== chunk.text.length });
      budget -= text.length;
    }
    return results;
  }
}
