export type LineEnding = '\r\n' | '\n' | '\r';

export class LineEndingPreserver {
  public static detectLineEnding(content: string): LineEnding {
    const crlfCount = (content.match(/\r\n/g) || []).length;
    const lfCount = (content.match(/[^\r]\n/g) || []).length;

    if (crlfCount > lfCount) {
      return '\r\n';
    }
    return '\n';
  }

  public static hasUtf8Bom(buffer: Buffer): boolean {
    return buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf;
  }

  public static normalizeLineEndings(content: string, targetEnding: LineEnding): string {
    // Convert all to \n first
    const unified = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    if (targetEnding === '\n') {
      return unified;
    }
    return unified.replace(/\n/g, targetEnding);
  }

  public static preserveOriginalFormat(original: string, modified: string): string {
    const originalEnding = this.detectLineEnding(original);
    return this.normalizeLineEndings(modified, originalEnding);
  }
}
