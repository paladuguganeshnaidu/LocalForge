export function isReadOnlyInspectionTask(prompt: string): boolean {
  if (/^\s*(?:hi|hello|hey|thanks|thank you)[!.?\s]*$/i.test(prompt)) return true;
  const summary = /\b(?:summary|summari[sz]e)\b/i.test(prompt);
  const action = /\b(?:create|build|write|edit|modify|refactor|implement|fix|delete|move|rename|execute|install|run)\b/i.test(prompt);
  return summary && !action;
}
