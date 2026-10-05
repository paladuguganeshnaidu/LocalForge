# TuxNest Roadmap & Architecture

## Product Vision

TuxNest is a local-first AI software engineer for VS Code featuring TuxNest Chat and TuxNest SI Agent. It discovers models already available on your workstation or user-owned GPU server, routes chat, code edits, autonomous agent loops, and inline completions through provider-agnostic interfaces, and operates with zero proprietary cloud dependencies.

---

## Status & Milestones

### Completed in v0.1.7
- [x] **Canonical Live Activity Model & Real Progress System**:
  - Unified TurnManager activity lifecycle (`started`, `running`, `success`, `error`, `cancelled`, `waiting_for_approval`) and categories (`Planning`, `Searching`, `Reading`, `Working`, `Editing`, `Running`, `Browser`, `Waiting for approval`, `Validating`, `Repairing`, `Completed`, `Failed`, `Cancelled`).
  - In-place duration tracking, error reporting, and live timeline rendering.
  - Zero fake activity: strictly tied to real tool execution hooks and operational status.
- [x] **Centralized ContextBudget Authority**:
  - `ContextBudget` authoritative budget calculator enforcing token allocation across system instructions, conversation history, active file/selection, open tabs, git context, diagnostics, and workspace snippets.
- [x] **Real-Time Incremental Workspace Indexing**:
  - Integrated `vscode.workspace.createFileSystemWatcher` in `WorkspaceIndexer` for instant incremental updates on file creates, edits, and deletes.
- [x] **Real Incremental Streaming & Webview Token Rendering**:
  - Real-time incremental token rendering in webview (`msg.type === 'chunk'`) with animated cursor and separate channels for text, activity, proposals, and artifacts.
- [x] **Robust Multi-Format Tool Calling & Protocol Safety**:
  - Native function calls, XML `<tool_call>`, fenced JSON, raw JSON, and `LOCALFORGE_TOOL_CALL` protocols.
  - Absolute leakage prevention: raw tool JSON never renders in chat bubbles.
- [x] **Patch-First Diff Review, Validation & Bounded Repair Loop**:
  - Agent edits create `EditProposal` objects with diff review before application.
  - Applying proposals triggers automated project test detection (Node, Python, Rust, Go), execution, and bounded repair loop (up to 3 attempts).
  - Walkthrough artifact generated upon successful verification.
- [x] **Windows & Cross-Platform Process Lifecycle**:
  - `TerminalManager` process tree killing via `taskkill /pid ... /T /F` on Windows and cooperative `AbortSignal` cancellation propagation.
- [x] **Capability-Gated Browser Verification**:
  - Real HTTP verification and page title/snippet extraction for local endpoints without simulated stubs.
- [x] **High-Volume Stress Testing Suite**:
  - 1,000 tool-call inputs, 1,000 malformed inputs, 1,000 path security checks, 1,000 message contract checks, 100 edit proposals, 100 permissions, 100 agent loops, 10 real terminal executions, model switching, and concurrent cancellations.
- [x] **Real VS Code Extension Host Integration Testing**:
  - Added `@vscode/test-electron` test harness running automated end-to-end tests inside real VS Code runtime.

### Completed in v0.1.6
- [x] **Antigravity IDE Agent Side Panel Experience**:
  - Implemented Secondary Sidebar view (`contributes.viewsContainers.secondarySidebar`).
  - Zero-emoji design standard with native VS Code theme tokens and Codicon SVGs.
  - Interactive deliverable cards (`Implementation Plan`, `Walkthrough`, `Code Diff`) with review and proceed actions.
  - Collapsible operational activity timeline without private chain-of-thought exposure.
  - Dedicated Review Changes drawer with diff inspection and atomic multi-file apply.
  - Composer with `@` context reference chips and `/` slash command autocomplete.
- [x] **Canonical Model Identity (ModelRef.id)**:
  - Unified single source of truth across ModelRegistry, CompositeProvider, ModelRouter, and sessions.
  - Deterministic execution of UI-selected models.
- [x] **Synchronized Remote GPU Lifecycle**:
  - Synchronous registration and unregistration across ModelRegistry and CompositeProvider.
  - Surfaced NVIDIA GPU telemetry in the unified model picker.
- [x] **Atomic Two-Phase Multi-File Patching**:
  - Safe 2-phase atomic commit verifying original hashes and missing-file state before writing.
  - All-or-nothing apply prevents partially applied or corrupted states.
- [x] **Layered Command Policy & Chaining Safety**:
  - Command categorization and strict rejection of shell chaining operators (`&&`, `||`, `;`, `|`, `2>`, `$()`, backticks) in auto-safe execution.
- [x] **Terminal & Local Browser Tool Abstractions**:
  - Managed terminal sub-process execution and local browser verification without cloud dependencies.
- [x] **Deliverable Artifact System & Turn Management**:
  - Comprehensive ArtifactManager and TurnManager with status lifecycles and milestone tracking.
- [x] **Expanded Automated Test Suite**:
  - 56 passing automated tests covering all core components and end-to-end integration fixtures.

### Completed in v0.1.5
- [x] Modular architecture refactoring (`core/`, `providers/`, `context/`, `agent/`, `editing/`, `remote/`, `ui/`).
- [x] Model capabilities detection and unified ModelRegistry.
- [x] ContextEngine with token budgeting and persistent WorkspaceIndexer.
- [x] Patch-first editing with SHA-256 snapshots and StaleEditError.
- [x] Automated project detection and test validation loop with auto-repair.
- [x] SSH Remote GPU tunnel with SecretStorage and host key pinning.

---

## Future Roadmap (v0.2.0+)

### 1. Hybrid & Embedding Retrieval Engines
- [ ] Implement `EmbeddingRetrievalEngine` utilizing local embedding models (e.g. `nomic-embed-text`) via Ollama.
- [ ] Add `HybridRetrievalEngine` fusing lexical BM25/keyword scoring with vector similarity.

### 2. Model Context Protocol (MCP) Expansion
- [ ] Dynamic client connector allowing user-configured MCP servers to register custom tools into `ToolRegistry`.
- [ ] Support external database, browser, and issue tracker MCP tools.

### 3. Multi-Model Team Routing
- [ ] Allow configuring different models for planner vs executor (e.g., DeepSeek-R1 for planning, Qwen2.5-Coder for execution).
- [ ] Sub-agent task delegation.

---

## Quality Principles

1. **Local-First Always**: No required cloud dependencies, accounts, or telemetry.
2. **Never Overwrite Silently**: Every write is staged as an EditProposal and checked against original file hashes.
3. **Deterministic Identity**: Canonical model IDs ensure the user gets exactly what they selected.
4. **Native VS Code Look & Feel**: The agent panel feels like an integral part of VS Code, matching the editor aesthetic.
