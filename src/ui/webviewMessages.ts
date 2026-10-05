import { AgentMode } from '../agent/agentLoop';
import { AgentEffort, isAgentEffort } from '../agent/effort';
import { PermissionMode, isPermissionMode } from '../agent/permissionManager';
import { AccessScope, isAccessScope } from '../agent/accessPolicy';
import { normalizeEndpoint, parseCompatibleEndpoints } from '../providers/endpointConfiguration';

export type WebviewMessage =
  | { type: 'ready' }
  | { type: 'refresh' }
  | { type: 'reindexWorkspace' }
  | { type: 'cancel' }
  | { type: 'clear' }
  | { type: 'connectRemote' }
  | { type: 'disconnectRemote' }
  | { type: 'configureRemote' }
  | { type: 'getRemoteStatus' }
  | { type: 'openModels' }
  | { type: 'getContextFiles' }
  | { type: 'selectModel'; model: string }
  | { type: 'installModel'; model: string; targetId?: string }
  | { type: 'pauseModelInstall' }
  | { type: 'cancelModelInstall' }
  | { type: 'deleteModel'; modelId: string }
  | { type: 'setDefaultModel'; modelId: string }
  | { type: 'setMode'; mode: AgentMode }
  | { type: 'setEffort'; effort: AgentEffort }
  | { type: 'setAccessScope'; scope: AccessScope }
  | {
      type: 'chat';
      model: string;
      prompt: string;
      includeContext: boolean;
      includeWorkspace: boolean;
      agentMode: boolean;
      files?: string[];
    }
  | { type: 'newSession' }
  | { type: 'loadSession'; sessionId: string }
  | { type: 'deleteSession'; sessionId: string }
  | { type: 'renameSession'; sessionId: string }
  | { type: 'continueTask' }
  | { type: 'diagnose' }
  | { type: 'applyEdit'; proposalId: string; files?: string[] }
  | { type: 'rejectEdit'; proposalId: string }
  | { type: 'rollbackEdit'; recoveryId: string; files?: string[] }
  | { type: 'forgetEditRecovery'; recoveryId: string }
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
    case 'reindexWorkspace':
    case 'cancel':
    case 'clear':
    case 'connectRemote':
    case 'disconnectRemote':
    case 'configureRemote':
    case 'getRemoteStatus':
    case 'openModels':
    case 'getContextFiles':
    case 'pauseModelInstall':
    case 'cancelModelInstall':
    case 'newSession':
    case 'continueTask':
    case 'diagnose':
      return true;

    case 'selectModel':
      return typeof msg.model === 'string';

    case 'installModel':
      return typeof msg.model === 'string' &&
        msg.model.trim().length > 0 &&
        msg.model.length <= 128 &&
        !/[\u0000-\u001f\u007f]/.test(msg.model) &&
        (msg.targetId === undefined || typeof msg.targetId === 'string' && /^[a-zA-Z0-9_-]{1,200}$/.test(msg.targetId));

    case 'deleteModel':
    case 'setDefaultModel':
      return typeof msg.modelId === 'string' &&
        msg.modelId.trim().length > 0 &&
        msg.modelId.length <= 256 &&
        !/[\u0000-\u001f\u007f]/.test(msg.modelId);

    case 'setMode':
      return msg.mode === 'ask' || msg.mode === 'plan' || msg.mode === 'agent';

    case 'setEffort':
      return typeof msg.effort === 'string' && isAgentEffort(msg.effort);

    case 'setAccessScope':
      return isAccessScope(msg.scope);

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
        typeof msg.agentMode === 'boolean' &&
        (msg.files === undefined || Array.isArray(msg.files) && msg.files.length <= 10 && msg.files.every(file => typeof file === 'string' && isSafeRelativePath(file)))
      );

    case 'loadSession':
    case 'deleteSession':
    case 'renameSession':
      return typeof msg.sessionId === 'string' && msg.sessionId.length > 0 && msg.sessionId.length <= 200;

    case 'applyEdit':
    case 'rejectEdit':
      return typeof msg.proposalId === 'string' && msg.proposalId.length > 0 && msg.proposalId.length <= 200 && isFileSelection(msg.files);

    case 'rollbackEdit':
    case 'forgetEditRecovery':
      return typeof msg.recoveryId === 'string' && /^undo-[a-f0-9-]{36}$/.test(msg.recoveryId) && isFileSelection(msg.files);

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
  'routing.completionModel',
  'agent.maxRounds',
  'ollama.contextWindow',
  'ollama.maxOutputTokens',
  'chatMemory.enabled',
  'chatMemory.scope',
  'chatMemory.recentCharacters',
  'chatMemory.retrievedCharacters',
  'chatMemory.resultCount',
  'context.maxIndexedFiles', 'context.maxFileBytes', 'context.maxIndexCharacters',
  'ollama.baseUrl', 'providers.openAICompatibleUrls'
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
    (key === 'ollama.baseUrl' ? isEndpointValue(value) :
      key === 'providers.openAICompatibleUrls' ? typeof value === 'string' && !parseCompatibleEndpoints(value).errors.length :
      key === 'chatMemory.enabled' ? typeof value === 'boolean' :
      key === 'chatMemory.scope' ? value === 'current' || value === 'all' :
      key === 'chatMemory.recentCharacters' ? Number.isInteger(value) && Number(value) >= 0 && Number(value) <= 32000 :
      key === 'chatMemory.retrievedCharacters' ? Number.isInteger(value) && Number(value) >= 0 && Number(value) <= 16000 :
      key === 'chatMemory.resultCount' ? Number.isInteger(value) && Number(value) >= 1 && Number(value) <= 20 :
      key === 'context.maxIndexedFiles' ? Number.isInteger(value) && Number(value) >= 1 && Number(value) <= 20000 :
      key === 'context.maxFileBytes' ? Number.isInteger(value) && Number(value) >= 1024 && Number(value) <= 8388608 :
      key === 'context.maxIndexCharacters' ? Number.isInteger(value) && Number(value) >= 100000 && Number(value) <= 64000000 :
      key === 'agent.maxRounds' ? Number.isInteger(value) && Number(value) >= 0 && Number(value) <= 10000 :
      key === 'ollama.contextWindow' ? Number.isInteger(value) && Number(value) >= 2048 && Number(value) <= 1048576 :
      key === 'ollama.maxOutputTokens' ? Number.isInteger(value) && Number(value) >= -1 && Number(value) <= 1048576 :
        typeof value === 'boolean' || (typeof value === 'string' && value.length <= 200))
  );
}

/** Workspace-relative path with no traversal, absolute, UNC, drive or NUL components. */
export function isSafeRelativePath(input: string): boolean {
  const p = input.replace(/\\/g, '/').trim();
  if (!p || p.length > 1024 || p.includes('\0')) return false;
  if (p.startsWith('/') || p.startsWith('//') || /^[A-Za-z]:/.test(p)) return false;
  return p.split('/').every((seg) => seg !== '' && seg !== '.' && seg !== '..');
}

function isEndpointValue(value: unknown): boolean {
  try { return typeof value === 'string' && !!normalizeEndpoint(value); } catch { return false; }
}

function isFileSelection(files: unknown): boolean {
  return files === undefined || (Array.isArray(files) && files.length > 0 && files.length <= 1000 && files.every((path) => typeof path === 'string' && isSafeRelativePath(path)));
}
