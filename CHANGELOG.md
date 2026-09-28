# Changelog

All notable changes to the LocalForge extension are documented in this file.

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
