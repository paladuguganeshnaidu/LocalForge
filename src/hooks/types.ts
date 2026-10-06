export type HookEventName =
  | 'pre_user_prompt'
  | 'post_user_prompt'
  | 'pre_context_build'
  | 'post_context_build'
  | 'pre_tool_use'
  | 'post_tool_use'
  | 'pre_file_write'
  | 'post_file_write'
  | 'pre_command'
  | 'post_command'
  | 'pre_mcp_tool'
  | 'post_mcp_tool'
  | 'on_run_complete'
  | 'on_run_failed';

export interface HookContext {
  eventName: HookEventName;
  timestamp: number;
  runId?: string;
  agentId?: string;
  data: Record<string, unknown>;
}

export interface HookResult {
  allow: boolean;
  reason?: string;
  modifiedData?: Record<string, unknown>;
}

export type HookHandler = (context: HookContext) => Promise<HookResult | void> | HookResult | void;

export interface RegisteredHook {
  id: string;
  name: string;
  eventName: HookEventName;
  priority: number; // lower runs earlier
  handler: HookHandler;
  timeoutMs?: number;
}
