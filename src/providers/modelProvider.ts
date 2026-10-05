import { ModelCapabilities, ModelSource } from './modelCapabilities';

export interface LocalModel {
  id?: string;
  name: string;
  displayName?: string;
  providerId?: string;
  source?: ModelSource;
  size?: number;
  modifiedAt?: string;
  capabilities?: ModelCapabilities;
  endpoint?: string;
  gpuInfo?: string;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  name?: string;
  tool_call_id?: string;
  tool_calls?: ModelToolCall[];
  thinking?: string;
}

export interface ModelToolCall {
  id?: string;
  type?: 'function';
  function: { name: string; arguments: string | Record<string, unknown> };
}

export interface ModelToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface ModelGenerationProgress {
  phase: 'thinking' | 'responding' | 'preparing_tool';
  receivedChunks: number;
  contentCharacters: number;
  toolCalls: number;
}

export interface ModelProvider {
  readonly id: string;
  readonly source?: ModelSource;
  dispose?(): void;
  detect(): Promise<boolean>;
  listModels(): Promise<LocalModel[]>;
  getDownloadTargets?(): Promise<Array<{ id: string; label: string; source?: ModelSource }>>;
  pullModelToProvider?(providerId: string, name: string, onProgress: (progress: ModelPullProgress) => void, signal?: AbortSignal): Promise<void>;
  pullModel?(name: string, onProgress: (progress: ModelPullProgress) => void, signal?: AbortSignal): Promise<void>;
  deleteModel?(name: string, signal?: AbortSignal): Promise<void>;
  streamChat(
    model: string,
    messages: ChatMessage[],
    onToken: (token: string) => void,
    signal?: AbortSignal
  ): Promise<void>;
  chatWithTools?(
    model: string,
    messages: ChatMessage[],
    tools: ModelToolDefinition[],
    signal?: AbortSignal,
    onContentDelta?: (delta: string) => void,
    onGenerationProgress?: (progress: ModelGenerationProgress) => void
  ): Promise<ChatMessage>;
}

export interface ModelPullProgress {
  status: string;
  total?: number;
  completed?: number;
}
