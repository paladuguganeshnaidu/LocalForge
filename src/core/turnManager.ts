import { AgentMode } from '../agent/agentLoop';
import { Artifact } from './artifactManager';

export type ExecutionStrategy = 'fast' | 'planning';

export type ActivityCategory =
  | 'Planning'
  | 'Searching'
  | 'Reading'
  | 'Working'
  | 'Optimising'
  | 'Editing'
  | 'Running'
  | 'Browser'
  | 'Waiting for approval'
  | 'Validating'
  | 'Repairing'
  | 'Completed'
  | 'Failed'
  | 'Cancelled';

export type ActivityStatus =
  | 'started'
  | 'running'
  | 'success'
  | 'warning'
  | 'error'
  | 'cancelled'
  | 'waiting_for_approval';

export interface TurnActivity {
  id: string;
  category: ActivityCategory;
  title: string;
  details?: string;
  toolName?: string;
  targetPath?: string;
  inputSummary?: string;
  outputSummary?: string;
  durationMs?: number;
  status: ActivityStatus;
  resultSummary?: string;
  error?: string;
  timestamp: number;
}

export interface AgentTurn {
  turnId: string;
  turnNumber: number;
  conversationId: string;
  historyEpoch?: string;
  modelId: string;
  mode: AgentMode;
  strategy: ExecutionStrategy;
  activities: TurnActivity[];
  artifacts: Artifact[];
  filesChanged: string[];
  status: 'running' | 'waiting_for_approval' | 'completed' | 'failed' | 'cancelled';
  startedAt: number;
  completedAt?: number;
  proposalId?: string;
}

export class TurnManager {
  private turns = new Map<string, AgentTurn>();
  private conversationTurns = new Map<string, string[]>(); // conversationId -> turnId[]

  constructor(private readonly onChange?: () => void) {}

  public startTurn(params: {
    conversationId: string;
    historyEpoch?: string;
    modelId: string;
    mode: AgentMode;
    strategy: ExecutionStrategy;
  }): AgentTurn {
    const turnId = `turn-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const history = this.conversationTurns.get(params.conversationId) || [];
    const turnNumber = history.length + 1;

    const turn: AgentTurn = {
      turnId,
      turnNumber,
      conversationId: params.conversationId,
      historyEpoch: params.historyEpoch,
      modelId: params.modelId,
      mode: params.mode,
      strategy: params.strategy,
      activities: [],
      artifacts: [],
      filesChanged: [],
      status: 'running',
      startedAt: Date.now()
    };

    this.turns.set(turnId, turn);
    this.conversationTurns.set(params.conversationId, [...history, turnId]);
    this.onChange?.();
    return turn;
  }

  public getTurn(turnId: string): AgentTurn | undefined {
    return this.turns.get(turnId);
  }

  public getTurnsForConversation(conversationId: string): AgentTurn[] {
    const ids = this.conversationTurns.get(conversationId) || [];
    return ids.map((id) => this.turns.get(id)!).filter(Boolean);
  }

  public purgeConversation(conversationId: string): void {
    for (const id of this.conversationTurns.get(conversationId) ?? []) this.turns.delete(id);
    this.conversationTurns.delete(conversationId);
    this.onChange?.();
  }

  public addActivity(
    turnId: string,
    activity: Omit<TurnActivity, 'id' | 'timestamp'> & { id?: string }
  ): TurnActivity {
    const turn = this.turns.get(turnId);
    const item: TurnActivity = {
      ...activity,
      id: activity.id || `act-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      timestamp: Date.now()
    };
    if (turn) {
      turn.activities.push(item);
      this.onChange?.();
    }
    return item;
  }

  public updateActivity(
    turnId: string,
    activityId: string,
    updates: Partial<Omit<TurnActivity, 'id'>>
  ): TurnActivity | undefined {
    const turn = this.turns.get(turnId);
    if (!turn) return undefined;
    const activity = turn.activities.find((a) => a.id === activityId);
    if (!activity) return undefined;

    Object.assign(activity, updates);
    this.onChange?.();
    return activity;
  }

  public addArtifact(turnId: string, artifact: Artifact): void {
    const turn = this.turns.get(turnId);
    if (turn) {
      turn.artifacts.push(artifact);
    }
  }

  public completeTurn(
    turnId: string,
    status: AgentTurn['status'] = 'completed',
    filesChanged: string[] = []
  ): void {
    const turn = this.turns.get(turnId);
    if (turn) {
      turn.status = status;
      turn.completedAt = Date.now();
      turn.filesChanged = Array.from(new Set([...turn.filesChanged, ...filesChanged]));
      this.onChange?.();
    }
  }

  public getPersistedHistory(maxTurns = 12): AgentTurn[] {
    return Array.from(this.conversationTurns.values())
      .flatMap((ids) => ids.map((id) => this.turns.get(id)).filter((turn): turn is AgentTurn => Boolean(turn)))
      .sort((left, right) => left.startedAt - right.startedAt)
      .slice(-maxTurns)
      .map((turn) => ({
        ...turn,
        activities: turn.activities.slice(-20).map((activity) => ({
          ...activity,
          title: activity.title.slice(0, 200),
          details: activity.details?.slice(0, 3000),
          targetPath: activity.targetPath?.slice(0, 500),
          inputSummary: activity.inputSummary?.slice(0, 4000),
          outputSummary: activity.outputSummary?.slice(0, 8000),
          resultSummary: activity.resultSummary?.slice(0, 300),
          error: activity.error?.slice(0, 500)
        })),
        artifacts: [],
        filesChanged: turn.filesChanged.slice(0, 100)
      }));
  }

  public restorePersistedHistory(value: unknown): void {
    if (!Array.isArray(value)) return;
    const restored: AgentTurn[] = [];
    for (const candidate of value.slice(-12)) {
      if (!candidate || typeof candidate !== 'object') continue;
      const item = candidate as Record<string, unknown>;
      if (typeof item.turnId !== 'string' || typeof item.conversationId !== 'string' ||
        typeof item.modelId !== 'string' || !['ask', 'plan', 'agent'].includes(String(item.mode)) ||
        !['fast', 'planning'].includes(String(item.strategy)) || !Array.isArray(item.activities) ||
        typeof item.startedAt !== 'number') continue;

      const activities: TurnActivity[] = item.activities.slice(-20).flatMap((raw): TurnActivity[] => {
        if (!raw || typeof raw !== 'object') return [];
        const activity = raw as Record<string, unknown>;
        if (typeof activity.id !== 'string' || typeof activity.title !== 'string' || typeof activity.timestamp !== 'number' ||
          typeof activity.category !== 'string' || typeof activity.status !== 'string') return [];
        return [{
          id: activity.id.slice(0, 120),
          category: activity.category.slice(0, 60) as ActivityCategory,
          title: activity.title.slice(0, 200),
          details: typeof activity.details === 'string' ? activity.details.slice(0, 3000) : undefined,
          toolName: typeof activity.toolName === 'string' ? activity.toolName.slice(0, 100) : undefined,
          targetPath: typeof activity.targetPath === 'string' ? activity.targetPath.slice(0, 500) : undefined,
          inputSummary: typeof activity.inputSummary === 'string' ? activity.inputSummary.slice(0, 4000) : undefined,
          outputSummary: typeof activity.outputSummary === 'string' ? activity.outputSummary.slice(0, 8000) : undefined,
          durationMs: typeof activity.durationMs === 'number' ? activity.durationMs : undefined,
          status: activity.status.slice(0, 40) as ActivityStatus,
          resultSummary: typeof activity.resultSummary === 'string' ? activity.resultSummary.slice(0, 300) : undefined,
          error: typeof activity.error === 'string' ? activity.error.slice(0, 500) : undefined,
          timestamp: activity.timestamp
        }];
      });

      const status = ['running', 'waiting_for_approval', 'completed', 'failed', 'cancelled'].includes(String(item.status))
        ? item.status as AgentTurn['status'] : 'failed';
      const interrupted = status === 'running';
      if (interrupted) {
        activities.push({
          id: `${item.turnId}-interrupted`,
          category: 'Cancelled',
          title: 'Run interrupted when VS Code closed',
          status: 'cancelled',
          timestamp: Date.now()
        });
      }
      restored.push({
        turnId: item.turnId.slice(0, 120),
        turnNumber: typeof item.turnNumber === 'number' ? item.turnNumber : restored.length + 1,
        conversationId: item.conversationId.slice(0, 200),
        historyEpoch: typeof item.historyEpoch === 'string' ? item.historyEpoch.slice(0, 120) : undefined,
        modelId: item.modelId.slice(0, 200),
        mode: item.mode as AgentTurn['mode'],
        strategy: item.strategy as ExecutionStrategy,
        activities,
        artifacts: [],
        filesChanged: Array.isArray(item.filesChanged) ? item.filesChanged.filter((path): path is string => typeof path === 'string').slice(0, 100) : [],
        status: interrupted ? 'cancelled' : status,
        startedAt: item.startedAt,
        completedAt: interrupted ? Date.now() : typeof item.completedAt === 'number' ? item.completedAt : undefined
      });
    }

    this.turns.clear();
    this.conversationTurns.clear();
    for (const turn of restored) {
      this.turns.set(turn.turnId, turn);
      const history = this.conversationTurns.get(turn.conversationId) || [];
      history.push(turn.turnId);
      this.conversationTurns.set(turn.conversationId, history);
    }
  }
}
