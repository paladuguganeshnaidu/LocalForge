import { EventEmitter } from 'events';
import { RunState, RunStateTransitionEvent } from './types';

const ALLOWED_TRANSITIONS: Record<RunState, readonly RunState[]> = {
  idle: ['initializing'],
  initializing: ['planning', 'failed', 'cancelled'],
  planning: ['executing', 'recovering', 'failed', 'cancelled'],
  executing: ['paused', 'recovering', 'completed', 'failed', 'cancelled'],
  paused: ['executing', 'cancelled', 'failed'],
  recovering: ['executing', 'planning', 'failed', 'cancelled'],
  completed: ['idle'],
  failed: ['idle', 'recovering'],
  cancelled: ['idle']
};

export class RunStateMachine extends EventEmitter {
  private readonly runId: string;
  private currentState: RunState;
  private readonly history: RunStateTransitionEvent[] = [];

  constructor(runId: string, initialState: RunState = 'idle') {
    super();
    this.runId = runId;
    this.currentState = initialState;
    this.history.push({
      runId,
      from: initialState,
      to: initialState,
      timestamp: Date.now(),
      reason: 'initialization'
    });
  }

  public getRunId(): string {
    return this.runId;
  }

  public getState(): RunState {
    return this.currentState;
  }

  public getHistory(): readonly RunStateTransitionEvent[] {
    return [...this.history];
  }

  public isTerminal(): boolean {
    return this.currentState === 'completed' || this.currentState === 'failed' || this.currentState === 'cancelled';
  }

  public canTransitionTo(targetState: RunState): boolean {
    const allowed = ALLOWED_TRANSITIONS[this.currentState];
    return allowed.includes(targetState);
  }

  public transitionTo(
    targetState: RunState,
    reason?: string,
    metadata?: Record<string, unknown>
  ): RunStateTransitionEvent {
    if (!this.canTransitionTo(targetState)) {
      throw new Error(
        `Illegal state transition for run "${this.runId}": cannot transition from "${this.currentState}" to "${targetState}". Allowed targets: [${ALLOWED_TRANSITIONS[this.currentState].join(', ')}]`
      );
    }

    const previousState = this.currentState;
    this.currentState = targetState;

    const event: RunStateTransitionEvent = {
      runId: this.runId,
      from: previousState,
      to: targetState,
      timestamp: Date.now(),
      reason,
      metadata
    };

    this.history.push(event);
    this.emit('transition', event);
    this.emit(`state:${targetState}`, event);

    return event;
  }

  public reset(): void {
    if (!this.isTerminal()) {
      throw new Error(`Cannot reset non-terminal run state: current state is "${this.currentState}"`);
    }
    this.transitionTo('idle', 'manual_reset');
  }
}
