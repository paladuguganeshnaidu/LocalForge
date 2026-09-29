# LocalForge v0.1.7 Release Notes
## Fully Working Agent Execution

**Release Date:** 2026-09-28  
**Repository:** [https://github.com/paladuguganeshnaidu/LocalForge](https://github.com/paladuguganeshnaidu/LocalForge)  
**Package:** `localforge-vscode-0.1.7.vsix`  
**Automated Tests:** 85 passing / 0 failing  

---

### Executive Summary

LocalForge v0.1.7 represents the definitive architectural upgrade transforming LocalForge from an experimental AI assistant into a genuinely working, end-to-end local autonomous coding agent inside VS Code. 

Operating inside the VS Code Secondary Sidebar with an interaction model inspired by the Antigravity Agent Side Panel, LocalForge delivers a complete, executable lifecycle: **Workspace Inspection → Runtime Capability Discovery → Multi-Format Tool Parsing → Edit Proposals → Native VS Code Diff Review → Two-Phase Atomic Apply → Managed Terminal Execution → Verification → Completed Result**.

---

### Key Architectural Enhancements

#### 1. Secondary Sidebar as Canonical UI Container
- Migrated primary UI container to `contributes.viewsContainers.secondarySidebar` targeting VS Code `^1.106.0`.
- Removed duplicate Activity Bar container, ensuring LocalForge lives natively on the right-hand panel of VS Code.
- Updated `engines.vscode` and `@types/vscode` to `^1.106.0`.
- Responsive layout adapting dynamically to narrow sidebar widths with zero hardcoded desktop dimensions.
- Zero emojis anywhere across the entire UI, status badges, and notifications; strictly adhering to native VS Code Codicons and theme variables (`--vscode-*`).

#### 2. Root Cause Fix: ToolCallParser & Output Sanitization
- **Reproduction in v0.1.6:** Local models (e.g. `qwen2.5-coder:1.5b`) frequently emitted markdown-fenced or raw JSON tool calls. In v0.1.6, the regex only parsed XML `<tool_call>` tags, leaving `calls.length === 0`. The loop sent the raw JSON to `onThought` -> webview chat as normal assistant content and immediately marked the turn as `Completed` without executing any tool.
- **Dedicated `ToolCallParser`:**
  - Extracts native provider `tool_calls`.
  - Extracts `<tool_call>...</tool_call>` XML tags.
  - Extracts markdown-fenced JSON blocks (````json { "name": "..." } ````).
  - Extracts bare JSON objects `{"name": "...", "arguments": {...}}` and `{"tool": "...", "args": {...}}`.
  - Extracts arrays of tool calls `[{...}, {...}]`.
  - Implements the controlled `LOCALFORGE_TOOL_CALL: { ... }` compatibility protocol for models lacking native function calling.
  - Resolves parameter aliases (e.g., `create-node-program`, nested `content.value`).
  - **Complete Output Sanitization:** Strips all `<think>...</think>` internal reasoning tags and completely removes raw tool call payloads from `userVisibleText`. Raw tool call JSON is never rendered to the chat feed.

#### 3. Runtime Model Capability Discovery
- Implemented `evaluateRuntimeCapabilities()` in `src/providers/modelCapabilities.ts` and `showModel()` in `src/providers/ollamaProvider.ts`.
- Probes Ollama `/api/show` at runtime to inspect model family, template, and parameters.
- Discovers tool calling capability as runtime data (`supported`, `unsupported`, `unknown`).
- Warns user gracefully when an unsupported model is selected in Agent mode, preventing broken tool dumps.

#### 4. Patch-First Atomic Editing & Virtual Diff Provider
- Registered `ProposedContentProvider` under the `localforge-proposed:` URI scheme in `src/extension.ts`.
- Workspace tools `write_workspace_file`, `edit_workspace_file`, and `apply_patch` route through `EditEngine.proposeEdits` instead of directly mutating files.
- Generates `EditProposal` with SHA-256 content hashes, status tracking, and unified diffs.
- Clicking "Review Diff" opens a real VS Code native diff editor comparing the original file with `localforge-proposed:${filePath}?proposal=${id}`.
- **Atomic Two-Phase Apply:** Phase 1 validates expected hashes for all files in the proposal; if any file has been modified externally, the entire proposal is aborted as stale. Phase 2 applies all file edits atomically via `vscode.WorkspaceEdit`.

#### 5. Managed Terminal Lifecycle & Slash Command Safety
- Updated `TerminalManager` with a complete status lifecycle: `queued`, `running`, `completed`, `failed`, `stopped`, and `timed_out`.
- Tracks process IDs, execution duration, and captures real-time stdout and stderr.
- Removed permission bypass in `/terminal` slash command: all commands now route through workspace trust validation, destructive command checks, shell operator safety checks, and `PermissionManager`.

#### 6. Interactive Approval Workflow
- Wired `PermissionManager` to the Webview via `permissionRequest` and `permissionResolved` message exchange.
- Users can approve actions via `[Allow]`, `[Deny]`, `[Allow for Session]`, or `[Always Allow]`.
- Configurable permission modes: `request_review`, `allow_safe_auto`, `always_proceed`, `ask_once_per_session`.

#### 7. Project Validation & Verification Engine
- Project-type aware validation: detects Node.js (`package.json`), Python (`pyproject.toml`, `pytest`), Rust (`Cargo.toml`), Go (`go.mod`), Java (`pom.xml`, `gradlew`).
- Runs verification commands in a managed subprocess.
- Generates structured `Test Report` artifacts and triggers an automated repair loop (up to 3 attempts) upon failure.

---

### Verification and Test Matrix

| Component | Automated Tests | Result |
| :--- | :--- | :--- |
| **ToolCallParser** | 10 tests (`tests/toolCallParser.test.js`) | PASS |
| **AgentLoop & Tool Execution** | 8 tests (`tests/agentTools.test.js`) | PASS |
| **Atomic Editing & Diff Provider** | 3 tests (`tests/atomicEditingAndDiffProvider.test.js`) | PASS |
| **End-to-End Smoke Agent** | 1 test (`tests/endToEndSmokeAgent.test.js`) | PASS |
| **Model Registry & Routing** | 14 tests (`tests/modelRegistry.test.js`, `tests/canonicalModelIdentity.test.js`) | PASS |
| **Terminal Safety & Lifecycle** | 5 tests (`tests/terminalSafetyAndLifecycle.test.js`) | PASS |
| **Remote GPU & SSH Tunnel** | 4 tests (`tests/remoteFixture.test.js`) | PASS |
| **Context & Slash Commands** | 6 tests (`tests/contextRetrieval.test.js`, `tests/slashCommands.test.js`) | PASS |
| **High-Volume Stress Tests** | 10 tests (3,320 cases in `tests/highVolumeStress.test.js`) | PASS |
| **VS Code Extension Host** | 1 integration suite (`tests/runExtensionHostTests.js`) | PASS |
| **Overall Automated Suite** | **85 tests passing (0 failing)** | **PASS** |

---

### Baseline Regression Smoke Test

**Task:** Create a simple Node.js program in this workspace that prints `LocalForge working`, then run it in the terminal.

1. **Workspace Inspection:** LocalForge inspects the workspace directory structure.
2. **Planning & Tool Call:** Emits `write_workspace_file` for `src/hello.js` and `package.json`.
3. **ToolCallParser:** Transparently extracts tool calls, strips raw JSON from visible text, and suppresses hidden reasoning.
4. **Edit Proposal:** Changes staged as pending `EditProposal`. Native VS Code diff renders proposed changes.
5. **Atomic Application:** User approves edits; files are committed to disk cleanly.
6. **Terminal Execution:** Executes `node src/hello.js` via managed `TerminalManager`.
7. **Verification:** Captures `LocalForge working` stdout with exit code `0`.
8. **Final Result:** Assistant presents clean completion walkthrough with zero raw JSON leakage.
