import { LocalModel } from './modelProvider';
import { ModelRef } from './modelCapabilities';

export type ModelTask = 'chat' | 'edit' | 'agent' | 'completion';
export type TaskType = ModelTask;
export type ModelPreferences = Partial<Record<ModelTask, string>>;

export interface RoutedResult {
  model: LocalModel;
  reason: string;
}

export function routeModel(
  models: LocalModel[],
  task: ModelTask,
  preferences: ModelPreferences = {},
  userSelection?: string
): LocalModel | undefined {
  return routeModelWithReason(models, task, preferences, userSelection)?.model;
}

export function routeModelWithReason(
  models: LocalModel[],
  task: ModelTask,
  preferences: ModelPreferences = {},
  userSelection?: string
): RoutedResult | undefined {
  if (!models.length) return undefined;

  // 1. Explicit task configuration preference
  const configured = preferences[task];
  if (configured) {
    const model = models.find(
      (m) => m.id === configured || m.name === configured || m.providerId === configured
    );
    if (model) {
      return {
        model,
        reason: `Configured preference for ${task}: ${model.id || model.name}`
      };
    }
  }

  // 2. Explicit user selection (when not 'auto')
  if (userSelection && userSelection.toLowerCase() !== 'auto') {
    const model = models.find((m) => m.id === userSelection || m.name === userSelection);
    if (model) {
      return {
        model,
        reason: `User selected: ${model.id || model.name}`
      };
    }
  }

  // 3. Auto capability-based and GPU-aware routing
  if (task === 'agent') {
    const capable = models.filter((m) => m.capabilities?.toolCalling);
    if (capable.length) {
      // Prefer remote GPU model if available and tool-calling
      const remoteGpu = capable.find((m) => m.source === 'remote');
      if (remoteGpu) {
        return {
          model: remoteGpu,
          reason: `Auto selected ${remoteGpu.displayName || remoteGpu.name}: tool-calling enabled, remote GPU connected`
        };
      }
      const coders = capable.filter((m) => m.capabilities?.codeCompletion || /coder|code/i.test(m.name || m.id || ''));
      if (coders.length) {
        const bestCoder = [...coders].sort((a, b) => (a.size || 0) - (b.size || 0))[0];
        return {
          model: bestCoder,
          reason: `Auto selected ${bestCoder.displayName || bestCoder.name}: tool-calling capability verified (specialized coding model)`
        };
      }
      const smallest = [...capable].sort((a, b) => (a.size || 0) - (b.size || 0))[0];
      return {
        model: smallest,
        reason: `Auto selected ${smallest.displayName || smallest.name}: tool-calling capability verified`
      };
    }
  }

  if (task === 'completion') {
    const coders = models.filter((m) => m.capabilities?.codeCompletion);
    if (coders.length) {
      const smallest = [...coders].sort((a, b) => (a.size || 0) - (b.size || 0))[0];
      return {
        model: smallest,
        reason: `Auto selected ${smallest.displayName || smallest.name}: lightweight, fast code completions`
      };
    }
  }

  if (task === 'edit') {
    const editCapable = models.filter((m) => m.capabilities?.codeCompletion || m.capabilities?.toolCalling);
    if (editCapable.length) {
      return {
        model: editCapable[0],
        reason: `Auto selected ${editCapable[0].displayName || editCapable[0].name}: specialized for code editing`
      };
    }
  }

  if (task === 'chat') {
    const chatCapable = models.filter((m) => m.capabilities?.chat !== false);
    if (chatCapable.length) {
      return {
        model: chatCapable[0],
        reason: `Auto selected ${chatCapable[0].displayName || chatCapable[0].name} for conversation`
      };
    }
  }

  return {
    model: models[0],
    reason: `Fallback to default: ${models[0].displayName || models[0].name}`
  };
}

export class ModelRouter {
  constructor(private readonly getModelsFn: () => LocalModel[]) {}

  public route(
    task: TaskType,
    userSelection?: string,
    preferences?: ModelPreferences
  ): { modelId: string; reason: string; model?: LocalModel } {
    const models = this.getModelsFn();
    const res = routeModelWithReason(models, task, preferences, userSelection);
    if (!res && userSelection && userSelection.toLowerCase() !== 'auto') {
      return {
        modelId: userSelection,
        reason: `Explicitly selected model "${userSelection}" is not registered.`,
        model: undefined
      };
    }
    return {
      modelId: res?.model?.id || res?.model?.name || userSelection || '',
      reason: res?.reason ?? 'Fallback to default',
      model: res?.model
    };
  }
}
