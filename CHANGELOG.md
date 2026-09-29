# Changelog

All notable changes to the LocalForge extension are documented in this file.

## [0.2.4] - 2026-09-30

### Fixed & Hardened
- **Resilient Webview Lifecycle & API Singleton**: Wrapped `acquireVsCodeApi()` in a cached singleton (`window.__cachedVsCodeApi`) to protect retained webviews against uncaught exceptions when reloading VS Code windows.
- **Strict Chromium Level 3 CSP**: Standardized `<meta>` Content Security Policy to `script-src 'nonce-${nonce}';`, eliminating directive collision and enabling full inline script execution in modern VS Code versions.
- **Robust Prompt Dispatch**: Fixed send button latching; added explicit `type="button"`, `e.preventDefault()`, and `e.stopPropagation()` on Send click and Enter keydown handlers to guarantee prompt transmission under all conditions.
- **Automated Stale Task Recovery**: Incoming user prompts now auto-cancel stale or hung prior tasks and unconditionally unlock the UI busy state.
- **Workspace Grounding**: Injected root workspace name and `package.json` title, version, and description into initial prompt context so compact local models immediately ground their understanding of the workspace.
- **Extension API Export**: Exported `LocalForgeExtensionApi` exposing `engine` and `viewProvider` for headless integration, automated testing, and programmatic invocation.
- **Real-Environment Electron Testing**: Integrated `@vscode/test-electron` test suite verifying full command registration, terminal execution, and live webview IPC inside real VS Code runtime.

## [0.2.3] - 2026-09-29

### Fixed & Enhanced
- **Instant Optimistic UI Feedback**: Submitting a prompt immediately renders the user message bubble and an animated "LocalForge is thinking..." spinner, eliminating any perceived unresponsiveness.
- **Non-Blocking Background Indexing**: Made workspace indexing asynchronous during prompt context assembly, reducing initial prompt latency from 30+ seconds to under 3ms.
- **Direct Prefix Route Resolution**: Enhanced `CompositeProvider.resolveRoute` to parse provider prefixes (e.g. `ollama:<model>`) directly without waiting for asynchronous model discovery.
- **Prompt Dispatch Resilience**: Cleaned up message event listeners and added message deduplication guards in the Webview.

## [0.2.0] - 2026-09-29

### Added
- **Multi-Agent Orchestration Operating System**:
  - `TaskGraph`: Directed Acyclic Graph (DAG) for dynamic task decomposition with topological sorting, dependency resolution, and cycle detection.
  - **12 Built-in Specialized Agent Roles**: Orchestrator, Planner, Repository Analyst, Researcher, Coder, Test Engineer, Debugger, Reviewer, Security Reviewer, Documentation Agent, Git Agent, Performance Agent.
  - `AgentPool`: Concurrency manager (max 4 concurrent agents) with hierarchical cooperative cancellation via `AbortSignal`.
  - `AgentManager`: Role dispatcher with scoped context isolation and typed handoff contracts (`PlannerHandoff`, `CoderHandoff`, `TesterHandoff`, `ReviewerHandoff`, `SecurityHandoff`).
  - `CheckpointManager`: Persistent task graph checkpoints in `workspaceState` for crash resilience and resumption across VS Code reloads.
- **Expanded 35+ Tool Registry**:
  - Rich metadata (`riskLevel`, `requiresApproval`, `timeout`, `retryPolicy`, `validate`, `redact`).
  - Core filesystem tools (`read_file`, `read_files`, `write_file`, `create_file`, `replace_range`, `delete_file`, `move_file`, `list_directory`).
  - Core search & Git tools (`search_text`, `search_files`, `workspace_search`, `git_status`, `git_diff`, `git_log`, `git_commit`).
  - Project inspection & execution tools (`run_command`, `run_test`, `get_diagnostics`, `get_editor_context`, `inspect_project`, `create_artifact`).
- **LocalForge Doctor & Automated Self-Test**:
  - `localforge.doctor`: Comprehensive platform diagnostic command inspecting VS Code, Node.js, platform, trust, Git, providers, models, GPU, and indexer.
  - `localforge.selfTest`: 13-point automated self-test command verifying all core runtime subsystems.
- **Security Hardening & Threat Model Containment**:
  - UNC path (`//`, `\\\\`) and Windows reserved device name (`CON`, `PRN`, `AUX`, `NUL`, `COM1-9`, `LPT1-9`) guards in path validator.
  - Enforced immutable Trust Hierarchy: `SYSTEM > SECURITY POLICY > USER > TOOL POLICY > WORKSPACE DATA > MODEL OUTPUT`.
  - Untrusted workspace data delimiters (`<untrusted_workspace_data>`).
- **Complete Documentation Suite**:
  - Comprehensive documentation in `/docs/` and `/docs/audit/` covering architecture, multi-agent runtime, security, offline guarantees, model routing, and testing.

## [0.1.7] - 2026-09-28

### Added
- **Secondary Sidebar as Canonical UI Container**:
  - Migrated `viewsContainers` to `contributes.viewsContainers.secondarySidebar`, targeting VS Code `^1.106.0`.
  - Removed duplicate Activity Bar container; LocalForge now natively opens on the right side of the editor.
  - Zero-emoji visual design standard enforced across all views, cards, and notifications.
- **Dedicated Multi-Format `ToolCallParser`**:
  - Implemented comprehensive parsing supporting native provider `tool_calls`, `<tool_call>...</tool_call>` XML blocks, fenced JSON blocks, bare JSON objects, arrays of tool calls, and `LOCALFORGE_TOOL_CALL` protocol.
  - Resolves parameter aliases and nested structures gracefully.
  - Completely strips `<think>...</think>` internal reasoning tags and removes raw tool call JSON payloads from user-visible chat content.
- **Runtime Capability Discovery**:
  - Integrated Ollama `/api/show` query to determine runtime tool calling capabilities (`supported`, `unsupported`, `unknown`).
  - Added warning banner in Agent mode when an unsupported tool model is selected.
- **Patch-First Atomic Editing & Virtual Diff Provider**:
  - Registered `ProposedContentProvider` with `localforge-proposed:` URI scheme in `extension.ts` for native VS Code diff inspection.
  - Workspace mutation tools (`write_workspace_file`, `edit_workspace_file`) produce `EditProposal` objects rather than mutating files directly.
  - Two-phase multi-file commit with hash validation prevents stale file overwrites.
- **Managed Terminal Lifecycle**:
  - Added full status tracking (`queued`, `running`, `completed`, `failed`, `stopped`, `timed_out`) to `TerminalManager`.
  - Routed `/terminal` slash command through `PermissionManager` to prevent security bypasses.
- **Interactive Approval Workflow**:
  - Connected `PermissionManager` to Webview with `permissionRequest` and `permissionResolved` messages, enabling inline approval cards (`Allow`, `Deny`, `Allow for Session`, `Always Allow`).
- **Centralized ContextBudget Authority**:
  - Implemented `ContextBudget` authority strictly allocating tokens across system instructions, user task, active file/selection, open editor tabs, git branch/status/diff context, diagnostics errors, and workspace search snippets.
- **Real-Time Incremental Workspace Indexing**:
  - Integrated `vscode.workspace.createFileSystemWatcher` into `WorkspaceIndexer` for automatic incremental updates on file creations, modifications, and deletions.
- **Canonical Live Activity & Event-Driven Timeline**:
  - Structured `TurnActivity` model with lifecycle states (`started`, `running`, `success`, `error`, `cancelled`, `waiting_for_approval`) and categories (`Planning`, `Searching`, `Reading`, `Working`, `Editing`, `Running`, `Browser`, `Waiting for approval`, `Validating`, `Repairing`, `Completed`, `Failed`, `Cancelled`).
  - Zero fake activity: all progress indicators derive directly from live tool execution hooks.
- **Genuine Incremental Streaming in Chat View**:
  - Webview incrementally renders streamed tokens (`chunk` message) with animated cursor; separates text tokens from activity and artifact messages.
- **Post-Approval Validation & Auto-Repair Loop**:
  - Edits applied after user approval automatically trigger project test detection, execution, and up to 3 repair attempts with error feedback.
  - Generates Walkthrough deliverable artifact upon verified completion.
- **Windows Process Tree Termination & Cancellation**:
  - TerminalManager utilizes `taskkill /pid ... /T /F` on Windows to cleanly terminate spawned shell process trees without orphaned child processes.
  - Full `AbortSignal` cooperative cancellation propagates through agent loops and running commands.
- **Real Capability-Gated Browser Verification**:
  - Replaced simulated browser stubs with real HTTP fetch and title/snippet extraction.
- **High-Volume Stress Testing Suite**:
  - Added 10 high-volume stress tests covering 1,000 tool-call inputs, 1,000 malformed inputs, 1,000 path security checks, 1,000 webview message contract checks, 100 edit proposals, 100 permissions, 100 agent loops, 10 real terminal executions, model switching, and concurrent cancellations (85 total passing automated tests).
- **Extension Host Test Runner**:
  - Added `@vscode/test-electron` test suite and `npm run test:extension-host` for automated verification in real VS Code runtime environments.

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
