# LOMVREN

> **A local-first autonomous engineering environment for AI-assisted software development.**  
> *Note: LOMVREN was previously published as LocalForge.*

LOMVREN is a VS Code coding assistant that connects to local Ollama or an Ollama instance on a user-managed remote GPU through an SSH tunnel. It does not provide hosted inference or proprietary telemetry. When remote inference is selected, prompts and the context you include are sent through the encrypted tunnel to that remote host; review that host's access and retention policies before connecting.

---

## Key Differentiators

- **Local-First**: Models run through local Ollama, configured OpenAI-compatible endpoints, or user-managed remote Ollama over SSH. No inference service is operated by this extension. A user-configured OpenAI-compatible endpoint may itself be hosted remotely; prompts/context go to that endpoint. SSH mode sends them to the selected host.
- **Antigravity IDE Agent Side Panel**: Native VS Code Secondary Sidebar agent experience with minimal chrome, crisp Codicon icons, segmented mode selection (`Ask`, `Plan`, `Agent`), execution strategies (`Fast`, `Planning`), collapsible operational timelines, interactive artifact cards, and dedicated review changes view.
- **Canonical Model Identity (ModelRef.id)**: Single source of truth across ModelRegistry, CompositeProvider, ModelRouter, and sessions. A selected model in the UI executes deterministically.
- **Ask · Plan · Agent Modes**:
  - **Ask**: Read-only contextual Q&A across active files, selections, open tabs, diagnostics, and indexed workspace code.
  - **Plan**: Artifact-first software architecture inspection producing structured implementation plans without modifying code until approved.
  - **Agent**: Autonomous software engineer capable of inspecting code, creating multi-file proposals, running tests, and proposing surgical repairs.
- **Atomic Two-Phase Multi-File Patching**: File changes are never written blindly. Edits generate an `EditProposal` with SHA-256 snapshots, original state (`present` vs `missing`) verification, and unified diffs. If any single file in a multi-file proposal is stale or modified, none are applied.
- **Validation & Auto-Repair Loop**: Automatically detects project type (Node, Python, Rust, Go, Java, C/C++) and test commands, runs validation after approved edits, and attempts up to 3 automatic repairs if tests fail.
- **Secure SSH Remote GPU Offloading**: Synchronized remote model lifecycle. Connecting via SSH tunnel discovers remote models and surfaces live GPU telemetry (NVIDIA GPU model, VRAM usage, utilization) in the unified model picker. Disconnecting removes remote models immediately.
- **Command Approvals**: A conservative allow-list auto-runs selected common test/build/read commands. Other commands require approval; host shell commands are not sandboxed and run with the user's permissions.

---

## Modes of Operation

### Model management

Open the **Models** view in the LOMVREN sidebar to search installed models, select one for chat, or set a default for chat and agent tasks. Enter an Ollama model name to install or update it. Downloads show live progress and provide Pause, Resume, and Cancel controls. Resume sends a new pull request for the same model; Ollama may reuse completed layers. Paused downloads survive closing and reopening the view during the current extension session. Deletion requires confirmation and is limited to discovered local Ollama models. Start Ollama before installing or discovering local models.

| Mode | Purpose | Tools Allowed | Safety Behavior |
| :--- | :--- | :--- | :--- |
| **Ask** | Understand & explain code | Read-only (`read_workspace_file`, `search_workspace`, `list_directory`) | Non-destructive; answers questions with code references. |
| **Plan** | Architectural analysis & planning | Read-only inspection tools | Produces structured Implementation Plan artifacts; no writes until user clicks Proceed. |
| **Agent** | Full software engineering | Read, surgical edit proposal, and safe validation commands | Patch-first diff review; 2-phase atomic commit; test validation loop & repair. |

### Execution Strategies

- **Fast**: Direct execution for small, focused tasks (variable renames, single-function fixes, inline queries).
- **Planning**: Deep repository inspection, Task List and Implementation Plan deliverables, approval pause, and structured verification.

---

## Interaction & Information Architecture

The LOMVREN agent panel follows a native, focused hierarchy:

1. **Header**:
   - LOMVREN branding and active conversation title.
   - Quick action buttons (New Session, Refresh Models, Diagnostics, Settings).
   - Compact model indicator displaying active model, provider, and compute target (`Local GPU`, `Remote GPU (SSH)`, or `Auto`).
2. **Mode Selector**:
   - Clean segmented selector: `Ask` | `Plan` | `Agent`.
   - Strategy selector: `Fast` | `Planning`.
3. **Conversation & Activity Timeline**:
   - Streamed answers and interactive cards.
   - Collapsible operational activity timeline: `Thinking`, `Working`, `Searching`, `Reading`, `Planning`, `Editing`, `Waiting for approval`, `Running`, `Verifying`, `Completed`.
   - Never exposes private chain-of-thought or raw internal reasoning.
4. **Deliverable Artifacts**:
   - Interactive cards for `Implementation Plan`, `Walkthrough`, `Code Diff`, and `Test Report`.
   - Actions for `[Review]`, `[Proceed]`, and inline user comments that steer subsequent turns.
5. **Utility Toolbar**:
   - `Changes [N]`: Opens dedicated Review Changes drawer with unified diff inspection, addition/deletion stats, and Accept/Reject controls.
   - `Terminal [N]`: Opens Terminal drawer with live command output, exit codes, and elapsed time.
6. **Composer**:
   - Context chips (`@file`, `@selection`, `@terminal`, `@diagnostics`, `@git`).
   - Multiline prompt input with slash command autocomplete (`/plan`, `/diff`, `/search`, `/terminal`, `/model`, `/context`, `/diagnose`, `/remote`, `/clear`).
   - `Enter` to send, `Shift+Enter` for newline, `Escape` to cancel.

---

## Getting Started

### 1. Requirements

- **VS Code**: `^1.106.0`
- **Model Runtime**:
  - [Ollama](https://ollama.ai) running locally on `http://127.0.0.1:11434` (default), or
  - Any OpenAI-compatible server (LM Studio, vLLM, llama.cpp) on `http://127.0.0.1:1234/v1`, or
  - A remote Linux host with Ollama and an NVIDIA GPU accessible via SSH.

Recommended coding models (install from the **Models** view, or use the CLI):
```bash
ollama pull qwen2.5-coder:7b
# for fast inline completions:
ollama pull qwen2.5-coder:1.5b
```

### 2. First Run

1. Open VS Code. LOMVREN is available in the **Secondary Sidebar** (or Primary Sidebar/Panel).
2. LOMVREN will detect running model runtimes and populate the unified model picker.
3. Choose your preferred mode (`Agent`, `Plan`, or `Ask`).
4. Type a task (e.g., *"Add authentication middleware"* or *"Explain the repository structure"*).

---

## Slash Commands & Context References

### Slash Commands

Type `/` in the composer for quick autocomplete:

- `/plan <task>`: Switch to Plan mode and generate an Implementation Plan artifact.
- `/diff`: Review current pending edit proposals and file diffs.
- `/search <query>`: Search the indexed workspace for symbols or concepts.
- `/terminal <cmd>`: Execute a terminal command through the managed process layer.
- `/model`: View the active model, capability confidence, and runtime target.
- `/context`: Inspect the active context budget, token usage, and attached files.
- `/diagnose`: Run the installation health check and diagnostics suite.
- `/remote`: Connect to a configured SSH remote GPU host.
- `/clear`: Clear conversation history and reset turn state.

### Context References

Click or type `@` references to attach context directly into the prompt:

- `@file`: Include the active file or search for a specific file.
- `@selection`: Attach the currently highlighted editor code.
- `@terminal`: Attach recent terminal output from the managed process buffer.
- `@diagnostics`: Attach active compiler or linter errors from VS Code.
- `@git`: Attach current branch, modified files, and working tree status.

---

## Remote GPU Inference over SSH

Run large models (14B, 32B, 70B) on a remote GPU workstation or cloud instance (RunPod, Lambda Labs, home rig) while working locally:

1. Click **Settings** or run `LOMVREN: Configure Remote GPU Host`.
2. Enter host, username, port, and authentication method (SSH key or password).
3. Secrets are stored securely in **VS Code SecretStorage**—never in plaintext files or logs.
4. Run `LOMVREN: Connect to Remote GPU Host`.
5. LOMVREN establishes a loopback-only SSH tunnel (`127.0.0.1:port -> remote Ollama`), pins the server's SSH fingerprint, and discovers all remote models.
6. Remote models appear in the unified model picker with location tags and NVIDIA GPU telemetry (GPU name, VRAM used/total, utilization).
7. Disconnecting cleans up the tunnel and removes remote models from the active registry immediately.

---

## Security & Privacy Architecture

- **Inference destinations**: Local providers use configured endpoints. SSH remote mode forwards requests to the host explicitly selected by the user. OpenAI-compatible endpoints can be remote; verify the configured server and its data policy. The extension does not operate a vendor-hosted inference or telemetry service.
- **Workspace Trust Enforced**: Untrusted workspaces cannot execute workspace tools, read files, or run terminal commands.
- **Two-Phase Atomic Commit**: Changes across multiple files are checked simultaneously. If any file has been modified externally, all changes are halted to prevent overwrites.
- **Host Key Pinning**: Remote SSH connections verify and store SHA-256 host key fingerprints to prevent MITM attacks.
- **Command execution**: Only commands in the reviewed safe-command allow-list run without a prompt in automatic modes. Other commands require approval where an approval UI is available; shell execution is not a security sandbox.

---

## Testing & Verification

LOMVREN employs a rigorous multi-tier testing strategy:

- **Unit & Integration Tests**: `npm test` compiles TypeScript and runs the checked-in automated regression tests.
- **High-Volume Stress Tests**: `tests/highVolumeStress.test.js` exercises 1,000 tool-call parser inputs across all syntaxes, 1,000 malformed inputs, 1,000 path security traversals, 1,000 webview message validations, 100 edit proposals, 100 permission checks, 100 synthetic agent loops, 10 real terminal executions, and concurrent cancellation scenarios.
- **VS Code Extension Host Tests**: `npm run test:extension-host` verifies extension activation, command registration, Secondary Sidebar view contributions, diagnostics execution, and live webview IPC inside real VS Code Electron runtime environments.
- **Production Packaging**: `npm run package` compiles the TypeScript codebase and packages the production-ready `.vsix` bundle via `@vscode/vsce`.

---

## License

MIT © [Paladugu Ganesh Naidu](https://github.com/paladuguganeshnaidu)
