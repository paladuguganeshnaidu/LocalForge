import { AgentMode } from '../agent/agentLoop';

export type WebviewMessage =
  | { type: 'ready' }
  | { type: 'refresh' }
  | { type: 'cancel' }
  | { type: 'clear' }
  | { type: 'connectRemote' }
  | { type: 'disconnectRemote' }
  | { type: 'configureRemote' }
  | { type: 'getRemoteStatus' }
  | { type: 'selectModel'; model: string }
  | { type: 'setMode'; mode: AgentMode }
  | {
      type: 'chat';
      model: string;
      prompt: string;
      includeContext: boolean;
      includeWorkspace: boolean;
      agentMode: boolean;
    }
  | { type: 'newSession' }
  | { type: 'loadSession'; sessionId: string }
  | { type: 'deleteSession'; sessionId: string }
  | { type: 'continueTask' }
  | { type: 'diagnose' }
  | { type: 'applyEdit'; proposalId: string; files?: string[] }
  | { type: 'rejectEdit'; proposalId: string }
  | { type: 'showDiff'; proposalId: string; filePath: string }
  | { type: 'updateSettings'; settings: Record<string, unknown> };

export function isWebviewMessage(value: unknown): value is WebviewMessage {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const msg = value as Record<string, unknown>;

  if (typeof msg.type !== 'string') return false;

  switch (msg.type) {
    case 'ready':
    case 'refresh':
    case 'cancel':
    case 'clear':
    case 'connectRemote':
    case 'disconnectRemote':
    case 'configureRemote':
    case 'getRemoteStatus':
    case 'newSession':
    case 'continueTask':
    case 'diagnose':
      return true;

    case 'selectModel':
      return typeof msg.model === 'string';

    case 'setMode':
      return msg.mode === 'ask' || msg.mode === 'plan' || msg.mode === 'agent';

    case 'chat':
      return (
        typeof msg.model === 'string' &&
        typeof msg.prompt === 'string' &&
        msg.prompt.length <= 20000 &&
        typeof msg.includeContext === 'boolean' &&
        typeof msg.includeWorkspace === 'boolean' &&
        typeof msg.agentMode === 'boolean'
      );

    case 'loadSession':
    case 'deleteSession':
      return typeof msg.sessionId === 'string';

    case 'applyEdit':
    case 'rejectEdit':
      return typeof msg.proposalId === 'string';

    case 'showDiff':
      return typeof msg.proposalId === 'string' && typeof msg.filePath === 'string';

    case 'updateSettings':
      return typeof msg.settings === 'object' && msg.settings !== null;

    default:
      return false;
  }
}
