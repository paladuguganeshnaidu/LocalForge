import { AgentMode } from '../agent/agentLoop';
import { LocalModel } from '../providers/modelProvider';
import { GpuStatusInfo } from '../remote/gpuMonitor';

export interface LocalForgeSettings {
  autoApproveSafe: boolean;
  inlineCompletion: boolean;
  contextBudgetTokens: number;
  ollamaEndpoint: string;
  openaiEndpoint?: string;
}

export interface WebviewState {
  models: LocalModel[];
  selectedModel?: string;
  mode: AgentMode;
  isBusy: boolean;
  remoteConnected: boolean;
  remoteProfileName?: string;
  gpuStatus?: GpuStatusInfo[];
  activeFilePath?: string;
  settings: LocalForgeSettings;
}
