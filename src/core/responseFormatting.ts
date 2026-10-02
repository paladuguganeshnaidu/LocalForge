export function normalizeAssistantMarkdown(value: string): string {
  let fence: string | undefined;
  return String(value ?? '').replace(/\r\n/g, '\n').split('\n').map((line) => {
    const marker = /^\s*(`{3,}|~{3,})/.exec(line);
    if (marker) {
      if (!fence) fence = marker[1][0];
      else if (fence === marker[1][0]) fence = undefined;
      return line;
    }
    if (fence) return line;
    const section = /^(Purpose|Commands|Summary|Overview|Architecture|Findings|Changes|Verification|Testing|Objective|Next steps?|Remaining blockers):\s*(.*)$/i.exec(line);
    if (!section) return line;
    return `## ${section[1]}${section[2] ? '\n\n' + section[2] : ''}`;
  }).join('\n');
}
