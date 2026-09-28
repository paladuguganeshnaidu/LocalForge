export interface IndexedDocument {
  uri: string;
  path: string;
  content: string;
  lines: string[];
}

export interface SearchMatch {
  path: string;
  uri: string;
  startLine: number;
  text: string;
  score: number;
}

export interface RetrievalOptions {
  maxFiles?: number;
  maxChars?: number;
  activeFileUri?: string;
}

export interface RetrievalEngine {
  retrieve(query: string, documents: IndexedDocument[], options?: RetrievalOptions): Promise<SearchMatch[]>;
}

export class LexicalRetrievalEngine implements RetrievalEngine {
  async retrieve(query: string, documents: IndexedDocument[], options: RetrievalOptions = {}): Promise<SearchMatch[]> {
    const maxFiles = options.maxFiles ?? 6;
    const maxChars = options.maxChars ?? 12000;
    const terms = query.toLowerCase().split(/[^a-z0-9_.-]+/).filter((term) => term.length >= 2);

    if (!terms.length || !documents.length) return [];

    const scoredDocs: Array<{ doc: IndexedDocument; score: number }> = [];

    for (const doc of documents) {
      let score = 0;
      const lowerPath = doc.path.toLowerCase();
      const lowerContent = doc.content.toLowerCase();

      // Active file boost
      if (options.activeFileUri && doc.uri === options.activeFileUri) {
        score += 3;
      }

      for (const term of terms) {
        if (lowerPath.includes(term)) {
          score += 10;
        }
        // Count term occurrences in content
        const matches = lowerContent.split(term).length - 1;
        if (matches > 0) {
          score += Math.min(15, matches * 1.5);
        }
      }

      if (score > 0) {
        scoredDocs.push({ doc, score });
      }
    }

    scoredDocs.sort((a, b) => b.score - a.score);
    const top = scoredDocs.slice(0, maxFiles);

    const results: SearchMatch[] = [];
    let charBudget = maxChars;

    for (const { doc, score } of top) {
      if (charBudget <= 0) break;

      // Find the best line window matching query terms
      const bestWindow = findBestWindow(doc.lines, terms);
      const textToInclude = bestWindow.text.slice(0, charBudget);
      charBudget -= textToInclude.length;

      results.push({
        path: doc.path,
        uri: doc.uri,
        startLine: bestWindow.startLine,
        text: textToInclude,
        score
      });
    }

    return results;
  }
}

function findBestWindow(lines: string[], terms: string[]): { startLine: number; text: string } {
  if (!lines.length) return { startLine: 1, text: '' };

  let bestIndex = 0;
  let maxMatches = -1;

  for (let i = 0; i < lines.length; i++) {
    const lineLower = lines[i].toLowerCase();
    let matches = 0;
    for (const term of terms) {
      if (lineLower.includes(term)) matches++;
    }
    if (matches > maxMatches) {
      maxMatches = matches;
      bestIndex = i;
    }
  }

  const start = Math.max(0, bestIndex - 10);
  const end = Math.min(lines.length, bestIndex + 25);
  return {
    startLine: start + 1,
    text: lines.slice(start, end).join('\n')
  };
}
