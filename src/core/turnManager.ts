import { AgentMode } from '../agent/agentLoop';
import { Artifact } from './artifactManager';

export type ExecutionStrategy = 'fast' | 'planning';

export type ActivityCategory =
  | 'Thinking'
  | 'Working'
  | 'Searching'
  | 'Reading'
  | 'Planning'
  | 'Editing'
  | 'Waiting for approval'
  | 'Applying changes'
  | 'Running'
  | 'Verifying'
  | 'Browser'
  | 'Completed'
  | 'Failed'
  | 'Cancelled';

export interface TurnActivity {
  id: string;
  category: ActivityCategory;
  title: string;
  details?: string;
  toolName?: string;
  targetPath?: string;
  durationMs?: number;
  status: 'running' | 'success' | 'error';
  timestamp: number;
}

export interface AgentTurn {
  turnId: string;
  turnNumber: number;
  conversationId: string;
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

  public startTurn(params: {
    conversationId: string;
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
    return turn;
  }

  public getTurn(turnId: string): AgentTurn | undefined {
    return this.turns.get(turnId);
  }

  public getTurnsForConversation(conversationId: string): AgentTurn[] {
    const ids = this.conversationTurns.get(conversationId) || [];
    return ids.map((id) => this.turns.get(id)!).filter(Boolean);
  }

  public addActivity(
    turnId: string,
    activity: Omit<TurnActivity, 'id' | 'timestamp'>
  ): TurnActivity {
    const turn = this.turns.get(turnId);
    const item: TurnActivity = {
      ...activity,
      id: `act-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      timestamp: Date.now()
    };
    if (turn) {
      turn.activities.push(item);
    }
    return item;
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
    }
  }
}
