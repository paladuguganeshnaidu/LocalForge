export function scoreText(query: string, path: string, text: string): number {
  const terms = [...new Set(query.toLowerCase().match(/[\p{L}\p{N}_-]{2,}/gu) ?? [])];
  if (!terms.length) return 0;
  const lowerPath = path.toLowerCase();
  const lowerText = text.toLowerCase();
  return terms.reduce((score, term) => {
    const fileBonus = lowerPath.includes(term) ? 4 : 0;
    let count = 0;
    let offset = 0;
    while ((offset = lowerText.indexOf(term, offset)) !== -1 && count < 8) {
      count += 1;
      offset += term.length;
    }
    return score + fileBonus + Math.min(count, 4);
  }, 0);
}

export function selectRelevantLines(query: string, content: string): { startLine: number; text: string } {
  const lines = content.split(/\r?\n/);
  const terms = [...new Set(query.toLowerCase().match(/[\p{L}\p{N}_-]{2,}/gu) ?? [])];
  const matching = lines.flatMap((line, index) =>
    terms.some((term) => line.toLowerCase().includes(term)) ? [index] : []
  );
  if (!matching.length) return { startLine: 1, text: lines.slice(0, 24).join('\n') };
  const first = Math.max(0, matching[0] - 3);
  const last = Math.min(lines.length, Math.max(...matching.slice(0, 6)) + 5);
  return { startLine: first + 1, text: lines.slice(first, last).join('\n') };
}
