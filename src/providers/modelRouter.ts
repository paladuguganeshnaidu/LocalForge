import { LocalModel } from './modelProvider';

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

  const configured = preferences[task];
  const find = (value?: string) => value ? models.find((model) =>
    model.name === value || model.displayName === value || model.providerId === value
  ) : undefined;

  if (configured) {
    const model = find(configured);
    if (model) return { model, reason: `Configured preference for ${task}: ${configured}` };
  }

  if (userSelection && userSelection !== 'auto') {
    const model = find(userSelection);
    if (model) return { model, reason: `User selected: ${model.displayName || model.name}` };
  }

  // Auto capability-based routing
  if (task === 'agent') {
    const capable = models.filter((m) => m.capabilities?.toolCalling);
    if (capable.length) {
      return { model: capable[0], reason: `Auto: Selected ${capable[0].displayName || capable[0].name} for tool-calling capability` };
    }
  }

  if (task === 'completion') {
    const coders = models.filter((m) => m.capabilities?.codeCompletion);
    if (coders.length) {
      const smallest = [...coders].sort((a, b) => (a.size || 0) - (b.size || 0))[0];
      return { model: smallest, reason: `Auto: Selected ${smallest.displayName || smallest.name} for fast code completions` };
    }
  }

  if (task === 'chat' || task === 'edit') {
    const chatCapable = models.filter((m) => m.capabilities?.chat !== false);
    if (chatCapable.length) {
      return { model: chatCapable[0], reason: `Auto: Selected ${chatCapable[0].displayName || chatCapable[0].name} for ${task}` };
    }
  }

  return { model: models[0], reason: `Default fallback to first available model: ${models[0].displayName || models[0].name}` };
}

export class ModelRouter {
  constructor(private readonly getModelsFn: () => LocalModel[]) {}

  public route(
    task: TaskType,
    userSelection?: string,
    preferences?: ModelPreferences
  ): { modelId: string; reason: string } {
    const models = this.getModelsFn();
    const res = routeModelWithReason(models, task, preferences, userSelection);
    return {
      modelId: res?.model?.name ?? userSelection ?? '',
      reason: res?.reason ?? 'Fallback to default'
    };
  }
}
