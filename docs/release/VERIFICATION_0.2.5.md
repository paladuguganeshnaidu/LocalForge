# LOMVREN 0.2.5 Verification Record

**Date:** 2026-09-30  
**Project:** `C:\Users\ganes\OneDrive\Desktop\LocalForge`

## Verified on this workstation

- TypeScript compilation completed as part of `npm test` and `npm run package`.
- `npm test`: 107 passed, 0 failed.
- `npm run test:extension-host`: all 8 stages passed under VS Code Test Electron 1.139.1, including activation, command registration, doctor/self-test, mode switching, terminal execution, workspace file operations, cancellation, and webview IPC.
- Ollama 0.34.2 responded at `http://127.0.0.1:11434`; discovery returned 8 installed models. `qwen2.5-coder:1.5b` generated a non-empty response using `npm run test:ollama-smoke`.
- `npm run package` created `localforge-vscode-0.2.5.vsix` (3.56 MB). Package identity, compiled entrypoint, icon, and development-payload exclusions passed.

## Not verified / release limitations

- No live SSH GPU host/profile was configured. Remote SSH, model discovery, tunnel lifecycle, and GPU monitoring have fixture/integration coverage only; they were not exercised against the user's remote hardware.
- The VS Code `code` CLI was not found on `PATH`; the extension was exercised through the real Electron extension-host test harness, but was not installed into the user's normal VS Code profile here.
- The package build reports 306 files (109 JavaScript files) and recommends bundling for startup performance. This is a warning, not a build failure.
- These checks do not constitute an independent security audit, guarantee compatibility with every Ollama/OpenAI-compatible server, or certify Marketplace acceptance. Do not describe the extension as fully production-certified based solely on this run.
