import { EventEmitter } from 'events';
import { RunStateMachine } from './runStateMachine';
import { RunBudgetManager } from './runBudget';
import { CancellationNode, CancellationTree } from './cancellationTree';
import { ResourceLeaseManager } from './resourceLeaseManager';
import {
  createRunId,
  RunBudget,
  RunManifest,
  RunState
} from './types';

export interface ActiveRunContext {
  manifest: RunManifest;
  stateMachine: RunStateMachine;
  budgetManager: RunBudgetManager;
  cancellationNode: CancellationNode;
  startedAt: number;
}

export class RunManager extends EventEmitter {
  private readonly runs = new Map<string, ActiveRunContext>();
  private readonly cancellationTree = new CancellationTree('run_manager_root');
  public readonly leaseManager = new ResourceLeaseManager();
  private activeRunId?: string;

  public startRun(
    goal: string,
    options?: {
      budget?: Partial<RunBudget>;
      executionTier?: string;
      mode?: string;
      workspaceFingerprint?: string;
    }
  ): ActiveRunContext {
    // If an active run is currently executing, throw or pause
    if (this.activeRunId) {
      const active = this.runs.get(this.activeRunId);
      if (active && !active.stateMachine.isTerminal()) {
        throw new Error(`Another run "${this.activeRunId}" is currently active. Cancel or complete it first.`);
      }
    }

    const runId = createRunId();
    const stateMachine = new RunStateMachine(runId, 'idle');
    const budgetManager = new RunBudgetManager(options?.budget);
    const cancellationNode = this.cancellationTree.createChild({
      id: runId,
      name: `Run ${runId}`,
      timeoutMs: options?.budget?.maxDurationMs
    });

    const manifest: RunManifest = {
      schemaVersion: 1,
      runId,
      goal,
      mode: options?.mode ?? 'autonomous',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      workspaceFingerprint: options?.workspaceFingerprint ?? 'default',
      executionTier: options?.executionTier ?? 'workspace_host',
      status: 'idle',
      budget: budgetManager.getBudget(),
      evidenceIds: []
    };

    const context: ActiveRunContext = {
      manifest,
      stateMachine,
      budgetManager,
      cancellationNode,
      startedAt: Date.now()
    };

    stateMachine.on('transition', (evt) => {
      manifest.status = evt.to;
      manifest.updatedAt = Date.now();
      this.emit('run_state_changed', { runId, ...evt });
    });

    budgetManager.on('budget_violation', (violation) => {
      this.emit('budget_violation', { runId, violation });
      this.failRun(runId, new Error(violation.message));
    });

    cancellationNode.signal.addEventListener(
      'abort',
      () => {
        if (!stateMachine.isTerminal()) {
          try {
            stateMachine.transitionTo('cancelled', 'cancellation_signal_received');
          } catch {
            // Already in terminal state
          }
        }
        void this.leaseManager.releaseAllForRun(runId);
      },
      { once: true }
    );

    stateMachine.transitionTo('initializing', 'run_started');
    this.runs.set(runId, context);
    this.activeRunId = runId;
    this.emit('run_started', { runId, goal });

    return context;
  }

  public getRun(runId: string): ActiveRunContext | undefined {
    return this.runs.get(runId);
  }

  public getActiveRun(): ActiveRunContext | undefined {
    return this.activeRunId ? this.runs.get(this.activeRunId) : undefined;
  }

  public getActiveRunId(): string | undefined {
    return this.activeRunId;
  }

  public async cancelRun(runId: string, reason = 'user_cancelled'): Promise<void> {
    const run = this.runs.get(runId);
    if (!run) return;

    run.cancellationNode.cancel(new Error(reason));
    if (!run.stateMachine.isTerminal()) {
      try {
        run.stateMachine.transitionTo('cancelled', reason);
      } catch {
        // Ignore if already transitioning
      }
    }
    await this.leaseManager.releaseAllForRun(runId);
    if (this.activeRunId === runId) {
      this.activeRunId = undefined;
    }
  }

  public async completeRun(runId: string): Promise<void> {
    const run = this.runs.get(runId);
    if (!run) return;

    if (run.stateMachine.canTransitionTo('completed')) {
      run.stateMachine.transitionTo('completed', 'run_succeeded');
    }
    await this.leaseManager.releaseAllForRun(runId);
    if (this.activeRunId === runId) {
      this.activeRunId = undefined;
    }
  }

  public async failRun(runId: string, error: Error): Promise<void> {
    const run = this.runs.get(runId);
    if (!run) return;

    run.cancellationNode.cancel(error);
    if (run.stateMachine.canTransitionTo('failed')) {
      run.stateMachine.transitionTo('failed', error.message, { error: error.stack });
    }
    await this.leaseManager.releaseAllForRun(runId);
    if (this.activeRunId === runId) {
      this.activeRunId = undefined;
    }
  }

  public async dispose(): Promise<void> {
    this.cancellationTree.cancelAll('run_manager_disposed');
    await this.leaseManager.releaseAll();
    this.cancellationTree.dispose();
    this.runs.clear();
    this.activeRunId = undefined;
  }
}
