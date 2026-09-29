# LocalForge Agent Runtime Specification

**Version:** LocalForge v0.2.0 Autonomous Engineering Operating System  
**Classification:** Core Runtime Architecture  
**Date:** September 2026  

---

## 1. Runtime State Machine & Lifecycle Transitions

The LocalForge Agent Runtime implements a deterministic, strictly validated finite state machine. Impossible state transitions (e.g. jumping from `IDLE` to `APPLYING` without `PLANNING` or `EXECUTING`) are rejected at the runtime boundary.

### Canonical State Diagram

```
                 +--------------------------------+
                 |              IDLE              |
                 +--------------------------------+
                                 |
                                 v
                 +--------------------------------+
                 |          INITIALIZING          |
                 +--------------------------------+
                                 |
                                 v
                 +--------------------------------+
                 |          DISCOVERING           |
                 +--------------------------------+
                                 |
                                 v
                 +--------------------------------+
                 |        CONTEXT_BUILDING        |
                 +--------------------------------+
                                 |
                                 v
                 +--------------------------------+
                 |            PLANNING            |
                 +--------------------------------+
                                 |
                                 v
        +------->+--------------------------------+
        |        |           EXECUTING            |
        |        +--------------------------------+
        |                        |
        |                        v
        |        +--------------------------------+
        |        |           OBSERVING            |
        |        +--------------------------------+
        |                        |
        |                        v
        |        +--------------------------------+
        |        |           REASONING            |
        |        +--------------------------------+
        |                        |
        |       +----------------+----------------+
        |       |                                 |
        |       v                                 v
        | +-----------+                 +--------------------+
        | | REPAIRING |                 |      APPLYING      |
        | +-----------+                 +--------------------+
        |       ^                                 |
        |       |                                 v
        |       +-----------------------+--------------------+
        |       | Test Failure          |     VALIDATING     |
        |                               +--------------------+
        |                                         |
        |                                         v
        |                               +--------------------+
        |                               |WAITING_FOR_APPROVAL|
        |                               +--------------------+
        |                                         |
        +-----------------------------------------+
                                 |
         +-----------------------+-----------------------+
         |                       |                       |
         v                       v                       v
   +-----------+           +-----------+           +-----------+
   | COMPLETED |           |  FAILED   |           | CANCELLED |
   +-----------+           +-----------+           +-----------+
```

### Every Transition Produces: `AgentLifecycleEvent`
```typescript
export interface AgentLifecycleEvent {
  runId: string;
  parentRunId?: string;
  taskId: string;
  agentId: string;
  role: AgentRole;
  state: AgentLifecycleState;
  timestamp: number;
  duration?: number;
  metadata?: Record<string, unknown>;
  reason?: string;
}
```

---

## 2. The Verification & Bounded Repair Loop

A core capability of an autonomous software engineering agent is the ability to detect failures, formulate hypotheses, apply surgical repairs, and re-verify until green.

### Repair Loop Algorithm:
1. **Change Application:** Agent generates unified diff and applies change via `EditEngine`.
2. **Execution of Validation:** `ValidationEngine` runs the target test command (`npm test`, `cargo test`, `pytest`).
3. **Observation Parsing:** If tests fail, output is parsed into a structured `FailureObservation`:
   - `command`, `exitCode`, `stdout`, `stderr`, `file`, `line`, `category`, `probableCause`.
   - Categories: `compile_error`, `lint_error`, `test_failure`, `runtime_error`, `dependency_failure`, `environment_failure`, `permission_failure`, `timeout`, `model_failure`, `tool_failure`.
4. **Targeted Repair Prompt:** A specialized `Debugger` or `Coder` subagent receives the failure observation with line windowing.
5. **Bounded Iteration:** Maximum repair attempts: `maxRepairAttempts = 5`.
6. **Final Verdict:** If tests pass, state transitions to `VALIDATING -> COMPLETED`. If repairs exhaust `maxRepairAttempts`, state transitions to `FAILED` with reproduction details.

---

## 3. Cooperative Cancellation & Timeout Architecture

1. **Top-Level Cancellation:** When the user clicks Stop or runs `/cancel`, the active `AbortController` triggers an abort event on the root `signal`.
2. **Cascade to Children:**
   - In-flight model HTTP streams (`http.ClientRequest`) are immediately aborted via `req.destroy()`.
   - Active subagents in `AgentPool` are aborted in parallel.
   - Running terminal processes are killed via OS-level process tree termination (`taskkill /pid ... /T /F` on Windows; negative PID `process.kill(-pid, 'SIGTERM')` on POSIX).
3. **Guaranteed Cleanup:** No orphan processes, dangling sockets, or locked files survive cancellation.

---

## 4. Structured Error System

All runtime failures are wrapped in typed classes extending `LocalForgeError`:
- `ModelError`: Malformed output, unreachable endpoint, or model context limit exceeded.
- `ProviderError`: Connection reset, HTTP 500/503, authentication failure.
- `ToolError`: Tool execution failure or argument schema mismatch.
- `TerminalError`: Non-zero exit codes, command timeout, or process execution crashes.
- `FileError`: Stale file detection, missing target content, or permission errors.
- `PermissionError`: Action rejected by policy or user denial.
- `TimeoutError`: Exceeded tool, model, or overall task execution timeout.
- `CancellationError`: Explicit user cancellation.
- `WorkspaceError`: Path outside workspace boundary or untrusted workspace restriction.
- `GitError`: Uncommitted merge conflict or failure to checkout/commit.
