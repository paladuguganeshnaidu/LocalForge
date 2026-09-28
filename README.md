# LocalForge

LocalForge is a local-first VS Code coding assistant. It discovers models already running on your machine, routes chat and code tasks through provider adapters, and can optionally connect to a remote Ollama server through a pinned SSH tunnel.

## Implemented features

- Automatically detects local Ollama and configured OpenAI-compatible servers, then lists their installed models together.
- Streams chat responses with safe markdown rendering, language badges, and one-click code copy buttons.
- Persistent per-workspace conversation history with quick clear/reset controls.
- Context-aware: includes selected code, current file, or local lexical workspace retrieval.
- Commands for code review and edits:
  - **LocalForge: Explain Selected Code**: Streams explanation directly into chat sidebar.
  - **LocalForge: Fix Selected Code or Diagnostics**: Automatically inspects editor compiler errors/warnings, proposes fixes in VS Code diff review.
  - **LocalForge: Propose a Diff-Reviewed Edit**: Arbitrary instruction-driven diff editing with explicit Apply/Discard.
  - **LocalForge: Search Workspace Context**: Interactive lexical snippet finder.
- Integrated right-click editor context menu for Explain, Fix, and Propose Edit.
- Routes chat, edit, agent, and completion tasks through explicit model preferences, with the sidebar selection as a fallback.
- Supports named SSH remote profiles using a private key or password with SecretStorage and host key pinning.
- Forwards remote Ollama over a loopback-only local port with optional read-only `nvidia-smi` status.

## First run

1. Install and start Ollama, or start a compatible local OpenAI API server.
2. Open the LocalForge activity-bar icon, refresh models, and select one.
3. Use right-click editor context menu or Command Palette to **Explain**, **Fix**, or **Propose an Edit**.
4. Enable **LocalForge › Autocomplete: Enabled** only if you want inline suggestions; it is disabled by default.
5. To use a remote GPU host, run **LocalForge: Configure Remote GPU Host**, then **LocalForge: Connect to Remote GPU Host**.

## Providers and routing

The default Ollama endpoint is `http://127.0.0.1:11434`. Local OpenAI-compatible endpoints default to `http://127.0.0.1:1234/v1`, `http://127.0.0.1:8080/v1`, and `http://127.0.0.1:8000/v1`. Configure the comma-separated list with `localforge.providers.openAICompatibleUrls`.

Set `localforge.routing.chatModel`, `localforge.routing.editModel`, `localforge.routing.agentModel`, or `localforge.routing.completionModel` to a discovered model id or provider id. Leave these blank to use the sidebar selection/fallback. Agent mode is available from the chat sidebar and uses only bounded workspace search/read tools.

## Privacy and safety

- Prompts and enabled editor/workspace context are sent to the selected model server. LocalForge has no cloud inference service.
- Repository retrieval is lexical, workspace-trust gated, and capped by file size, candidate count, and context length. No embedding service is used.
- Proposed edits never modify files until **Apply** is chosen after reviewing the diff; the source document must not have changed while the diff is open.
- Remote credentials are stored in VS Code SecretStorage, not workspace settings. The SSH host key must be verified and then pinned. The tunnel binds only to `127.0.0.1` and is closed when disconnected or when the extension deactivates.
- The GPU probe runs only the fixed, read-only `nvidia-smi` query. LocalForge does not install remote packages, run arbitrary shell commands, or automatically download models.
- Inline completions are opt-in and send nearby editor text to the selected model provider.

## Build and test

```sh
npm ci
npm test
npm run package
```

The VSIX can be installed through **Extensions: Install from VSIX...** in VS Code or with `code --install-extension <file.vsix>`.

## License

This project is licensed under the [MIT License](LICENSE).

