export interface LocalModel {
  name: string;
  size?: number;
  modifiedAt?: string;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ModelProvider {
  readonly id: string;
  detect(): Promise<boolean>;
  listModels(): Promise<LocalModel[]>;
  streamChat(
    model: string,
    messages: ChatMessage[],
    onToken: (token: string) => void,
    signal?: AbortSignal
  ): Promise<void>;
}
