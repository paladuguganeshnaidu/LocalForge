# LocalForge Product Plan

## Product goal

LocalForge is a local-first VS Code coding assistant that discovers models already available on the developer's machine, lets those models power chat, code edits, repository-aware agent tasks, and autocomplete, and can optionally route inference to a user's own remote GPU host over a secured SSH tunnel. The extension must remain useful with only a local Ollama installation and must never require a LocalForge cloud service.

## Architecture principles

- Treat model runtimes as providers behind one typed interface; the UI and features do not depend on Ollama-specific APIs.
- Keep provider transport, conversation orchestration, context retrieval, editor integration, and presentation in separate modules.
- Make local inference the default. Remote inference is opt-in, tunneled over SSH, and secrets are stored only in VS Code `SecretStorage`.
- Preview every code change in VS Code's diff editor. Never modify files or run commands without explicit user action.
- Make repository indexing workspace-scoped, ignore generated/dependency/binary files, cap context, and honor VS Code workspace trust.
- Cancel superseded requests and enforce timeouts, response limits, and clear user-facing errors.
- Test provider parsing, ranking/routing, secret and tunnel lifecycle, edit review, and extension packaging independently.

## Delivery phases and acceptance criteria

### 1. Stable core and provider platform

- Complete provider contract, model metadata/capabilities, cancellation, configurable endpoints, health status, refresh, and actionable diagnostics.
- Support local Ollama first; keep the adapter contract ready for OpenAI-compatible local servers such as LM Studio, llama.cpp server, and vLLM.
- Acceptance: deterministic tests cover detection, model discovery, streamed content, malformed streams, HTTP errors, and aborts.

### 2. Copilot-like chat and editor workflows

- Ship accessible sidebar chat, persistent per-workspace conversations, model selection, selected/current-file context, and clear/reset/cancel controls.
- Add explain, fix, and edit-selection commands. Show proposed edits in a diff and require an explicit Apply or Discard action.
- Acceptance: webview message validation, no unsafe HTML rendering, context limits, cancellation, and diff application tests pass.

### 3. Repository context and retrieval

- Add a workspace file index that observes excludes and `.gitignore`, extracts useful text files, and retrieves relevant snippets lexically first.
- Define an embedding/index interface for later vector retrieval without requiring embeddings to use core chat.
- Acceptance: ignore rules, size caps, relevance ordering, workspace trust, and index refresh tests pass; no repository content leaves the configured provider.

### 4. Safe agent mode

- Add bounded read/search tools scoped to the trusted workspace. Tool calls are allow-listed, validated, loop-limited, and visible in the UI.
- No shell execution in the initial agent. Tests and terminal commands remain a user-approved follow-up action.
- Acceptance: traversal, outside-workspace, oversized-file, malformed-call, cancellation, and tool-loop limits are tested.

### 5. Remote GPU execution

- Add named remote profiles with host, port, username, key-file or password authentication, remote Ollama address, and optional GPU probe.
- Keep passwords/passphrases in `SecretStorage`; do not serialize them into settings, logs, telemetry, or the workspace.
- Create and tear down a loopback-only SSH local-forward tunnel to remote Ollama. Use static, non-shell GPU inspection (`nvidia-smi`) and surface availability without changing the remote machine.
- Acceptance: mocked SSH tests cover auth failure, host-key policy, tunnel lifecycle, reconnection, cleanup, and secret deletion. No implicit server installation or command execution.

### 6. Autocomplete and model routing

- Add debounced, cancellable inline completions with configurable model, context budget, and privacy note.
- Add transparent task routing (chat/edit/agent/complete) with manual overrides and fallback explanations.
- Acceptance: stale results are cancelled, completion never edits files, routing is deterministic and user-overridable.

### 7. Release hardening

- Add focused unit/integration tests, CI packaging, Marketplace metadata, privacy/security documentation, troubleshooting, changelog, and a user-chosen license.
- Test the packaged VSIX in VS Code and against an available Ollama server. Verify Marketplace package identity before publishing each version.
- Acceptance: clean install/build/test/package, Marketplace icon constraints met, no secrets or development-only assets in VSIX, and release checklist reviewed.

## Current implementation status

- Phase 1: substantially implemented — provider abstraction, Ollama discovery/list/stream/tool-call parsing, OpenAI-compatible endpoint discovery, composite provider registry, task routing, and deterministic tests.
- Phase 2: substantially implemented — sidebar chat with safe markdown rendering & code copy buttons, model selection, cancellation, persistent per-workspace conversation history, clear/reset controls, selected/current-file context, diff-reviewed single-file edits, explain selection, fix selection/diagnostics commands, and editor context menus.
- Phase 3: partial — trusted-workspace bounded lexical retrieval and search exist. A persistent `.gitignore`-aware index and embeddings/vector retrieval are not implemented.
- Phase 4: implemented as a bounded initial slice — model-driven, loop-limited allow-listed search/read tools, workspace-trust gating, size limits, path checks, and tests exist. No shell or write tools are exposed.
- Phase 5: implemented but not live-host verified — named SSH profiles, SecretStorage credentials, pinned host key, loopback forwarding, and fixed read-only NVIDIA probe exist. Remote auth/tunnel/GPU end-to-end testing requires a real host.
- Phase 6: partial — opt-in debounced/cancellable inline completions and manual task routing exist. Stale-result, context-budget, and route-fallback UX hardening remains.
- Phase 7: substantially implemented — 20 passing unit tests covering providers, routing, agent loop, relevance, remote tunnel pinning, security traversal prevention, explain/fix prompts, and webview messages. Clean VSIX packaging with MIT License and zero compiler warnings.

## Explicitly out of scope until separately designed

- A LocalForge-hosted service, model downloads on behalf of users, automatic GPU driver changes, remote package installation, unattended shell access, automatic file writes, and telemetry of prompts or source code.
