export type CapabilityConfidence = 'high' | 'medium' | 'inferred';

export interface RuntimeModelMetadata {
  capabilities?: string[];
  template?: string;
  model_info?: Record<string, unknown>;
}

export function advertisedContextWindow(metadata?: RuntimeModelMetadata): number | undefined {
  const info = metadata?.model_info;
  const architecture = info?.['general.architecture'];
  if (!info || Array.isArray(info) || typeof architecture !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(architecture)) return undefined;
  const context = info[`${architecture}.context_length`];
  return typeof context === 'number' && Number.isInteger(context) && context >= 512 && context <= 1048576 ? context : undefined;
}

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

export type ToolCallingSupport = 'supported' | 'unsupported' | 'unknown';

export function getToolCallingStatus(capabilities: ModelCapabilities): {
  status: ToolCallingSupport;
  confidence: CapabilityConfidence;
} {
  const conf = capabilities.confidence?.toolCalling ?? 'inferred';
  if (conf === 'high' || conf === 'medium') {
    return {
      status: capabilities.toolCalling ? 'supported' : 'unsupported',
      confidence: conf
    };
  }
  return {
    status: capabilities.toolCalling ? 'supported' : 'unknown',
    confidence: conf
  };
}

export function evaluateRuntimeCapabilities(
  name: string,
  size?: number,
  runtimeMetadata?: RuntimeModelMetadata
): ModelCapabilities {
  const base = inferModelCapabilities(name, size);

  if (runtimeMetadata) {
    const context = advertisedContextWindow(runtimeMetadata);
    if (context !== undefined) {
      base.contextWindow = context;
      base.confidence = { ...base.confidence, contextWindow: 'high' };
    }
    if (Array.isArray(runtimeMetadata.capabilities)) {
      const hasTools = runtimeMetadata.capabilities.includes('tools');
      base.toolCalling = hasTools;
      base.reasoning = runtimeMetadata.capabilities.includes('thinking');
      base.confidence = {
        ...base.confidence,
        toolCalling: 'high',
        reasoning: 'high'
      };
    } else if (runtimeMetadata.template) {
      const hasToolsInTemplate =
        runtimeMetadata.template.includes('.Tools') ||
        runtimeMetadata.template.includes('[AVAILABLE_TOOLS]') ||
        runtimeMetadata.template.includes('{{- if .Tools }}');
      base.toolCalling = hasToolsInTemplate;
      base.confidence = {
        ...base.confidence,
        toolCalling: 'high'
      };
    }
  }

  return base;
}
