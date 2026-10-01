import { AgentMode } from '../agent/agentLoop';
import { PermissionMode, isPermissionMode } from '../agent/permissionManager';

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
  | { type: 'openFile'; filePath: string }
  | { type: 'proceedArtifact'; artifactId: string }
  | { type: 'commentArtifact'; artifactId: string; comment: string }
  | { type: 'setStrategy'; strategy: 'fast' | 'planning' }
  | { type: 'updateSettings'; settings: Record<string, unknown> }
  | {
      type: 'permissionResolved';
      requestId: string;
      decision: 'allow' | 'deny' | 'allow_session';
    }
  | {
      type: 'setPermissionMode';
      mode: PermissionMode;
    };

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

    case 'setStrategy':
      return msg.strategy === 'fast' || msg.strategy === 'planning';

    case 'openFile':
      return typeof msg.filePath === 'string' && isSafeRelativePath(msg.filePath);

    case 'proceedArtifact':
      return typeof msg.artifactId === 'string';

    case 'commentArtifact':
      return typeof msg.artifactId === 'string' && typeof msg.comment === 'string';

    case 'chat':
      return (
        typeof msg.prompt === 'string' &&
        msg.prompt.trim().length > 0 &&
        msg.prompt.length <= 20000 &&
        typeof msg.model === 'string' &&
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
      return isAllowedSettingsPayload(msg.settings);

    case 'permissionResolved':
      return (
        typeof msg.requestId === 'string' &&
        (msg.decision === 'allow' ||
          msg.decision === 'deny' ||
          msg.decision === 'allow_session')
      );

    case 'setPermissionMode':
      return isPermissionMode(msg.mode);

    default:
      return false;
  }
}

/** Setting keys (relative to the `localforge` section) that the webview may change. */
export const WEBVIEW_WRITABLE_SETTINGS: ReadonlySet<string> = new Set([
  'autocomplete.enabled',
  'routing.chatModel',
  'routing.editModel',
  'routing.agentModel',
  'routing.completionModel'
]);

function isAllowedSettingsPayload(settings: unknown): boolean {
  if (typeof settings !== 'object' || settings === null || Array.isArray(settings)) {
    return false;
  }
  const entries = Object.entries(settings as Record<string, unknown>);
  if (entries.length === 0 || entries.length > WEBVIEW_WRITABLE_SETTINGS.size) {
    return false;
  }
  return entries.every(([key, value]) =>
    WEBVIEW_WRITABLE_SETTINGS.has(key) &&
    (typeof value === 'boolean' || (typeof value === 'string' && value.length <= 200))
  );
}

/** Workspace-relative path with no traversal, absolute, UNC, drive or NUL components. */
export function isSafeRelativePath(input: string): boolean {
  const p = input.replace(/\\/g, '/').trim();
  if (!p || p.length > 1024 || p.includes('\0')) return false;
  if (p.startsWith('/') || p.startsWith('//') || /^[A-Za-z]:/.test(p)) return false;
  return p.split('/').every((seg) => seg !== '' && seg !== '.' && seg !== '..');
}
