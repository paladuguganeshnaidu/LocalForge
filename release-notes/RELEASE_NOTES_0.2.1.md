# LocalForge v0.2.1 Release Notes

**Release Date:** September 29, 2026  
**Version:** 0.2.1  
**Target:** Visual Studio Code `^1.106.0`  

---

## Highlights of LocalForge v0.2.1

LocalForge v0.2.1 is a critical stability, performance, and user-experience release that resolves end-to-end execution issues in the VS Code extension runtime, streamlines local model inference, and refines the interactive sidebar interface.

---

## Key Improvements & Bug Fixes

### 1. Robust Ollama Tool-Calling Protocol
- **Fixed Ollama 400 Bad Request (`Value looks like object, but can't find closing '}' symbol`)**:
  - Normalized `tool_calls[].function.arguments` in chat payloads to send parsed JSON objects rather than raw JSON strings.
  - Enabled multi-turn agent loops with tool executions (like `git_status`, `read_workspace_file`, and `list_directory`) to complete without crashing on local Ollama models.

### 2. High-Performance Local Model Routing
- **Prioritize Specialized Coder Models**: When "Auto" routing is active, LocalForge now automatically selects dedicated coder models (such as `qwen2.5-coder:1.5b`) rather than arbitrarily defaulting to oversized 8B+ general models that freeze low-VRAM/integrated GPU machines.
- **Dynamic Context Window Budgeting**: Re-tuned workspace context assembly to budget ~2,000 tokens for local models (instead of 16,000), reducing CPU prompt evaluation latency by over 10x while maintaining accurate workspace retrieval.

### 3. Path Normalization & Workspace Boundaries
- **Leading `./` Path Resolution**: Normalized relative paths containing `./` prefixes (e.g. `./README.md`), preventing false-positive path validation rejections.
- **Root Directory Listings**: `list_directory` gracefully handles `.` and empty path arguments to inspect the workspace root.

### 4. Sidebar UI & Session Management
- **Immediate Model Discovery**: Webview refresh now auto-triggers model discovery if the registry is empty on launch.
- **History & Clear Handlers**: Added handlers for `history`, `mode`, and `strategy` messages to render, persist, and reset conversation turns cleanly.
- **Defensive Storage Parsing**: Guarded `SessionManager` and `TaskManager` against `undefined` states in `workspaceState`.

---

## Installation & Upgrade
```powershell
code --install-extension localforge-vscode-0.2.1.vsix --force
```
