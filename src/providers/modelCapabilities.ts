export type CapabilityConfidence = 'high' | 'medium' | 'inferred';

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
  confidence?: {
    toolCalling?: CapabilityConfidence;
    codeCompletion?: CapabilityConfidence;
    reasoning?: CapabilityConfidence;
    vision?: CapabilityConfidence;
    contextWindow?: CapabilityConfidence;
  };
}

export type ModelSource = 'local' | 'remote';

export interface ModelRef {
  id: string; // Canonical identifier e.g. "ollama:qwen2.5-coder:7b" or "ssh-ollama-profile:qwen3-coder:32b"
  providerId: string;
  name: string; // Model name passed to provider
  displayName: string;
  source: ModelSource;
  size?: number;
  modifiedAt?: string;
  capabilities: ModelCapabilities;
  endpoint?: string;
  gpuInfo?: string;
}

export type ModelMetadata = ModelRef;

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

  const confidence: Record<string, CapabilityConfidence> = {
    toolCalling: hasToolCalling ? 'high' : 'inferred',
    codeCompletion: isCoder ? 'high' : 'inferred',
    reasoning: isReasoning ? 'high' : 'inferred',
    vision: isVision ? 'high' : 'inferred',
    contextWindow: /qwen2\.5|llama3/i.test(lower) ? 'high' : 'inferred'
  };

  return {
    chat: true,
    streaming: true,
    toolCalling: hasToolCalling,
    structuredOutput: true,
    codeCompletion: isCoder || (!isTiny && !isVision && !isReasoning),
    vision: isVision,
    reasoning: isReasoning,
    contextWindow,
    systemPrompt: true,
    confidence
  };
}
