import { ChatMessage, ModelProvider, ModelToolCall, ModelToolDefinition } from '../providers/modelProvider';
import { ToolRegistry } from './toolRegistry';
import { PermissionManager } from './permissionManager';
import { AgentLoop, AgentMode, AgentState, AgentToolCallRecord, AgentStep } from './agentLoop';

export type WorkspaceToolExecutor = (name: string, argumentsValue: Record<string, unknown>, toolContext?: any) => Promise<unknown>;
export type { AgentMode, AgentToolCallRecord, AgentStep, AgentState };

export interface AgentToolEvent {
  id: string;
  name: string;
  args: Record<string, unknown>;
  status: 'running' | 'success' | 'error';
  result?: unknown;
  error?: string;
}

export interface AgentOptions {
  signal?: AbortSignal;
  mode?: AgentMode;
  onTool?: (message: string) => void;
  onToolStart?: (name: string, args: Record<string, unknown>, id: string) => void;
  onToolEnd?: (name: string, result: unknown, error?: string, id?: string) => void;
  onThought?: (chunk: string) => void;
  maxRounds?: number;
  maxCallsPerRound?: number;
}

export async function runToolAgent(
  provider: ModelProvider,
  model: string,
  messages: ChatMessage[],
  tools: ModelToolDefinition[],
  executeTool: WorkspaceToolExecutor,
  options: AgentOptions = {}
): Promise<string> {
  const registry = new ToolRegistry();
  for (const def of tools) {
    registry.registerTool(def, (args) => executeTool(def.function.name, args));
  }

  // Permission manager in allow_safe_auto mode for toolAgent adapter
  const permissionManager = new PermissionManager('allow_safe_auto');

  const loop = new AgentLoop(provider, registry, permissionManager);
  const result = await loop.run(model, messages, {
    signal: options.signal,
    mode: options.mode,
    maxRounds: options.maxRounds,
    maxCallsPerRound: options.maxCallsPerRound,
    onThought: options.onThought,
    onToolStart: (name, args, id) => {
      options.onTool?.(`Executing ${name}`);
      options.onToolStart?.(name, args, id);
    },
    onToolEnd: (name, res, error, id) => {
      if (error && error.includes('not allow-listed')) {
        options.onTool?.(`Blocked tool request: ${name}`);
      }
      options.onToolEnd?.(name, res, error, id);
    }
  });

  return result.response;
}
