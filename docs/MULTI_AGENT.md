# LocalForge Multi-Agent Orchestration Specification

**Version:** LocalForge v0.2.0 Autonomous Engineering Operating System  
**Classification:** Multi-Agent Architecture  
**Date:** September 2026  

---

## 1. Multi-Agent Philosophy: True Decomposition

Rather than forcing a single model prompt to act as architect, coder, tester, reviewer, and debugger simultaneously (which rapidly leads to hallucinations and context explosion), LocalForge employs a **multi-agent operating system architecture**.

The user interacts with an autonomous **Orchestrator**, which decomposes high-level goals into a Directed Acyclic Graph (DAG) of specialized tasks, executed by a pool of dedicated subagents with scoped contexts and machine-readable handoffs.

---

## 2. The 12 Built-in Specialized Agent Roles

| Role Identifier | Display Name | Tool Capabilities | Primary Purpose |
| :--- | :--- | :---: | :--- |
| `orchestrator` | Orchestrator Agent | `read`, `execute` | Decomposes user goals into DAG task graphs and coordinates subagent execution. |
| `planner` | Software Architect / Planner | `read` | Analyzes repository architecture, dependencies, and risks; produces structured plans without mutating workspace. |
| `repository_analyst`| Repository Analyst | `read` | Discovers code patterns, symbols, imports, and framework structures. |
| `researcher` | Technical Researcher | `read` | Analyzes dependency constraints and library usage conventions. |
| `coder` | Principal Coder | `read`, `edit` | Surgically implements code changes and creates files according to plan. |
| `test_engineer` | Test Engineer | `read`, `execute`, `edit` | Runs test suites, writes regression tests, and catalogs execution failures. |
| `debugger` | Root-Cause Debugger | `read`, `execute` | Pinpoints root causes of runtime exceptions, test failures, and build issues. |
| `reviewer` | Senior Code Reviewer | `read` | Performs diff-first code reviews, verifies standards, and detects regressions. |
| `security_reviewer`| Security Reviewer | `read` | Audits code changes for injection flaws, path escapes, and credential exposure. |
| `documentation_agent`| Documentation Specialist| `read`, `edit` | Prepares release notes, walkthrough artifacts, and updates documentation. |
| `git_agent` | Git Specialist | `read`, `execute` | Manages branches, worktrees, staged diffs, and clean atomic commits. |
| `performance_agent`| Performance Engineer | `read`, `execute` | Identifies computational bottlenecks, memory leaks, and redundant I/O. |

---

## 3. Dynamic Task Graph (DAG) Architecture

Work is modeled as an acyclic graph of `TaskGraphNode` instances:

```
Task A: Repository Analysis (repository_analyst)
    |
    v
Task B: Architecture & Implementation Plan (planner)
    |
    +------------------------+
    |                        |
    v                        v
Task C: Backend Auth (coder) Task D: Frontend Auth (coder)
    |                        |
    +------------+-----------+
                 |
                 v
Task E: Automated Test Suite (test_engineer)
                 |
                 +---> (Failure) ---> Task F: Debugger & Repair (debugger + coder)
                 |
                 v (Pass)
Task G: Security Review & Regression Audit (security_reviewer + reviewer)
                 |
                 v
Task H: Final Walkthrough & Verification (documentation_agent)
```

### Key Capabilities of `TaskGraph`:
- **Topological Execution Ordering:** Evaluates task dependencies before dispatching.
- **Cycle Detection:** Strict cycle detection rejects circular dependency graphs.
- **Priority Scheduling:** Dispatches ready tasks in order of urgency (`urgent` > `high` > `medium` > `low`).
- **File Conflict Detection:** Parallel subagents are prevented from concurrently modifying overlapping files, preventing file race conditions.
- **Failure Propagation:** When a non-retryable task fails, all downstream dependent nodes are marked `blocked` while independent parallel tracks continue safely.

---

## 4. Context Isolation & Typed Handoff Protocol

Subagents **never** receive the entire repository or the entire history of all other agents. Each subagent receives an isolated, scoped `AgentContext` containing only relevant symbols, target files, and prior structured handoffs:

### 1. `PlannerHandoff`:
```typescript
{
  taskId: string;
  summary: string;
  assumptions: string[];
  affectedFiles: string[];
  acceptanceCriteria: string[];
  risks: string[];
  recommendedAgents: AgentRole[];
  orderedSubtasks: Array<{ id: string; role: AgentRole; dependencies: string[]; targetFiles: string[] }>;
}
```

### 2. `CoderHandoff`:
```typescript
{
  taskId: string;
  changedFiles: string[];
  operations: Array<{ type: 'create' | 'modify' | 'delete'; path: string }>;
  testsAdded: string[];
  knownIssues: string[];
  remainingRisks: string[];
  summary: string;
}
```

### 3. `TesterHandoff`:
```typescript
{
  taskId: string;
  testsRun: number;
  passed: boolean;
  failedCount: number;
  failures: FailureObservation[];
  summary: string;
}
```

### 4. `ReviewerHandoff`:
```typescript
{
  taskId: string;
  findings: ReviewFinding[];
  severity: 'clean' | 'warnings' | 'rejected';
  affectedFiles: string[];
  requiredChanges: string[];
  approved: boolean;
  summary: string;
}
```

---

## 5. Crash Resilience & Checkpoint Persistence

All multi-agent executions maintain checkpoints in VS Code `workspaceState` via `CheckpointManager`. If VS Code restarts or the extension reloads mid-task, LocalForge detects the in-flight checkpoint, restores the `TaskGraph`, validates the current workspace state against recorded file hashes, and safely resumes execution.
