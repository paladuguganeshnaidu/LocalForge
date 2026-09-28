# Changelog

All notable changes to the LocalForge extension are documented in this file.

## [0.1.6] - 2026-09-28

### Added
- **Antigravity IDE Agent Side Panel Experience**:
  - Rebuilt the primary interface to closely match the modern Antigravity IDE agent panel, designed for VS Code Secondary Sidebar (`contributes.viewsContainers.secondarySidebar`).
  - Zero-emoji design standard: pure VS Code Codicon SVGs, native theme tokens (`--vscode-*`), clean typography, subtle borders, and monochrome status indicators.
  - Compact header with real-time model indicator, session title, and quick action buttons.
  - Segmented mode bar (`Ask`, `Plan`, `Agent`) and execution strategy selector (`Fast`, `Planning`).
  - Collapsible operational activity timeline (`Thinking`, `Working`, `Searching`, `Reading`, `Planning`, `Editing`, `Waiting for approval`, `Running`, `Verifying`, `Completed`, `Failed`, `Cancelled`). No raw chain-of-thought or internal reasoning exposed.
  - Interactive deliverable artifact cards for `Task List`, `Implementation Plan`, `Code Diff`, and `Walkthrough` with `[Review]`, `[Proceed]`, and inline commenting.
  - Bottom utility toolbar featuring live `Changes` counter, `Terminal` activity drawer, and context budget chips.
  - Dedicated Review Changes panel with multi-file unified diff inspection, file status, additions/deletions, and atomic apply/reject.
  - Streamlined composer with context attachment chips (`@file`, `@selection`, `@terminal`, `@diagnostics`, `@git`), multiline input, and slash command autocomplete popup (`/plan`, `/diff`, `/search`, `/terminal`, `/model`, `/context`, `/diagnose`, `/remote`, `/clear`).

- **Canonical Model Identity (ModelRef.id)**:
  - Eliminated dual/overlapping model identity systems across `ModelRegistry`, `CompositeProvider`, `ModelRouter`, `AgentEngine`, and sessions.
  - Unified everything under canonical `ModelRef.id` (`${providerId}:${encodeURIComponent(name)}`).
  - Selecting a model in the UI deterministically routes and executes that exact model instance.

- **Synchronized Remote GPU Model Lifecycle**:
  - SshOllamaTunnel connections now register remote models synchronously with both `CompositeProvider` and `ModelRegistry`.
  - Disconnecting or losing the SSH tunnel immediately unregisters remote models from all registries, removing stale models from the UI picker.
  - Full remote GPU telemetry (`nvidia-smi` GPU model, VRAM used/total, utilization) surfaced in the model picker.

- **Atomic Two-Phase Multi-File Patch-First Editing**:
  - Non-destructive agent tool execution: tools never directly write to disk during normal Agent workflows. Instead, edits produce an `EditProposal` with SHA-256 snapshots and unified diffs.
  - Support for `originalState: 'present' | 'missing'`, detecting missing-file resurrection races.
  - Two-phase commit: Phase 1 validates all expected hashes across all proposed files; if any single file is stale or modified, NONE are applied. Phase 2 applies all changes atomically via `vscode.WorkspaceEdit`.

- **Layered Command Policy & Chaining Safety**:
  - Replaced naive regexes with layered command categorization (`read-only`, `test`, `build`, `lint`, `package`, `version control`, `file mutation`, `network`, `process control`, `destructive`).
  - Prohibits shell operator chaining (`&&`, `||`, `;`, `|`, `2>`, `>`, `&`, `$()`, backticks) in auto-safe execution mode.

- **Deliverable Artifact System & Turn Manager**:
  - Implemented `ArtifactManager` producing structured deliverables (`Implementation Plan`, `Walkthrough`, `Test Report`, etc.) with status lifecycles and review comments.
  - Implemented `TurnManager` maintaining structured conversation turns, tracking operational activities, timestamps, and turn-level diffs.

- **Terminal & Browser Tool Abstractions**:
  - Implemented `TerminalManager` supporting managed sub-processes, stdout/stderr buffering, and process lifecycle tracking.
  - Implemented local `BrowserTool` abstraction detecting local Chrome/Edge executables for web verification without external cloud dependencies.

- **Expanded Test Suite (56 Automated Tests)**:
  - Added test suites for canonical model identity, remote model lifecycle synchronization, atomic multi-file apply and stale edit detection, layered command policies and chaining rejection, artifact and turn lifecycles, and end-to-end product integration fixtures.

## [0.1.5] - 2026-09-28

### Added
- **Architectural Modularization**:
  - Reorganized codebase into clean, dedicated modules: `core/`, `providers/`, `context/`, `agent/`, `editing/`, `remote/`, `completion/`, and `ui/`.
  - Transformed `extension.ts` into a lightweight, focused bootstrapping and command registration layer.
- **Model Capability & Unified Registry**:
  - Implemented `ModelCapabilities` detection (chat, streaming, tool calling, structured output, code completion, vision, reasoning, context window, system prompt).
  - Built unified `ModelRegistry` aggregating local Ollama, OpenAI-compatible runtimes, and SSH remote GPU endpoints with real-time health monitoring.
  - Implemented capability-aware task router (`chat`, `edit`, `agent`, `completion`) with intelligent auto-selection and rationale reporting.
- **Context Engine & Workspace Indexer**:
  - Created bounded, hierarchical `ContextEngine` integrating active selection, current file, open tabs, diagnostics, and lexical retrieval.
  - Built persistent `WorkspaceIndexer` respecting `.gitignore` exclusions and binary boundaries.
  - Added token budgeting, source tracking, deduplication, and context summary previews.
- **Agent Engine & Permission System**:
  - Refactored agent execution into `AgentEngine`, `AgentLoop`, and MCP-ready `ToolRegistry`.
  - Added explicit lifecycle tracking (`planning`, `executing`, `waiting_for_approval`, `completed`, `failed`, `cancelled`).
  - Implemented `PermissionManager` with tool categorization (`read`, `edit`, `execute`), permission modes (`allow_safe_auto`, `always_ask`, `ask_once_per_session`), and shell command safety validation.
- **Patch-First Editing & Multi-File Composer**:
  - Guaranteed safe writes: agent proposals generate unified diffs and validate original file SHA-256 hashes prior to writing.
  - Added `StaleEditError` protection to abort writes if files changed while diff reviews are open.
  - Implemented Composer-style multi-file editing with diff inspection and selective approval.
- **Validation & Auto-Repair Loop**:
  - Automated project detection for Node.js, Python, Rust, Go, Java, and C/C++.
  - Post-edit validation loop running project tests and executing up to 3 automatic repair attempts upon test failures.
- **Remote GPU Telemetry & Fit Estimation**:
  - Structured parser for `nvidia-smi` telemetry across single and multi-GPU configurations.
  - Memory fit estimator classifying model requirements into "Likely fits", "May be memory constrained", or "Exceeds available VRAM".
- **Minimal Antigravity-Style Chat UI**:
  - Redesigned chat interface using native VS Code theme tokens, clean layout, and minimal chrome.
  - Segmented mode bar for `⚡ Agent`, `📋 Plan`, and `💬 Ask`.
  - Live agent activity chips (`✓ search_workspace`, `✓ read_file`, `⟳ editing`).
  - Built-in settings drawer for runtime endpoints, remote GPU profiles, auto-approval permissions, and feature toggles.
- **Session & Task Continuity**:
  - Workspace-scoped `SessionManager` and `TaskManager`.
  - Added `LocalForge: Continue Previous Task` command to resume context from previous agent runs.
- **Installation Diagnostics**:
  - Added `LocalForge: Diagnose Installation` (`localforge.diagnose`) command checking workspace trust, Ollama reachability, model capabilities, SSH tunnels, GPU state, and context indexes.
- **Test Suite Expansion**:
  - Expanded unit test coverage to 42 automated tests covering capabilities, diffing, patch safety, permissions, GPU status, sessions, and agent loops.

## [0.1.4] - 2026-09-28

### Added
- **Full Autonomous Copilot Agent**:
  - **Agent Mode**: Local models autonomously plan, inspect repository files, perform surgical code modifications, and execute workspace terminal commands end-to-end.
  - **Plan Mode**: Architecture and planning mode that explores the codebase and outputs a step-by-step implementation checklist (`- [ ]`) without touching code until approved.
  - **Ask Mode**: Fast contextual Q&A and code explanation with read-only workspace search.
- **Direct Remote GPU SSH Integration**:
  - One-click **Remote GPU** status bar in the webview to connect to remote GPU servers (Lambda Labs, RunPod, home rigs) over secure SSH loopback tunnels.
  - Live GPU telemetry (`nvidia-smi` name and VRAM) displayed directly in the UI.
  - Transparent port-forwarding of remote Ollama instances (`11434`), enabling heavy 32B/70B models to run remotely on dedicated GPUs while editing locally.
- **Universal Local Model Tool Compatibility**:
  - Dual tool-calling engine: supports native Ollama function calling as well as fallback extraction of `<tool_call>` blocks and markdown tool invocations. Smaller models (such as `qwen2.5-coder:1.5b` and `7b`) now execute tools without errors.
- **Rich Copilot Agent UI**:
  - Replaced chatbot layout with an interactive Copilot Agent timeline featuring live tool execution cards (`search_workspace`, `read_workspace_file`, `list_directory`, `write_workspace_file`, `edit_workspace_file`, `run_command`).
  - Animated progress indicators, collapsible reasoning blocks, terminal output accordions, and interactive checklist checkboxes.
  - Dynamic active editor context chip (`📄 filename.ts`).

## [0.1.3] - 2026-09-28

### Fixed
- **Webview CSP & Communication Bridge**: Added `${webview.cspSource}` to `script-src` and `style-src` in the Webview Content Security Policy.
- **Instant Model Delivery**: When the webview announces readiness (`ready`), cached models are now sent immediately in 0 ms.
- **Fail-Safe UI Error Boundary**: Wrapped the webview initialization script in a `try/catch` error boundary that displays any script or DOM error directly on the status card.
- **Optimized Provider Detection**: Reduced connection timeouts on offline OpenAI-compatible endpoints from 2–5s to 1s.
- **Heartbeat Retry**: Added an automatic handshake heartbeat if initial iframe mounting misses early message delivery.

## [0.1.2] - 2026-09-28

### Fixed
- **VS Code Webview Loading**: Added missing `"type": "webview"` to view contributions in `package.json`.
- **Model Discovery Lifecycle**: Fixed an early-return bug in `refresh()` that aborted discovery when the view was not yet visible.
- **Handshake Order**: Attached webview message listeners prior to setting HTML content.
- **Ollama Detection**: Added fallback probes across `/api/version`, `/api/tags`, and `/`.
- **Composite Routing**: Auto-hydrates model routes on cache miss before raising errors.

### Added
- **Explain Selected Code**: New `localforge.explain` command.
- **Fix Selected Code or Diagnostics**: New `localforge.fix` command.
- **Editor Context Menus**: Added right-click editor context menu actions.
- **Conversation Persistence**: Chat history saved per-workspace.
- **Clear Conversation**: Added `⌫ Clear` control in sidebar.
- **Safe Markdown Rendering**: Code snippets render with language badges and copy buttons.
- **Traversal Protection**: Added `validateRelativeWorkspacePath`.
- **Official MIT License**: Included repository `LICENSE` file.
- **Unit Testing**: Initial suite of 20 unit tests.
