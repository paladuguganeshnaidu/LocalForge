import { ChatMessage } from '../providers/modelProvider';

export type TaskIntent = 'conversation' | 'memory' | 'inspection' | 'task';

export function classifyTaskIntent(prompt: string): TaskIntent {
  if (/^\s*(?:hi|hello|hey|thanks|thank you|good morning|good afternoon|good evening)[!.?\s]*$/i.test(prompt)) return 'conversation';
  const summary = /\b(?:summary|summari[sz]e)\b/i.test(prompt);
  const action = /\b(?:create|build|write|edit|modify|refactor|implement|fix|delete|move|rename|execute|install|run)\b/i.test(prompt);
  const inspectionAction = /\b(?:read|inspect|search|analy[sz]e)\b/i.test(prompt) || /^(?:please\s+)?test\b/i.test(prompt);
  if (!action && !inspectionAction && /\b(?:earlier|previously|remember|mentioned|told you|in this chat|our conversation|chat history)\b/i.test(prompt)) return 'memory';
  return summary && !action ? 'inspection' : 'task';
}

export function requiresWorkspaceToolUse(prompt: string): boolean {
  const intent = classifyTaskIntent(prompt);
  return intent !== 'conversation' && intent !== 'memory' && /\b(?:read|inspect|summari[sz]e|summary|analy[sz]e|create|build|fix|edit|modify|refactor|implement|delete|move|run|test)\b/i.test(prompt);
}

export function isReadOnlyInspectionTask(prompt: string): boolean {
  return classifyTaskIntent(prompt) !== 'task';
}

export function conversationalMessages(prompt: string): ChatMessage[] {
  return [
    { role: 'system', content: 'You are TuxNest Chat (LocalForge), an elite, local-first autonomous engineering agent running directly inside VS Code. Respond warmly, concisely, and professionally to conversational inquiries. For greetings, concisely introduce your capabilities as an end-to-end autonomous coding partner ready to inspect repos, plan architectures, implement full-stack code, debug complex errors, and run tests locally with total privacy. For thanks, acknowledge graciously and express readiness for the next engineering task. CONSTRAINTS: Do not invent a fictitious project name, organization, or affiliation. Do not fabricate any inspection results or file changes — none were requested or performed in conversational mode. Stay authentic, sharp, and helpful.' },
    { role: 'user', content: prompt }
  ];
}
