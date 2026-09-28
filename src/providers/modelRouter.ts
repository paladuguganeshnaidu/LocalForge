import { LocalModel } from './modelProvider';

export type ModelTask = 'chat' | 'edit' | 'agent' | 'completion';
export type ModelPreferences = Partial<Record<ModelTask, string>>;

export function routeModel(
  models: LocalModel[],
  task: ModelTask,
  preferences: ModelPreferences = {},
  userSelection?: string
): LocalModel | undefined {
  const configured = preferences[task];
  const find = (value?: string) => value ? models.find((model) =>
    model.name === value || model.displayName === value || model.providerId === value
  ) : undefined;
  return find(configured) ?? find(userSelection) ?? models[0];
}
