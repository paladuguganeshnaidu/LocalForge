# Changelog

All notable changes to the LocalForge extension are documented in this file.

## [0.1.3] - 2026-09-28

### Fixed
- **Webview CSP & Communication Bridge**: Added `${webview.cspSource}` to `script-src` and `style-src` in the Webview Content Security Policy. Previously, omitting `cspSource` blocked VS Code's internal communication runtime and prevented `acquireVsCodeApi()` from running, leaving the webview indefinitely stuck on static placeholder text ("Discovering models…").
- **Instant Model Delivery**: When the webview announces readiness (`ready`), cached models are now sent immediately in 0 ms, eliminating UI loading delays while background refresh confirms live status.
- **Fail-Safe UI Error Boundary**: Wrapped the webview initialization script in a `try/catch` error boundary that displays any script or DOM error directly on the status card instead of hanging silently.
- **Optimized Provider Detection**: Reduced connection timeouts on offline OpenAI-compatible endpoints from 2–5s to 1s, preventing closed local ports from delaying Ollama discovery.
- **Heartbeat Retry**: Added an automatic handshake heartbeat if initial iframe mounting misses early message delivery.

## [0.1.2] - 2026-09-28

### Fixed
- **VS Code Webview Loading**: Added missing `"type": "webview"` to view contributions in `package.json`. In previous versions, VS Code treated the view as a tree view, preventing `resolveWebviewView` from being called and breaking the sidebar UI.
- **Model Discovery Lifecycle**: Fixed an early-return bug in `refresh()` that aborted discovery when the view was not yet visible. Models are now discovered and cached in the background upon extension startup.
- **Handshake Order**: Attached webview message listeners prior to setting HTML content to prevent dropped initial handshake events.
- **Ollama Detection**: Added fallback probes across `/api/version`, `/api/tags`, and `/` with timeouts for reverse proxies and various Ollama configurations.
- **Composite Routing**: Auto-hydrates model routes on cache miss before raising errors.

### Added
- **Explain Selected Code**: New `localforge.explain` command streams contextual code explanations directly into the sidebar chat.
- **Fix Selected Code or Diagnostics**: New `localforge.fix` command automatically queries active language compiler and linter errors at the cursor or selection, proposing reviewed fixes in VS Code's diff editor (`vscode.diff`).
- **Editor Context Menus**: Added right-click editor context menu actions for **Explain**, **Fix**, and **Propose Edit**.
- **Conversation Persistence**: Chat history is now saved per-workspace in `workspaceState` and restored across reloads.
- **Clear Conversation**: Added `⌫ Clear` control in the sidebar to reset active model conversations.
- **Safe Markdown Rendering**: Code snippets render with language badges and one-click **Copy** buttons.
- **Traversal Protection**: Added `validateRelativeWorkspacePath` to prevent directory traversal in agent read tools.
- **Official MIT License**: Included repository `LICENSE` file.
- **Unit Testing**: Expanded test suite to 20 unit tests with 100% pass rate.

## [0.1.1] - 2026-09-28

### Added
- Remote GPU host configuration over secured SSH loopback tunnels.
- Pinned SHA-256 host key verification and SecretStorage credential storage.
- Read-only GPU status probe (`nvidia-smi`).
- OpenAI-compatible provider endpoints (LM Studio, llama.cpp server, vLLM).
- Safe initial agent mode with allow-listed search and read tools.

## [0.1.0] - 2026-09-28

### Added
- Initial local-first VS Code extension slice.
- Local Ollama server auto-detection and model listing.
- Streaming chat sidebar.
- Diff-reviewed single-file edit proposals.
- Opt-in inline autocomplete completions.
