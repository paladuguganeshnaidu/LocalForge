import { ToolCallParser } from './toolCallParser';

export class VisibleTextStream {
  private raw = '';
  private emitted = '';

  constructor(private readonly onText: (text: string) => void) {}

  public push(chunk: string): void {
    if (!chunk) return;
    this.raw += chunk;
    this.flush(false);
  }

  public finish(visibleText?: string): void {
    this.flush(true, visibleText);
  }

  private flush(final: boolean, finalText?: string): void {
    let visible = final
      ? (finalText ?? ToolCallParser.parse(this.raw).userVisibleText).trim()
      : ToolCallParser.parse(this.raw).userVisibleText;

    if (!final) {
      const blockedAt = this.findIncompleteControlStart();
      if (blockedAt >= 0) {
        visible = ToolCallParser.parse(this.raw.slice(0, blockedAt)).userVisibleText;
      }
      visible = visible.trimStart().replace(/\s+$/, '');
    }

    if (!visible.startsWith(this.emitted)) return;
    const delta = visible.slice(this.emitted.length);
    if (delta) this.onText(delta);
    this.emitted = visible;
  }

  private findIncompleteControlStart(): number {
    const lower = this.raw.toLowerCase();
    let blockedAt = -1;
    const block = (index: number) => {
      if (index >= 0) blockedAt = blockedAt < 0 ? index : Math.min(blockedAt, index);
    };
    const tags = [
      ['<think', '</think>'],
      ['<thought', '</thought>'],
      ['<reasoning', '</reasoning>'],
      ['<!--', '-->'],
      ['<tool_call', '</tool_call>']
    ];

    for (const [open, close] of tags) {
      let offset = 0;
      while (true) {
        const start = lower.indexOf(open, offset);
        if (start < 0) break;
        if (lower.indexOf(close, start + open.length) < 0) block(start);
        offset = start + open.length;
      }
    }

    const protocolMarker = 'localforge_tool_call';
    let markerOffset = 0;
    while (true) {
      const markerStart = lower.indexOf(protocolMarker, markerOffset);
      if (markerStart < 0) break;
      const objectStart = lower.indexOf('{', markerStart + protocolMarker.length);
      if (objectStart < 0 || this.findJsonEnd(objectStart) < 0) block(markerStart);
      markerOffset = markerStart + protocolMarker.length;
    }

    for (let start = 0; start < lower.length; start += 1) {
      if (lower[start] !== '{' && lower[start] !== '[') continue;
      const objectStart = lower[start] === '['
        ? lower.indexOf('{', start + 1)
        : start;
      if (objectStart < 0) continue;
      const prefix = lower.slice(objectStart).replace(/\s/g, '');
      const toolPrefixes = ['{"name":', '{"tool":', '{"function":', '{"action":', '{"call":', '{"error":'];
      if (!toolPrefixes.some((candidate) => candidate.startsWith(prefix) || prefix.startsWith(candidate))) continue;
      if (this.findJsonEnd(objectStart) < 0) block(lower[start] === '[' ? start : objectStart);
    }

    const partialMarkers = [
      '<think', '</think', '<thought', '</thought', '<reasoning', '</reasoning',
      '<!--', '-->', '<tool_call', '</tool_call', protocolMarker
    ];
    for (let start = Math.max(0, lower.length - Math.max(...partialMarkers.map((marker) => marker.length)) + 1); start < lower.length; start += 1) {
      const suffix = lower.slice(start);
      if (partialMarkers.some((marker) => marker.startsWith(suffix))) block(start);
    }

    return blockedAt;
  }

  private findJsonEnd(start: number): number {
    const stack: string[] = [];
    let inString = false;
    let escaped = false;

    for (let index = start; index < this.raw.length; index += 1) {
      const char = this.raw[index];
      if (inString) {
        if (escaped) escaped = false;
        else if (char === '\\') escaped = true;
        else if (char === '"') inString = false;
        continue;
      }
      if (char === '"') inString = true;
      else if (char === '{' || char === '[') stack.push(char === '{' ? '}' : ']');
      else if (char === '}' || char === ']') {
        if (stack.pop() !== char) return -1;
        if (!stack.length) return index;
      }
    }
    return -1;
  }
}
