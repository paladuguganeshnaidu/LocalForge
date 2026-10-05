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
    { role: 'system', content: 'You are TuxNest Chat, a local-first coding assistant in VS Code. Respond directly to the user. For a greeting or thanks, reply briefly and naturally. Do not invent a project, organization, or affiliation. No project inspection or file changes were requested or performed.' },
    { role: 'user', content: prompt }
  ];
}
