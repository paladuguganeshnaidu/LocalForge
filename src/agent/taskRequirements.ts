export function positiveTaskRequirements(task: string): string {
  return task.replace(/(?:^|[;\n]|\.(?=\s|$))\s*(?:no|not|don't|do not|never)\b[\s\S]*?(?=[;\n]|\.(?=\s|$)|$)/gi, '.').replace(/\b(?:do not|don't|never)\s+(?:build|create|implement|develop|make|run|launch|verify)(?:\s+(?:or|and)\s+(?:build|create|implement|develop|make|run|launch|verify))*\b|\b(?:not|no)\s+(?:(?:a|any|new)\s+){0,3}(?:website|project)\s+build\b/gi, '');
}

export function requestedBrowserChecks(task: string): { widths: number[]; selectors: string[] } | undefined {
  const requested = positiveTaskRequirements(task);
  if (!/\b(?:website|landing(?:\s+page)?|web\s*(?:app|site)|portfolio)\b/i.test(requested) || !/\b(?:verify|inspect|check|test|render)\b/i.test(requested) || !/\bbrowser(?:_action)?\b/i.test(requested)) return undefined;
  const widths = new Set<number>();
  for (const match of requested.matchAll(/\bwidths?\s+(\d{3,4})(?:\s*(?:and|,)\s*(\d{3,4}))?/gi)) {
    for (const value of match.slice(1).filter(Boolean)) if (Number(value) >= 320 && Number(value) <= 2560) widths.add(Number(value));
  }
  if (/\bmobile\b/i.test(requested)) widths.add(375);
  if (/\btablet\b/i.test(requested)) widths.add(768);
  if (/\bdesktop\b/i.test(requested)) widths.add(1440);
  if (!widths.size && /\bresponsive\b/i.test(requested)) [375, 768, 1440].forEach(width => widths.add(width));
  const selectors = [...new Set([...requested.matchAll(/\bclick\s+[`"']?(#[a-zA-Z][\w-]{0,127})/gi)].map(match => match[1]))];
  return { widths: [...widths], selectors };
}
