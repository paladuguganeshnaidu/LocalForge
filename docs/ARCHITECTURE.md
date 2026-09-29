# LocalForge Architecture Specification

**Version:** LocalForge v0.2.0 Autonomous Engineering Operating System  
**Classification:** Core System Architecture  
**Date:** September 2026  

---

## 1. System Vision & Paradigm

LocalForge is an autonomous, local-first software engineering operating system embedded inside Visual Studio Code. Rather than functioning as a superficial chatbot that returns conversational text, LocalForge operates as an **autonomous software engineering runtime**:

```
USER GOAL / TASK
       |
       v
LOCALFORGE UI (VS Code Secondary Sidebar)
       |
       v
ORCHESTRATOR ENGINE (Task Decomposition)
       |
       +---> 1. DYNAMIC TASK GRAPH (DAG of Subtasks & Dependencies)
       |
       +---> 2. SPECIALIZED AGENT POOL (12 Engineering Roles)
       |
       +---> 3. CONTEXT DISCOVERY & TOKEN BUDGETING
       |
       +---> 4. CANONICAL MODEL ROUTING (Ollama, LM Studio, Remote GPU)
       |
       +---> 5. 35+ SCHEMA-VALIDATED TOOLS (Filesystem, Git, Terminal, Diagnostics)
       |
       +---> 6. BOUNDED REPAIR LOOP (Test -> Observe -> Reason -> Repair -> Retest)
       |
       +---> 7. TRANSACTIONAL ATOMIC EDIT ENGINE (Unified Diffs & Rollback Journal)
       |
       v
VERIFIED PRODUCTION DELIVERABLE (Walkthrough Artifact & Git Diff)
```

---

## 2. Core Architectural Principles

1. **The Model is NOT the System:** The LLM is an inference component that proposes actions. The LocalForge runtime owns state, task graph scheduling, tool validation, security policies, workspace access, memory, execution, and verification.
2. **Local-First & Offline-Guaranteed:** All inference, indexing, search, tool execution, and session storage operate 100% locally on localhost (`127.0.0.1`) without external cloud telemetry or mandatory cloud connections.
3. **Instruction / Untrusted Data Separation:** Repository files, READMEs, git diffs, test outputs, and terminal streams are classified as **untrusted workspace data**. They are strictly wrapped in `<untrusted_workspace_data>` tags and cannot alter the system prompt or override security policies.
4. **Patch-First & Atomic Modifications:** File modifications are computed via unified diffs with SHA-256 hash validation. Multi-file edits apply atomically; if any file is stale, the transaction is rejected to prevent silent code corruption.
5. **Real Observability & Zero Fake State:** Every status badge, activity timeline item, token stream, and terminal result maps directly to an active backend process or model event.

---

## 3. Subsystem Breakdown

### 3.1 Multi-Agent Orchestration (`src/agent/orchestration/`)
- `TaskGraph`: Directed Acyclic Graph (DAG) managing task dependencies, topological execution ordering, cycle detection, priorities, and file conflict resolution locks.
- `AgentPool`: Manages active agent instances with concurrency boundaries (default max 4 concurrent agents) and hierarchical cooperative cancellation via `AbortSignal`.
- `AgentManager`: Dispatches subagents with specialized roles, dynamically filters allowed tool categories, and extracts machine-readable typed handoffs.
- `AgentRegistry`: Defines the 12 specialized agent roles (Orchestrator, Planner, Repository Analyst, Researcher, Coder, Test Engineer, Debugger, Reviewer, Security Reviewer, Documentation Agent, Git Agent, Performance Agent).
- `CheckpointManager`: Persists active task graph state, agent states, and file modifications in `workspaceState` to guarantee crash resilience and resumption.

### 3.2 Tool Registry & Execution Layer (`src/agent/`)
- `ToolRegistry`: Central authority for tool discovery, schema validation, risk classification (`read_only`, `low_risk`, `high_risk`, `destructive`, `network`, `privileged`), timeout handling, and secret redaction.
- `CoreTools`: 35+ core tools covering workspace filesystem operations, Git inspection and commits, terminal process execution, compiler diagnostics, and capability-gated browser automation.
- `PermissionManager`: Enforces user-configured policy modes (`request_review`, `allow_safe_auto`, `always_proceed`) and validates shell command safety.

### 3.3 Model Layer & Protocol Normalization (`src/providers/`)
- `ModelRegistry`: Queries local and remote providers, inspects runtime metadata, and calculates capabilities (chat, streaming, tool-calling, code completion, reasoning, vision).
- `ModelRouter`: Smart heuristic router matching task requirements (agent, chat, completion, edit) to optimal installed models.
- `ToolCallParser`: Universal output parser converting native tool calls, XML `<tool_call>`, fenced JSON, bare JSON, and `LOCALFORGE_TOOL_CALL` into normalized internal events while stripping `<think>` reasoning blocks.
- `CompositeProvider`: Routes model requests to the specific registered provider by canonical `ModelRef.id`.

### 3.4 Editing & Diff Engine (`src/editing/`)
- `EditEngine`: Creates multi-file edit proposals, tracks content hashes, calculates unified diffs, and executes atomic two-phase updates via VS Code `WorkspaceEdit`.
- `PatchService`: Computes deterministic SHA-256 content hashes and detects stale or concurrently modified files.
- `DiffService`: Fast line-by-line unified diff calculation with addition and deletion metrics.

### 3.5 Process & Terminal Subsystem (`src/terminal/`)
- `TerminalManager`: Cross-platform process execution using `node:child_process.spawn`.
- Clean process tree termination: `taskkill /pid ... /T /F` on Windows and negative PID process group termination on Unix.
- Output buffering with 10KB stderr and 20KB stdout windows and AbortSignal cancellation propagation.

### 3.6 Context Engine & Indexing (`src/context/`)
- `WorkspaceIndexer`: Real-time incremental file system watcher tracking paths, modifications, and lines.
- `ContextBudget`: Central token budget allocator reserving strict limits for system instructions, conversation history, active editor selection, open tabs, git diffs, diagnostics, and workspace snippets.
- `ContextReferenceResolver`: Resolves `@file`, `@git`, `@terminal` references and slash commands (`/plan`, `/agent`, `/review`, `/doctor`, `/clear`).

---

## 4. Architectural Verification Matrix

All subsystems are strictly validated through a 10-layer testing architecture comprising pure unit tests, tool integration, terminal execution, Extension Host tests (`@vscode/test-electron`), and live local model verification.
