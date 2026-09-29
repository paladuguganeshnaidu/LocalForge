# Lomvern v0.2.4 Release Notes

**Release Date:** September 30, 2026  
**Version:** 0.2.4  
**Target:** Visual Studio Code `^1.106.0`  

---

## Highlights of Lomvern v0.2.4

Lomvern (formerly LocalForge) v0.2.4 officially introduces the new **Lomvern** brand identity and custom logo, delivers rock-solid webview lifecycle stability, resolves UI prompt latching, guarantees full Chromium Level 3 Content Security Policy compliance, and validates 100% of extension host operations inside real VS Code Electron environments.

---

## Key Improvements & Bug Fixes

### 1. Webview Lifecycle Protection & API Singleton
- **Singleton `acquireVsCodeApi()`**: Wrapped `acquireVsCodeApi()` in a cached singleton (`window.__cachedVsCodeApi`) to protect webviews against uncaught exceptions when VS Code reloads or retains webview context (`retainContextWhenHidden: true`).
- **Uncaught Exception Resilience**: Prevents script crash on initialization, ensuring DOM event listeners always attach reliably.
- **Global Error Telemetry**: Added `window.addEventListener('error')` inside the webview to capture and log any client-side JavaScript issues.

### 2. Prompt Submission & Button Latching Fix
- **Unlatched Send Button**: Refactored `sendBtn` so that if `sendBtn.textContent !== 'Cancel'`, it unconditionally invokes `sendMessage()` and clears any stale busy states.
- **Explicit Button Typing & Propagation**: Added `type="button"` and `e.preventDefault() / e.stopPropagation()` to both the Send button click and Enter keydown handlers.
- **Stale Task Auto-Cancellation**: Incoming user prompts automatically cancel any previously hung or timed-out background tasks, keeping the UI responsive.

### 3. Chromium Level 3 CSP Standardized
- **Strict Nonce Enforcement**: Standardized the webview `<meta>` Content Security Policy to `script-src 'nonce-${nonce}';`.
- **Eliminated Directive Conflicts**: Removed invalid mixing of `'unsafe-inline'` with nonces, ensuring strict compliance with modern Chromium CSP rules.

### 4. Workspace Grounding
- **Root Context Injection**: `ContextEngine.assembleContext()` automatically injects the repository root folder name and `package.json` metadata (name, version, description) into the initial context.
- **Immediate Project Awareness**: Compact local models (`1.5B` to `7B`) immediately ground their understanding of the workspace on the very first turn without needing preliminary discovery queries.

### 5. Extension API Export & Electron Integration Testing
- **Public API Export**: `activate()` now exports `LocalForgeExtensionApi` exposing `engine` and `viewProvider`.
- **Real-Environment Electron Testing**: Automated extension host test suite (`npm run test:extension-host` via `@vscode/test-electron`) verifies all 16 commands, filesystem operations, managed terminal, and live webview IPC inside a real VS Code Electron instance.
- **100% Test Coverage**: All 96 unit, integration, and stress tests pass cleanly (`96/96 pass`).
