import {
  HookContext,
  HookEventName,
  HookResult,
  RegisteredHook
} from './types';

export class HookEngine {
  private readonly hooks = new Map<HookEventName, RegisteredHook[]>();
  private activeRecursionDepth = 0;
  private readonly maxRecursionDepth = 5;

  public registerHook(hook: RegisteredHook): void {
    const list = this.hooks.get(hook.eventName) ?? [];
    list.push(hook);
    list.sort((a, b) => a.priority - b.priority);
    this.hooks.set(hook.eventName, list);
  }

  public removeHook(hookId: string): void {
    for (const [event, list] of this.hooks.entries()) {
      this.hooks.set(
        event,
        list.filter((h) => h.id !== hookId)
      );
    }
  }

  public clear(): void {
    this.hooks.clear();
  }

  public async trigger(
    eventName: HookEventName,
    data: Record<string, unknown>,
    metadata?: { runId?: string; agentId?: string }
  ): Promise<HookResult> {
    if (this.activeRecursionDepth >= this.maxRecursionDepth) {
      return {
        allow: false,
        reason: `Hook recursion limit exceeded (max depth: ${this.maxRecursionDepth}).`
      };
    }

    const registered = this.hooks.get(eventName) ?? [];
    if (registered.length === 0) {
      return { allow: true, modifiedData: data };
    }

    this.activeRecursionDepth++;
    let currentData = { ...data };

    try {
      for (const hook of registered) {
        const context: HookContext = {
          eventName,
          timestamp: Date.now(),
          runId: metadata?.runId,
          agentId: metadata?.agentId,
          data: currentData
        };

        const timeoutMs = hook.timeoutMs ?? 5000;
        let timeoutTimer: NodeJS.Timeout;

        const timeoutPromise = new Promise<never>((_, reject) => {
          timeoutTimer = setTimeout(() => {
            reject(new Error(`Hook "${hook.name}" (${hook.id}) timed out after ${timeoutMs}ms.`));
          }, timeoutMs);
        });

        try {
          const result = await Promise.race([
            Promise.resolve(hook.handler(context)),
            timeoutPromise
          ]);

          clearTimeout(timeoutTimer!);

          if (result && typeof result === 'object') {
            if (result.allow === false) {
              return {
                allow: false,
                reason: result.reason ?? `Action blocked by hook "${hook.name}".`
              };
            }
            if (result.modifiedData) {
              currentData = { ...currentData, ...result.modifiedData };
            }
          }
        } catch (err) {
          clearTimeout(timeoutTimer!);
          // Failing closed on hook errors for security
          return {
            allow: false,
            reason: `Hook execution failed in "${hook.name}": ${(err as Error).message}`
          };
        }
      }

      return {
        allow: true,
        modifiedData: currentData
      };
    } finally {
      this.activeRecursionDepth--;
    }
  }
}
