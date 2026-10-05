export type AgentEffort = 'low' | 'medium' | 'high' | 'ultra';

export function isAgentEffort(value: unknown): value is AgentEffort {
  return typeof value === 'string' && ['low', 'medium', 'high', 'ultra'].includes(value);
}

export function resolveEffortBudget(effort: AgentEffort = 'medium', configured: { contextWindow?: number; maxOutputTokens?: number; maxRounds?: number; historyCharacters?: number } = {}) {
  const profiles = { low: { context: 4096, output: 2048, rounds: 24 }, medium: { context: 8192, output: 4096, rounds: 80 }, high: { context: 16384, output: 8192, rounds: 160 }, ultra: { context: Infinity, output: Infinity, rounds: Infinity } };
  if (!isAgentEffort(effort)) throw new Error('Select Low, Medium, High or Ultra effort.');
  if (configured.contextWindow !== undefined && (!Number.isInteger(configured.contextWindow) || configured.contextWindow < 2048) || configured.maxOutputTokens !== undefined && (!Number.isInteger(configured.maxOutputTokens) || configured.maxOutputTokens < -1) || configured.maxRounds !== undefined && (!Number.isInteger(configured.maxRounds) || configured.maxRounds < 0) || configured.historyCharacters !== undefined && (!Number.isInteger(configured.historyCharacters) || configured.historyCharacters < 4000)) throw new Error('Effort budgets require valid finite context, output, round and history settings.');
  const profile = profiles[effort];
  const contextWindow = Math.min(configured.contextWindow ?? 8192, profile.context);
  const output = configured.maxOutputTokens ?? -1;
  const maxOutputTokens = output === -1 ? Number.isFinite(profile.output) ? profile.output : -1 : Math.min(output, profile.output);
  const rounds = configured.maxRounds ?? 80;
  return { effort, contextWindow, maxOutputTokens, maxRounds: rounds === 0 || effort === 'ultra' ? 0 : Math.min(rounds, profile.rounds), historyCharacters: Math.min(configured.historyCharacters ?? 48000, contextWindow * 3) };
}
