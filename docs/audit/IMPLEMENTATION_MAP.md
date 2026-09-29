# LocalForge Architecture Implementation Map

**Target:** LocalForge Autonomous Engineering Agent Runtime  
**Version Horizon:** v0.1.7 -> v0.2.0 Production Release  
**Auditor:** Principal Engineer & Systems Architect  

---

## 1. Architectural Transformation Blueprint

The architectural goal is to transform LocalForge from an interactive single-agent assistant into a **genuine, local-first autonomous software engineering operating system**.

### The Autonomous Execution Pipeline

```
USER REQUEST
    |
    v
LOCALFORGE UI (VS Code Secondary Sidebar)
    |
    v
AGENT ORCHESTRATOR
    |
    +---> 1. DYNAMIC TASK GRAPH (DAG of subtasks)
    |
    +---> 2. SPECIALIZED AGENT POOL (Planner, Analyst, Coder, Tester, Reviewer, Security)
    |
    +---> 3. TARGETED CONTEXT DISCOVERY (Symbols, References, Git status, Diffs)
    |
    +---> 4. CANONICAL MODEL ROUTING (Local Ollama / LM Studio / Remote GPU)
    |
    +---> 5. SCHEMA-VALIDATED TOOL EXECUTION (35+ Workspace, Git, Terminal, Diagnostic Tools)
    |
    +---> 6. REPAIR LOOP (Run tests -> parse failure -> repair code -> retest)
    |
    +---> 7. TRANSACTIONAL EDIT APPLICATION (Unified diffs -> rollback journal -> approval)
    |
    v
FINAL VERIFIED RESULT (Walkthrough Artifact & Production Diff)
```

---

## 2. Implementation Phases & Work Breakdown Structure

### Phase B: Remove Architectural Duplication & Dead Code
- Remove deprecated re-export shims (`src/features/completionProvider.ts`).
- Unify legacy `runToolAgent` callers in `src/agent/toolAgent.ts` directly into `AgentLoop` and the new multi-agent orchestrator.
- Consolidate model identity formats into canonical `ModelRef.id` (`providerId:modelName`).

### Phase C: Canonical Contracts & Core Interfaces
- Define universal `AgentLifecycleEvent` with strict state transitions:
  `IDLE -> INITIALIZING -> DISCOVERING -> CONTEXT_BUILDING -> PLANNING -> EXECUTING -> OBSERVING -> REASONING -> APPLYING -> VALIDATING -> REPAIRING -> WAITING_FOR_APPROVAL -> COMPLETED | FAILED | CANCELLED | TIMED_OUT`.
- Define typed agent handoff contracts (`AgentHandoff`, `TaskResult`, `FailureObservation`).
- Define structured error classes: `ModelError`, `ToolError`, `TerminalError`, `SecurityError`, `CheckpointError`.

### Phase D: Canonical Agent Runtime Engine
- Build `AgentManager` and `AgentPool` to manage active subagent lifecycles.
- Implement strict cancellation propagation across all active child tasks, tools, and processes.
- Implement bounded timeouts for individual tool executions and overall task runs.

### Phase E: Real Tool Registry Expansion (35+ Tools)
- Expand `ToolRegistry` to register and schema-validate 35+ core tools:
  - **Filesystem Tools:** `read_file`, `read_files`, `write_file`, `create_file`, `apply_patch`, `replace_range`, `delete_file`, `move_file`, `rename_file`, `list_directory`.
  - **Search & Symbol Tools:** `search_text`, `search_files`, `symbol_search`, `workspace_search`.
  - **Git Tools:** `git_status`, `git_diff`, `git_log`, `git_show`, `git_branch`, `git_checkout`, `git_commit`, `git_restore`.
  - **Execution & Process Tools:** `run_command`, `run_test`, `run_lint`, `run_build`.
  - **Project & Diagnostic Tools:** `detect_language`, `inspect_project`, `inspect_dependencies`, `get_diagnostics`, `get_editor_context`, `get_open_file`, `get_selection`, `create_artifact`.
  - **Browser Tools:** `browser_open`, `browser_snapshot`, `browser_click`, `browser_type`, `browser_extract` (capability-gated).

### Phase F: Hardened Filesystem & Atomic Edit Engine
- Integrate `validateRelativeWorkspacePath` with Windows device path and UNC guards.
- Implement transactional two-phase write engine with an in-memory rollback journal.
- Add surgical range replacement (`replace_range`) and multi-file patch validation.

### Phase G: Terminal & Process Engine
- Enforce strict process tree cleanup on Windows and POSIX.
- Implement `CommandPolicy` with automatic classification: `READ_ONLY`, `LOW_RISK_WRITE`, `HIGH_RISK_WRITE`, `DESTRUCTIVE`, `NETWORK`, `PRIVILEGED`.
- Stream terminal output chunks in real-time to active activities.

### Phase H: Model Layer & Provider Normalization
- Formalize canonical `ModelRef` across all providers.
- Implement local hardware discovery (local GPU, VRAM, CPU, RAM) to complement remote GPU discovery.
- Implement intelligent multi-model routing matching task requirements to model capabilities.

### Phase I: Universal Protocol Normalization & Streaming
- Enhance `ToolCallParser` to parse streaming tool-call deltas, nested function calls, and array calls.
- Enforce clean separation of reasoning (`<think>`) from user-visible responses.

### Phase J: Context Management & Persistent Indexing
- Expand `WorkspaceIndexer` to maintain lightweight symbol tables.
- Token budget enforcement ensuring context never exceeds model context windows.

### Phase K: Multi-Agent Orchestration Subsystem
- Implement `TaskGraph`: Directed Acyclic Graph (DAG) supporting sequential and parallel subtasks.
- Implement 12 specialized agent roles:
  1. `OrchestratorAgent`
  2. `PlannerAgent`
  3. `RepositoryAnalystAgent`
  4. `ResearcherAgent`
  5. `CoderAgent`
  6. `TestEngineerAgent`
  7. `DebuggerAgent`
  8. `ReviewerAgent`
  9. `SecurityReviewerAgent`
  10. `DocumentationAgent`
  11. `GitAgent`
  12. `PerformanceAgent`
- Implement file conflict detection preventing concurrent agents from modifying the same file.

### Phase L: Security Hardening & Prompt Injection Defense
- Implement `<untrusted_workspace_data>` isolation tags for all repository inputs.
- Enforce the immutable Trust Hierarchy: `SYSTEM > SECURITY POLICY > USER > TOOL POLICY > WORKSPACE DATA > MODEL OUTPUT`.
- Implement `SecretRedactor` stripping keys and credentials from logs and storage.

### Phase M: Session Checkpointing & Crash Recovery
- Persist `AgentCheckpoint` capturing task graph, agent states, and file hashes in `workspaceState`.
- Support seamless resumption of in-flight tasks following extension reload or crash.

### Phase N: UI Event Stream & Secondary Sidebar Integration
- Bind UI activities directly to real backend events.
- Add multi-agent status visualization (role, task, status, duration, files).

### Phase O: Remote GPU & Local Hardware
- Enhance `RemoteManager` with pinned fingerprint verification and real-time GPU telemetry.
- Support host detection for local accelerators (NVIDIA CUDA, Apple Metal, AMD ROCm).

### Phase P: MCP Integration Boundary
- Normalize external Model Context Protocol (MCP) tools directly into the canonical `ToolRegistry`.

### Phase Q: Inline Code Completion Provider
- Provide low-latency inline code completions via dedicated lightweight models.

### Phase R: Mass Testing Suite Execution
- Implement high-volume test suites:
  - 1,000 tool parser tests
  - 1,000 malformed output tests
  - 1,000 path security tests
  - 1,000 message normalization tests
  - 500 permission & command classification tests
  - 500 cancellation & timeout tests
  - 100 multi-agent DAG execution tests
  - 100 prompt injection defense tests
  - 100 repair loop scenarios

### Phase S & T: Extension Host & Local Model Acceptance
- Execute real VS Code Extension Host integration tests via `@vscode/test-electron`.
- Validate full multi-agent task execution against live Ollama / LM Studio instances.

### Phase U & V: Hardening, Packaging & Release
- Register `localforge.doctor` and `localforge.selfTest` commands.
- Verify clean compilation (`tsc -p ./`), zero warnings, clean packaging (`vsce package`), and generate production documentation.
