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

export interface ModelProvider {
  readonly id: string;
  readonly source?: ModelSource;
  detect(): Promise<boolean>;
  listModels(): Promise<LocalModel[]>;
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
    onContentDelta?: (delta: string) => void
  ): Promise<ChatMessage>;
}

export interface ModelPullProgress {
  status: string;
  total?: number;
  completed?: number;
}
