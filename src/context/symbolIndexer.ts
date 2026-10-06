export type SymbolKind = 'class' | 'interface' | 'function' | 'method' | 'type' | 'variable';

export interface IndexedSymbol {
  name: string;
  kind: SymbolKind;
  filePath: string;
  startLine: number;
  endLine: number;
  signature?: string;
}

export class SymbolIndexer {
  private readonly fileSymbols = new Map<string, IndexedSymbol[]>();
  private readonly symbolNameIndex = new Map<string, IndexedSymbol[]>();

  public indexContent(filePath: string, content: string): IndexedSymbol[] {
    const symbols: IndexedSymbol[] = [];
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineNum = i + 1;

      // Class declaration
      const classMatch = line.match(/(?:export\s+)?(?:abstract\s+)?class\s+([A-Za-z0-9_]+)/);
      if (classMatch) {
        symbols.push({
          name: classMatch[1],
          kind: 'class',
          filePath,
          startLine: lineNum,
          endLine: lineNum,
          signature: line.trim()
        });
        continue;
      }

      // Interface declaration
      const interfaceMatch = line.match(/(?:export\s+)?interface\s+([A-Za-z0-9_]+)/);
      if (interfaceMatch) {
        symbols.push({
          name: interfaceMatch[1],
          kind: 'interface',
          filePath,
          startLine: lineNum,
          endLine: lineNum,
          signature: line.trim()
        });
        continue;
      }

      // Type alias
      const typeMatch = line.match(/(?:export\s+)?type\s+([A-Za-z0-9_]+)\s*=/);
      if (typeMatch) {
        symbols.push({
          name: typeMatch[1],
          kind: 'type',
          filePath,
          startLine: lineNum,
          endLine: lineNum,
          signature: line.trim()
        });
        continue;
      }

      // Function declaration
      const fnMatch = line.match(/(?:export\s+)?(?:async\s+)?function\s+([A-Za-z0-9_]+)\s*\(/);
      if (fnMatch) {
        symbols.push({
          name: fnMatch[1],
          kind: 'function',
          filePath,
          startLine: lineNum,
          endLine: lineNum,
          signature: line.trim()
        });
        continue;
      }

      // Public/private class method
      const methodMatch = line.match(/(?:public|private|protected|static)\s+(?:async\s+)?([A-Za-z0-9_]+)\s*\(/);
      if (methodMatch) {
        symbols.push({
          name: methodMatch[1],
          kind: 'method',
          filePath,
          startLine: lineNum,
          endLine: lineNum,
          signature: line.trim()
        });
        continue;
      }
    }

    this.removeFile(filePath);
    this.fileSymbols.set(filePath, symbols);

    for (const sym of symbols) {
      const key = sym.name.toLowerCase();
      const list = this.symbolNameIndex.get(key) ?? [];
      list.push(sym);
      this.symbolNameIndex.set(key, list);
    }

    return symbols;
  }

  public removeFile(filePath: string): void {
    const existing = this.fileSymbols.get(filePath);
    if (!existing) return;

    for (const sym of existing) {
      const key = sym.name.toLowerCase();
      const list = this.symbolNameIndex.get(key);
      if (list) {
        const filtered = list.filter((s) => s.filePath !== filePath);
        if (filtered.length > 0) {
          this.symbolNameIndex.set(key, filtered);
        } else {
          this.symbolNameIndex.delete(key);
        }
      }
    }

    this.fileSymbols.delete(filePath);
  }

  public search(query: string): IndexedSymbol[] {
    const q = query.toLowerCase().trim();
    if (!q) return [];

    const exactMatches = this.symbolNameIndex.get(q) ?? [];
    if (exactMatches.length > 0) {
      return exactMatches;
    }

    const partialMatches: IndexedSymbol[] = [];
    for (const [name, syms] of this.symbolNameIndex.entries()) {
      if (name.includes(q)) {
        partialMatches.push(...syms);
      }
    }

    return partialMatches;
  }

  public getSymbolsForFile(filePath: string): IndexedSymbol[] {
    return this.fileSymbols.get(filePath) ?? [];
  }

  public getTotalSymbolCount(): number {
    let count = 0;
    for (const list of this.fileSymbols.values()) {
      count += list.length;
    }
    return count;
  }
}
