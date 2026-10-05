# LOMVREN

For installation, model/GPU setup, scopes, approval choices, edits, verification, read-only specialists and temporary workflow tools, see the [0.3.0 development user guide](USER_GUIDE.md). The preserved 0.3.0 checkpoint and subsequent development builds are not a 1.0.0 production sign-off.

> **A local-first autonomous engineering environment for AI-assisted software development.**  
> *Note: LOMVREN was previously published as LocalForge.*

LOMVREN is a VS Code coding assistant that connects to local Ollama or an Ollama instance on a user-managed remote GPU through an SSH tunnel. It does not provide hosted inference or proprietary telemetry. When remote inference is selected, prompts and the context you include are sent through the encrypted tunnel to that remote host; review that host's access and retention policies before connecting.

---

## Key Differentiators

## Chat controls and GPU downloads (0.2.25 local repair)

The latest local repair retains file-picker nodes during streamed replies, batches Markdown rendering per animation frame, dismisses context/history popovers with Escape or outside clicks, and locks cancellation until the host acknowledges it. Failed command details retain stdout/stderr; saved repairs renew bounded recovery without erasing failed verification. Requested Node tests must actually pass after the latest edit. See [the test report](AGENT-TEST-REPORT.md) and [comparison](AGENT-TEST-COMPARISON.md) for measured load, real model tasks and remaining failures. These checks do not guarantee that any local model can complete arbitrary engineering work.

When a model omits verification, the agent can schedule explicitly requested saved-file readback and localhost browser checks, or rerun an already executed failed verification command after a saved repair. These are labelled **automatic verification**, not model decisions. They use the same registered handlers, scope, approvals and cancellation as ordinary actions; refused permissions and pending reviews stop scheduling. Browser checks target the agent-owned tracked server and actual requested viewports/selectors. A new edit invalidates earlier checks. Actual failures still require a model-authored repair; the agent never manufactures passing results or installs packages through this mechanism. Completion feedback includes the current real diagnostic rather than hiding it behind a generic missing-test message. Whole-reply Markdown envelopes now render as headings and lists while embedded source code remains escaped.

- The composer-first layout places Agent/Ask/Plan and the exact model dropdown inside the bottom message box, not in stacked top toolbars. Chat history, new chat and settings are the only header actions. Access scope and execution strategy live in Settings. This is an independently implemented familiar coding-chat layout, not a pixel-identical clone of two different products.
- Add context opens a workspace file dropdown and selection/terminal/diagnostics/Git shortcuts. Attach up to ten files, including names with spaces; remove individual attachments before sending. Sensitive files, external symlinks and the selected File access boundary remain protected. Selecting context does not expand agent permissions.
- Settings → Download & manage models opens Models. Choose This machine or a connected SSH host as the download destination. Confirm the host/model; progress comes from Ollama's actual pull stream. Pausing pins the host and model for resume. Disconnected hosts fail explicitly; downloads never silently fall back to the laptop.
- Downloading onto a remote GPU host stores the model on that host. GPU inference is controlled by that host's Ollama runtime and available VRAM; downloading does not itself prove GPU offload. Connect a verified SSH profile first. Configured remote/API inference receives the prompts and context you send.
- Activity rows show actual tool results, including failures, not scripted progress demonstrations. The standalone `scripts/preview-chat.cjs` is explicitly an interface preview with no model execution. `scripts/verify-chat-ui.cjs` exercises real rendered HTML through controlled UI fixtures; it does not certify autonomous website creation.

### Dependency and terminal recovery (local repair)

Agent commands use closed stdin and noninteractive npm settings. Missing tools must be installed deliberately rather than approved blindly by an interactive npx prompt. `install_packages` accepts up to twenty registry names with optional versions/tags, saves runtime or development dependencies, shows the exact command and package lifecycle scripts for network/process approval, and rechecks the manifest before execution. It refuses flags, external paths, URLs and shell syntax. See the [npm exec documentation](https://docs.npmjs.com/cli/v11/commands/npm-exec/) and [npm installation documentation](https://docs.npmjs.com/cli/v11/commands/npm-install/).

The observed webpack-cli installation prompt is stopped with a recovery explanation rather than left waiting for stdin. Production manifests requesting a build must declare a real build script; explicit no-build tasks remain valid. Tracked process/browser inspections retrieve fresh results rather than reusing stale success. A started process is labelled as started with readiness still to check, not as a verified running website. A successful declared build can resolve an earlier equivalent build failure, but unrelated training/test failures remain unresolved. These changes do not make a weak model a proven production agent: the complete clean website, ML and document workflows still require end-to-end acceptance.

## Capabilities

- **Local-First**: Models run through local Ollama, configured OpenAI-compatible endpoints, or user-managed remote Ollama over SSH. No inference service is operated by this extension. A user-configured OpenAI-compatible endpoint may itself be hosted remotely; prompts/context go to that endpoint. SSH mode sends them to the selected host.
- **Coding Chat Side Panel**: Native VS Code Secondary Sidebar with a compact header, bottom mode/model composer, context picker, actual inline activity, reviewable changes and settings for advanced controls.
- **Canonical Model Identity (ModelRef.id)**: Single source of truth across ModelRegistry, CompositeProvider, ModelRouter, and sessions. A selected model in the UI executes deterministically.
- **Ask · Plan · Agent Modes**:
  - **Ask**: Read-only contextual Q&A across active files, selections, open tabs, diagnostics, and indexed workspace code.
  - **Plan**: Artifact-first software architecture inspection producing structured implementation plans without modifying code until approved.
  - **Agent**: Autonomous software engineer capable of inspecting code, creating multi-file proposals, running tests, and proposing surgical repairs.
- **Atomic Two-Phase Multi-File Patching**: File changes are never written blindly. Edits generate an `EditProposal` with SHA-256 snapshots, original state (`present` vs `missing`) verification, and unified diffs. If any single file in a multi-file proposal is stale or modified, none are applied.
- **Validation & Auto-Repair Loop**: Automatically detects project type (Node, Python, Rust, Go, Java, C/C++) and test commands, runs validation after approved edits, and attempts up to 3 automatic repairs if tests fail.
- **Secure SSH Remote GPU Offloading**: Synchronized remote model lifecycle. Connecting via SSH tunnel discovers remote models and surfaces live GPU telemetry (NVIDIA GPU model, VRAM usage, utilization) in the unified model picker. Disconnecting removes remote models immediately.
- **Command Approvals**: Repository-controlled commands, tests and Git subprocesses require explicit approval, including in Always proceed. An exact action can be remembered; the explicit workspace/chat session button can grant ordinary existing built-in commands and edits for that chat. Protected internet/sensitive/destructive/privileged/custom actions still require separate approval. Ordinary non-sensitive built-in file inspection remains automatic. Shell commands are not sandboxed and run with the user's permissions.

---

## Modes of Operation

### Chat, access and long-running tasks (0.2.24 development build)

Pure greetings and thanks stream directly from the selected model without project context, prior messages, references, or tools, even when Agent is selected. Simple summary-only requests retain read-only inspection tools. Mixed requests such as “summarize and fix” retain Agent capabilities. This is conservative intent detection, not a guarantee that a small model understands every instruction. The [current repair verification ledger](IMPLEMENTATION_VERIFICATION.md) supersedes the [historical 0.2.24 verification record](docs/release/VERIFICATION_0.2.24.md) for uncommitted repair behavior; this work has not been published.

### Chats and history

Open **Chats** above the conversation to create, switch, rename, delete, or filter chats. Each chat keeps its own messages, title, model, mode, and execution strategy. Changing the model does not switch the chat. An unavailable selected model remains visible and must be replaced explicitly; requests do not silently switch to a different provider.

Chat history is stored in a versioned private file in VS Code's workspace storage, outside your project. Legacy session and model-keyed histories are migrated once without deleting the original data. Changes are serialized and persisted before the UI reports success. Limits are 250 chats, 10,000 messages per chat, and 16 MiB overall; reaching a limit reports an error without evicting existing chats. An unreadable store is preserved and blocks loading rather than silently creating an empty history; a guided corruption-recovery workflow is still pending.

**Clear current chat** and `/clear` remove its messages and recorded activities. **Delete** requires confirmation and removes only the selected chat. Neither operation changes workspace files or deletes edit-recovery backups. Late responses from an older, cleared chat cannot restore its messages. Restart restoration of artifacts and a complete rendered end-user acceptance pass remain pending in this repair mission.

### Older-chat memory (unpublished repair build)

Relevant older user/assistant messages are retrieved locally using BM25-style lexical ranking; no cloud embeddings are required. The recent window remains separate (up to ten messages, default 6,000 characters); retrieved excerpts default to 3,000 characters and four messages. Model input has additional estimated character limits with output/system allowances. This is not an exact tokenizer measurement or unlimited model memory.

Memory defaults to **Current chat only**. The Settings drawer exposes memory enablement, scope, budgets, and result count as workspace settings. Choosing **All chats** through the drawer requires confirmation and can send retrieved text to your selected model endpoint. File access and pure greetings exclude chat memory. `/search chat <query>` deterministically shows ranked excerpts with message/chat IDs and character ranges; `/context` shows the recent turns, older evidence, attached file/workspace sources, estimates, and exclusions used by the last successful request.

Retrieval excludes raw tool calls/results, NUL-containing data, and messages longer than 8,000 characters. Known credential patterns are redacted without rewriting stored originals; arbitrary secrets cannot be guaranteed recognizable. Original messages remain the source of truth, and the derived lexical index is rebuilt from private chat storage. Clear/delete immediately remove eligible source messages. New assistant replies record memory provenance; deleting or clearing a source chat prevents those derived replies from being retrieved or resent as recent context, including transitive copies. Previously saved, untraceable copies and historical context previews are not cryptographically erased. The native IPC/restart and live-model checks are recorded in the verification ledger; rendered UI acceptance is still required before release.

Local Ollama requests use a lower sampling temperature (0.1) for less variable coding/tool responses. Change `localforge.ollama.temperature` in VS Code settings if needed; a lower temperature does not guarantee accuracy. A summary can display project identity sourced directly from a successfully read `package.json`, rather than guessing it from the model. Missing explicitly requested exact script commands can trigger a corrective model round.

Live file and command actions now appear where they happen in the conversation. A running command shows `Running: <command>`; its completed row shows `Ran: <command> · exit <code>`. Expand **Inspect run details** for input, output and failures. Earlier activity is collapsed under **Previous run details**. Replies support safe Markdown headings, grouped bullet/numbered lists, quotes, code and HTTP(S) links; model HTML is never executed.

The **Access** selector enforces built-in tool restrictions, independently of edit/command approval policies:

- **Project workspace** (default): file tools stay within the open workspace. Terminal commands require their own policy; they run as your existing OS account and are **not OS-sandboxed**.
- **File**: select one file in the first workspace folder. Only that path may be read or proposed for editing; repository context, other files, terminal commands, Git and delegation are blocked. Previous broader conversation context is not sent. Project validation commands are unavailable until you change scope.
- **Full Machine**: requires explicit confirmation and enables `read_machine_file` / `list_machine_directory` for absolute outside-workspace paths. Every such action needs approval, including in Always proceed mode. Regular text-file reads are bounded to 256 KiB. Workspace diff/Undo tools remain workspace-only; this is not unrestricted outside-workspace editing, an administrator grant, or an OS sandbox. Approved shell commands already operate with your account's permissions. Access resets when the extension restarts and cannot be changed during a task.

`read_web_page` reads an explicitly approved HTTPS URL, with a 1 MiB response limit and no redirects, credentials, browser execution or automatic search engine. Page content is untrusted reference data. Recognized network commands (including package installation) also request approval. Arbitrary scripts can access networks; the extension does **not** impose an OS-level network firewall. Local model inference does not send code to the publisher; selecting remote/API inference sends prompts and context to your configured endpoint. Approving internet requests can transmit their URL/query to that destination.

### Project creation and local website verification

Agent tools now include `create_directory`, `file_stat`, `inspect_package_scripts`, `install_dependencies`, `run_build`, `run_lint`, `start_dev_server`, `process_status` and `stop_process`. Edits still use the existing reviewed edit engine. Package operations expose the actual command and declared lifecycle scripts for approval; changes to package.json invalidate that prepared approval. These checks do not sandbox arbitrary package code or recursively resolve every nested script, executable or dependency lifecycle hook.

`browser_action render` uses a packaged Playwright driver and an already-installed Chrome/Edge in an isolated browser context. `inspect`, `click`, `fill` and `viewport` support actual DOM/form/interaction and responsive checks, with browser console errors, failed requests and HTTP errors reported separately. Non-loopback resources, service workers, downloads and WebSockets are blocked; use local assets and a production preview rather than relying on development-server HMR. `navigate`/`read` remain bounded HTML inspection only, not JavaScript or visual verification. Chrome/Edge availability is checked at normal installation paths as well as PATH. No browser is silently downloaded.

A requested website build cannot count as completed after only reading inspiration. Explicitly requested project builds, tracked server startup and rendered-browser checks need successful tool evidence. This is a conservative evidence gate, not proof of design quality, complete accessibility or every requested interaction. Repeated unchanged failed calls stop after three dispatched attempts and explain the blocker. A model still has to create the code correctly: the available 1.5B model failed the full Torii task during real testing. There is no claim of GPT 6.1 SOL availability, 100 independent tools or a production-quality website until those checks actually pass.

In **Settings**, configure task rounds (default 80; `0` removes the round cap), local context window (default 8192), and local output tokens (`-1` removes the extension's generation cap). Advanced VS Code settings also expose `localforge.agent.contextTokens` and `localforge.agent.historyCharacters`. History compaction removes old complete exchanges with an abridged evidence notice; it is a character estimate, not an exact token guarantee. Local inference has no publisher token quota, but model context, RAM/VRAM, speed and tool reliability are finite. Repeated identical actions stop rather than looping forever. Small models can still fail complex engineering requests; this build does not claim parity with commercial coding agents.

Try **Ask**: “Inspect the project and summarize its purpose, architecture, entry points, run/test commands and what you could not verify.” Then **Agent**: “Create a responsive portfolio in this workspace. Propose the files, explain how to preview it, and verify after approval.” Diff-review mode prepares changes rather than applying them; accept the changes and continue the task to inspect/verify the resulting files. Use Always proceed only when you explicitly want permitted low-risk edits applied automatically.

### Workspace search and indexing (unpublished repair build)

`/search <query>` runs bounded lexical workspace retrieval without a model call. Results identify the source path, line range, score, chunk ID, file SHA-256, and excerpt truncation. It is not exhaustive full-project understanding or semantic embedding search. `/context` records the workspace chunk metadata actually attached to the last model request.

The index starts automatically and watches file creation, changes, deletion, renames, accepted edits and rollback. Full rebuilds replace the snapshot atomically; retrieval checks that selected source bytes still match their hashes before attaching them. Use **Settings → Workspace index → Rebuild index** or **LOMVREN: Re-index Workspace Context** to rebuild. Settings shows real files/chunks, last update, partial coverage and errors. Command-palette rebuild is cancellable. File access blocks workspace retrieval and both rebuild entry points.

Workspace-scoped limits default to **2,000 files**, **256 KiB per file** and **8,000,000 text characters**. Candidate discovery is separately bounded; reaching a limit is explicitly reported as partial coverage. The drawer exposes these limits. Binary/NUL data, invalid UTF-8, sensitive paths, generated/build/dependency directories and packaging assets are excluded. Root/nested `.gitignore` and `.ignore`, plus `files.exclude`/`search.exclude`, are honored. Simple sibling `when` conditions are supported; invalid or excessively expanded rules fail the rebuild visibly rather than silently admitting excluded files. Indexing reads saved disk content, not unsaved buffer versions. Native watcher/edit/restart tests are documented in the verification ledger; complete rendered UI acceptance remains pending.

### Model management

Open the **Models** view in the LOMVREN sidebar to search installed models, select one for chat, or set a default for chat and agent tasks. Enter an Ollama model name to install or update it. Downloads show live progress and provide Pause, Resume, and Cancel controls. Resume sends a new pull request for the same model; Ollama may reuse completed layers. Paused downloads survive closing and reopening the view during the current extension session. Deletion requires confirmation and is limited to discovered local Ollama models. Start Ollama before installing or discovering local models.

| Mode | Purpose | Tools Allowed | Safety Behavior |
| :--- | :--- | :--- | :--- |
| **Ask** | Understand & explain code | Read-only (`read_workspace_file`, `search_workspace`, `list_directory`) | Non-destructive; answers questions with code references. |
| **Plan** | Architectural analysis & planning | Read-only inspection tools | Produces structured Implementation Plan artifacts; no writes until user clicks Proceed. |
| **Agent** | Software engineering tasks | Read, reviewed file edits, explicitly approved commands, project initialization and local browser verification | Applied changes and real verification evidence are required; model capability still limits task success. |

### Execution Strategies

- **Fast**: Direct execution for small, focused tasks (variable renames, single-function fixes, inline queries).
- **Planning**: Deep repository inspection, Task List and Implementation Plan deliverables, approval pause, and structured verification.

### Undo reviewed changes

Open **Changes → Recorded changes**, or run **LOMVREN: Undo Recorded Changes** from the Command Palette. Select a recorded edit and confirm restoration. Reviewed chat edits, accepted selection fixes, and built-in file creation, line replacement, deletion, and move tools save original bytes before applying changes; recovery survives restarting VS Code. Restoring removes created files, restores deleted files, reverses moves, and preserves original encoding markers and line endings. Move source/destination paths must be accepted or restored together. It refuses to overwrite later changes, dirty editors, or paths outside the original open workspace. Restore newer edits first when they affect the same files. Deletions and moves require explicit tool approval even in automatic modes, followed by diff review unless approved auto-application is configured.

Backups contain source code and are stored locally in this extension's per-workspace storage, outside the project. The interface and recovery-list tool expose metadata, not backup contents. **Remove backup** permanently removes that record's Undo capability after confirmation. Storage is capped at 40 records / 16 MiB, with an 8 MiB per-file preparation limit; only fully restored records may be pruned automatically. If full or unreadable, further reviewed edits are blocked rather than discarding recoverable backups. Binary files support deletion and moves, not text replacement. Directories and symbolic links are not accepted by these file tools. Recovery does not cover arbitrary terminal commands or MCP mutations; it restores file contents/existence, not all filesystem metadata or newly created empty parent directories. It is not a whole-workspace backup or a command sandbox.

Developers can run `npm run test:recovery-restart` to verify exact file restoration and editor synchronization across two separate VS Code processes in a disposable workspace.

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
- **Reviewed native edits**: All selected files are checked for stale content and workspace boundaries before one native VS Code edit transaction. A declined transaction is never retried using direct filesystem writes.
- **Explicit file-edit requests**: Recognized requests to show a proposed change for approval override Always proceed for that turn. Creation-only requests stop if the target exists. Preview-only turns do not offer terminal commands. A save failure retains recovery information, distinguishes unsaved editor changes from disk-verified files, and stops automatic actions; inspect and save the affected tab manually before retrying. Natural-language safeguards are conservative, not a general-purpose instruction parser—use the approval setting and inspect the proposed content.
- **Workspace boundaries**: Local file access resolves existing symlinks and junctions, including parents of new files. Review proposals recheck their targets before acceptance. These checks do not constitute an operating-system sandbox against concurrent external filesystem changes.
- **Cancellation**: Cancelling a task invalidates its pending approvals, requests managed command-tree termination, aborts browser requests, and prevents later built-in writes. Processes remain in a stopping state until exit is observed; operating-system termination can take time. Tool deadlines begin after approval. Custom handlers receive an execution-specific abort signal and must honor it before side effects; arbitrary code ignoring cancellation cannot be forcibly rolled back. Already-submitted native editor transactions may finish.
- **Host Key Pinning**: Remote SSH connections verify and store SHA-256 host key fingerprints to prevent MITM attacks.
- **Command execution**: Process tools require an interactive permission manager and explicit approval. Node/Python programs, npm/package scripts, tests and builds are not safe merely because of their executable or prefix. Ask once per session caches the exact arguments for the current tool registration; replacement invalidates that approval. This is not OS isolation, and an approved process can access the machine or network with your OS privileges. Inspection of expanded package-script commands and a shared multi-ecosystem command resolver remain work in progress.
- **Canonical tool policy**: `ToolDescriptor` supplies category, mutability, scopes, approval, direct network/process capabilities, review/recovery metadata and activity category to registration, access checks, permissions and subagents. Duplicate registration throws; replacement is explicit. Unregistered tools are denied, unknown registered tools default to consequential/external approval, and external tools cannot hijack built-in names. Scoped subagents retain the original handler, validation, redaction, timeout and live access boundary. A custom handler must honor its declared capabilities; permissions do not isolate arbitrary code.

### Configured model endpoints

All configured OpenAI-compatible URLs are normalized and deduplicated, not just the first. Each endpoint has independent health and discovery and a stable provider identity derived from its normalized URL. Model IDs include the provider and encoded model name, so identical names on two servers remain distinct. Bare ambiguous names and removed selections fail closed without changing the chat history or silently sending the request to another server.

The Settings drawer reads the actual Ollama URL and compatible endpoint list and saves these machine-scoped values in user settings. HTTP(S) is required; embedded credentials, queries and fragments are rejected. Blank compatible configuration disables those providers. Settings changed during a task or approved-edit validation show as pending and reconcile when it finishes. Discovery/runtime share provider objects; stale discovery cannot resurrect removed providers. Compatible discovery has a bounded five-second request deadline. Ollama and compatible transports reject redirects rather than forwarding prompts or discovery to another destination.

Older saved `openai:<model>` selections may become unavailable because compatible provider identities now include the endpoint. Reselect the provider-qualified model; the conversation itself is preserved. A configured remote URL receives the selected prompt/context. These endpoints do not imply a publisher-operated inference service or guaranteed local-only inference. SSH runtime acceptance still requires a real user-managed host.

---

## Testing & Verification

LOMVREN employs a rigorous multi-tier testing strategy:

- **Unit & Integration Tests**: `npm test` compiles TypeScript and runs the checked-in automated regression tests.
- **High-Volume Stress Tests**: `tests/highVolumeStress.test.js` exercises 1,000 tool-call parser inputs across all syntaxes, 1,000 malformed inputs, 1,000 path security traversals, 1,000 webview message validations, 100 edit proposals, 100 permission checks, 100 synthetic agent loops, 10 real terminal executions, and concurrent cancellation scenarios.
- **VS Code Extension Host Tests**: `npm run test:extension-host` verifies extension activation, command registration, Secondary Sidebar view contributions, diagnostics execution, and live webview IPC inside real VS Code Electron runtime environments.
- **Packaging**: `npm run package` compiles the TypeScript codebase and checks the `.vsix` bundle via `@vscode/vsce`. Packaging success is not proof that every production workflow is verified.

---

## Local agent model selection

- Multi-step work can publish a task-specific `update_plan` with planning, design, implementation and verification intentions. Actual activities still come from executable tools; a model-reported completed step is not proof of a saved file or passing test.
- While generation is quiet, status shows the actual elapsed wait and the latest model plan or inspected tool result. Labels are not rotated on a timer to invent work. Tool activities show the real command and its observed exit status.
- Empty projects are initialized for the requested language rather than always forcing npm. Automatic validation uses declared npm tests or detected Python tests; missing test configuration is not a passing test, and unknown projects no longer default to `npm test`.
- Ollama generation uses a bundled dedicated HTTP transport so the editor's patched global fetch cannot silently impose a five-minute inactivity limit. Explicit cancellation, connection deadlines, rejected redirects and no automatic retries remain in place. This direct transport does not inherit the editor's HTTP-proxy settings; use the configured local endpoint or an explicitly selected SSH tunnel.

- Select **qwen3:4b-instruct** in Models (or select Auto when it is installed). The exact Instruct tag matters: `qwen3:4b` currently resolves to a thinking variant and did not finish the website/command tests on this CPU laptop.
- Ollama tool use follows runtime capabilities, not model-size labels. Small models that advertise native tools now receive those native schemas and correctly named tool results.
- Local agent requests start with at most 16 function schemas. `discover_tools` finds additional registered operations and makes them available on the next turn without granting permissions or bypassing Ask/Plan/file-scope restrictions.
- Auto agent selection prefers a balanced non-thinking local model over tiny coders when one is installed; explicit model selection remains authoritative. Autocomplete still prefers a small coding model.
- Extra reasoning is optional only when the runtime advertises a switchable control. A thinking-only model is not guaranteed to stop reasoning when the setting is off. Local context/memory and generation speed remain finite; uncapped task rounds/output do not make a small model capable of every task.
- File edits, commands and internet access retain their existing review/approval policies. A successful command benchmark is not proof that a full website meets its requirements. See `AGENT-TEST-REPORT.md` and `AGENT-TEST-COMPARISON.md` for measured outcomes.

## License

MIT © [Paladugu Ganesh Naidu](https://github.com/paladuguganeshnaidu)
