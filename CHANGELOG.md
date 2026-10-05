# Changelog

All notable changes to the LocalForge extension are documented in this file.

## [Unreleased]

## [1.0.0] - 2026-10-05

- Local release candidate requested by the user; publication requires confirmation. Original full-site/3D acceptance, 100 independent tools and 20B/40B model verification remain open.
- Prioritize general execution/testing for non-web tasks, retain atomic benchmark evidence, and provide an input-driven release/install/publish workflow.
- Require actual registered Node test counts when explicitly requested; verify replacement-file readback before clearing stale exact-patch failures. Respect exact requested output values instead of substituting row counts for sums.
- Refuse website completion when the requested favicon is missing, not only when an existing SVG favicon is malformed.

## [0.3.2] - 2026-10-04

- Add persisted Low, Medium, High and Ultra effort selection beside the model, with responsive wrapping and safe busy-state acknowledgement. Effort controls real local generation and agent budgets; context remains bounded by configured and advertised model limits. Ultra allows uncapped rounds, not infinite single responses or guaranteed completion.
- Preserve the packaged 0.3.0 checkpoint. Packaging refuses to overwrite an existing artifact and validates the exact runtime, browser payload, version and Marketplace identity.
- Repair workspace-session command/edit approvals, host acknowledgement and permission settlement when activity storage fails. Protected operations still require their own approval; session grants are not an OS sandbox.
- Add approved read-only specialist delegation and temporary fixed workflow registration. These are real executable integrations, not 100 independent tools or unrestricted generated extension code.
- Offer portable directory creation and actual platform/shell guidance; clear failed directory preparation only with fresh exact directory evidence. Read runtime-advertised model context instead of relying only on model-name heuristics.
- Report interrupted Ollama streams clearly, reject unfinished normal EOF, preserve cancellation/protocol diagnostics and never silently retry or switch models. Close forwarded sockets and remove disconnected SSH providers/models; stale setup/status results cannot resurrect an old connection or overwrite a replacement.
- This is a tested development package, not 1.0.0 production certification. Full NexusFlow/3D, two successful clean full-site runs and the broader autonomous workflows remain separate acceptance requirements.

- Fix directory argument aliases and refuse treating file paths or malformed directory requests as the workspace root; retry inspection errors in Ask as well as Agent mode and preserve readable findings with specific incomplete actions.
- Reject ungrounded inspection answers, suppress their live rendering before evidence, and distinguish ordinary named JSON data from executable tool calls. Exclude credentials, outside-workspace editors, and escaping links from automatic indexing/context/reference attachment.
- Check repository summaries against successfully read package identity and explicitly requested exact scripts; ask the model to correct missing evidence, and report unresolved answer requirements without claiming completion. Normalize plain section labels without changing fenced source code.
- Render live actions chronologically in chat, show exact running/settled commands and exit codes, collapse older run evidence, and simplify conversation surfaces with safe headings, grouped lists, ordered steps, quotes, code and links.
- Add enforced Project workspace/File/Full Machine tool profiles. File blocks other files, project context, terminal, Git and delegation; Full Machine enables separately approved outside-workspace text reads and directory listings, not unrestricted diff editing or elevated privileges.
- Add approved, bounded HTTPS documentation reads without redirects and require explicit approval for recognized network commands even in automatic modes. Shell commands remain host processes, not an OS/network sandbox.
- Replace short six/ten-round defaults with configurable task, context and history budgets; support uncapped rounds with cancellation and repeated-action protection, abridge old complete tool exchanges, and expose local Ollama generation/context settings.

- Route built-in file creation, line replacement, deletion, and move tools through the shared proposal, native edit, and durable recovery engine; remove their direct filesystem mutation fallbacks.
- Require explicit deletion/move approvals, bind source and destination acceptance/Undo, preserve binary moves/deletions, and refuse collisions, dirty buffers, directories, and symbolic links.
- Validate integer line ranges and preparation hashes, preserve existing CRLF in line replacement, label file operations in review, and provide original snapshot documents for new-file diffs.
- Require actual boolean approval decisions and verify a create/fix/move/run/delete agent workflow plus binary move/deletion recovery across real VS Code processes.
- Retry transient backup-file sharing violations with a bounded delay without deleting the previous snapshot or bypassing access controls.

- Record original bytes before reviewed edits in synced, atomically replaced local workspace-storage snapshots; recover and undo changes after extension/VS Code restart.
- Provide confirmed Undo and Remove backup controls in the Changes drawer and a Command Palette Undo action; preserve later manual changes, dirty editors, and workspace boundaries.
- Route accepted selection fixes through the same reviewed-edit recovery engine and expose metadata-only recovery tools with explicit destructive-action approvals.
- Bound backup storage without silently evicting recoverable edits, fail closed on corrupt durable storage, and verify real process-restart recovery.
- Bind inline proposal actions to their own proposal and prevent replaced chat requests from overwriting newer streaming/busy state.

- Bind model requests, permission waits, and tool execution to per-run cancellation signals; cancelled approvals cannot execute actions or grant session permissions later.
- Start tool execution deadlines after permission approval, abort supported commands and HTTP requests on cancellation, and guard file mutations after asynchronous preparation.
- Restore pending approval cards when chat reloads and remove cancelled cards automatically.
- Route validation and repair commands through the managed terminal and permission engine, and report exhausted validation repairs as failed.
- Pass Git commit messages as process arguments rather than interpolating them into a shell command.
- Enforce real-path boundaries for new files and reviewed proposals, including external junction parents; recheck targets before acceptance and reject unsafe path segments.
- Preserve per-file pending review, block duplicate applies, and respect native edit rejection instead of falling back to unreviewed direct writes.
- Keep replacement-task cancellation isolated, make review validation cancellable, and distinguish failed, repaired, and unrun validation in task history.
- Initialize new-file content in the native edit transaction; wait for actual process exit before reporting stop/timeout completion or restarting, and expose stopping state while termination is in progress.
- Save accepted existing-file edits before validation and refuse proposals that would overwrite unsaved user buffers.

- Add a dedicated Models view for installed local Ollama models, downloads, default selection, and removal.
- Show streamed download progress with pause/resume and cancellation, and refresh discovery after successful installs.
- Preserve active and paused downloads across Models view recreation without letting model selection or discovery notices reset their controls.
- Reject interrupted download streams that never confirm success, and reject deletion of undiscovered models.
- Refresh the agent model registry after model management actions so newly installed models can be selected immediately.
- Distinguish loopback Ollama services from LAN, internet, and SSH endpoints, and keep local model-management actions scoped to local services.

## [0.2.23] - 2026-10-01

- Persist requested, approved, denied, and cancelled tool permissions in the expandable run timeline.
- Preserve redacted command and tool arguments with each approval record.
- Bind pending approval decisions to the originating run, even if the active chat changes.

## [0.2.22] - 2026-10-01

- Provide a verified action summary when a local model completes tool work without final prose.
- Clearly distinguish file changes awaiting review from changes already applied.
- Avoid exposing command output in the synthesized fallback summary.

## [0.2.21] - 2026-10-01

- Normalize common local-model file-write aliases before permission review and execution.
- Verify target-path/content aliases through parser regression and live Ollama edit approval.

## [0.2.20] - 2026-10-01

- Bundle the extension runtime and SSH2 into one Node-compatible entry point for packaging.
- Exclude development dependencies and loose compiled modules from the VSIX.
- Run extension-host integration tests against the same bundled entry point used by the package.

## [0.2.19] - 2026-10-01

- Preserve full bounded model-visible responses, tool arguments, and command output in the expandable run history after restart.
- Label model-visible responses separately from command inputs and execution results for clearer run inspection.
- Continue to exclude hidden reasoning and redact credential-like values from inspectable evidence.

## [0.2.18] - 2026-10-01

- Improve chat readability, selection, focus visibility, and reduced-motion accessibility.
- Refresh message, composer, approval, and action-control styling while preserving VS Code theme colors.

## [0.2.17] - 2026-10-01

- Stream user-visible agent text while local or API models generate their response.
- Buffer hidden reasoning and partial tool-call syntax so only parsed, user-facing text is streamed.
- Support streamed tool calls from Ollama and OpenAI-compatible providers, including compact Ollama's text-tool protocol.
- Preserve buffered behavior when an OpenAI-compatible endpoint ignores stream mode and returns JSON.
- Verify streaming with live Ollama command approval and a full VS Code file-proposal acceptance run.

## [0.2.16] - 2026-10-01

- Normalize `file_path` aliases from local model tool calls into the workspace writer's canonical `path` argument.
- Reject missing or empty file contents instead of creating blank proposals that appear successful.
- Correctly persist reviewed content when a proposal creates a new workspace file.
- Verify live Ollama tool approval, proposal review, and accepted file contents in a real VS Code extension host.

## [0.2.15] - 2026-10-01

- Preserve the user's scroll position while model tokens and agent activities arrive.
- Add a “Latest” control to return to the newest chat content when reading earlier steps.
- Keep new prompts, restored sessions, and approval requests visible when those actions need attention.

## [0.2.14] - 2026-10-01

- Show the exact command and command category in permission requests before execution.
- Remove the per-request blanket approval action; broad auto-approval remains an explicit setting.
- Revoke once-per-session approvals when starting or switching conversations.

## [0.2.13] - 2026-09-30

- Trust automatic read access only for explicitly registered built-in tools marked read-only; custom tools remain behind approval.
- Reuse the result of an identical consecutive successful tool call instead of executing a command or edit twice.
- Add a real local-Ollama agent smoke test that verifies command approval, execution, and returned output.

## [0.2.12] - 2026-09-30

- Retry unresolved agent tool failures in a bounded recovery loop instead of stopping on an unsupported completion claim.
- Resolve a failed attempt only after a successful retry of the same tool and target; otherwise finish with a failed status.
- Show the model's visible response in expandable run details without exposing hidden chain-of-thought.

## [0.2.11] - 2026-09-30

- Persist a bounded, workspace-scoped activity timeline and restore it when reopening the chat.
- Mark unfinished runs as interrupted after VS Code restarts and retain inspectable tool inputs and outputs.

## [0.2.10] - 2026-09-30
- Include the actual terminal working directory, process ID, and lifecycle status in expandable run details.
- Represent missing process exit codes as unavailable instead of implying a successful exit.

## [0.2.9] - 2026-09-30
- Set the first-run permission policy to ask before every edit or command, matching the requested user-controlled execution flow.
- Keep read-only inspection automatic and preserve the existing safe auto-run option for users who explicitly select it.

## [0.2.8] - 2026-09-30
- Add expandable per-step agent evidence for model-visible progress, tool inputs, command output, errors, and completion details.
- Redact common credential values and bound displayed tool output to keep activity details safer and readable.
- Preserve an expanded activity disclosure as its live status updates.
- Add a persistent approval-mode selector for safe auto-run, once-per-session approval, and approval before each edit or command.
- Keep read-only inspection automatic and catastrophic system operations blocked in every approval mode.
- Treat terminal-manager failed, timed-out, and stopped states as actual tool failures even when no exit code is available.
- Default new installs to asking before each edit or command; read-only inspection remains automatic.

## [0.2.7] - 2026-09-30
- Prevent generic completion claims when any agent tool call fails; show a clear, user-visible warning instead.
- Strip standalone raw tool-error JSON echoed by small local models from assistant messages.
- Record malformed, blocked, and over-limit tool calls as failures in the run state.
- Validate edit paths against the trusted workspace before checking edit content, so external paths fail with the correct safety message.
- Strengthen agent instructions for exact edit targets, workspace-relative paths, and truthful reporting.

## [0.2.6] - 2026-09-30
- Replace generic success text when a local model returns an empty final answer with a truthful, actionable message.
- Fix agent run summaries so failed tools and non-zero commands remain visible as warnings instead of being hidden behind a generic success.
- Keep plan and proposed edits in a waiting-for-review state until the user decides.
- Improve assistant Markdown, compact activity details, and explicit accept/review/reject change controls.
- Make rendered webview syntax validation run in-process for sandboxed environments.

## [0.2.5] - 2026-09-30

### Security & Release Readiness
- Restricted browser inspection to localhost HTTP(S), rejected redirects and credential-bearing URLs, and capped response bodies and request duration.
- Limited automatic shell execution in `always_proceed` mode to the reviewed safe-command allow-list; all other commands require approval.
- Integrated Marketplace manifest and payload verification into the package script and excluded development reports, logs, and test artifacts from VSIX packaging.
- Clarified remote inference data flow and shell execution limitations in the README.

## [0.2.4] - 2026-09-30

### Rebrand
- Product branding changed from LocalForge to **LOMVREN**.
- Existing Marketplace extension identity (`paladuguganeshnaidu.localforge-vscode`) strictly preserved.
- New high-resolution LOMVREN icon and brand assets added.
- Existing functionality, configuration keys, and extension ID remain 100% compatible.

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
