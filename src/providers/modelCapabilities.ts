export interface ModelCapabilities {
  chat: boolean;
  streaming: boolean;
  toolCalling: boolean;
  structuredOutput: boolean;
  codeCompletion: boolean;
  vision: boolean;
  reasoning: boolean;
  contextWindow: number;
  systemPrompt: boolean;
}

export type ModelSource = 'local' | 'remote';

export interface ModelMetadata {
  id: string;
  name: string;
  displayName: string;
  providerId: string;
  source: ModelSource;
  size?: number;
  modifiedAt?: string;
  capabilities: ModelCapabilities;
  endpoint?: string;
  gpuInfo?: string;
}

export function inferModelCapabilities(name: string, size?: number): ModelCapabilities {
  const lower = name.toLowerCase();

  const isCoder = /coder|code|starcoder|codestral|deepseek-coder/i.test(lower);
  const isReasoning = /r1|qwq|o1|reason|deepseek-r1/i.test(lower);
  const isVision = /vision|llava|bakllava|moondream|vl/i.test(lower);
  const isTiny = /0\.5b|1b|1\.5b|mini|small/i.test(lower) || (size !== undefined && size < 1.5 * 1024 * 1024 * 1024);

  // Models with proven tool-calling support in Ollama / OpenAI formats
  const hasToolCalling = /qwen2\.5|llama3|llama-3|mistral|hermes|command-r|firefunction|codestral|deepseek/i.test(lower);

  let contextWindow = 8192;
  if (/qwen2\.5/i.test(lower)) contextWindow = 32768;
  else if (/llama3\.1|llama-3\.1/i.test(lower)) contextWindow = 131072;
  else if (/mistral/i.test(lower)) contextWindow = 32768;
  else if (isTiny) contextWindow = 4096;

  return {
    chat: true,
    streaming: true,
    toolCalling: hasToolCalling,
    structuredOutput: true,
    codeCompletion: isCoder || (!isTiny && !isVision && !isReasoning),
    vision: isVision,
    reasoning: isReasoning,
    contextWindow,
    systemPrompt: true
  };
}
