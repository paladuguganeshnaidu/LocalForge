# LOMVREN 0.2.5 Release Checklist

**Target Version:** LOMVREN v0.2.5
**Date:** September 2026  
**Auditor & Release Engineer:** Principal Systems Architect & Release Engineer  

---

## 1. Engineering Verification Gate

| Step | Verification Gate | Command | Status |
| :---: | :--- | :--- | :---: |
| 1 | **TypeScript Compilation** | `npm run compile` | **PASSED** (0 errors) |
| 2 | **Full Unit & Stress Test Suite** | `npm test` | **PASSED** (107 passed) |
| 3 | **VS Code Extension Host Test** | `npm run test:extension-host` | **PASSED** (Exit 0) |
| 4 | **Production Packaging** | `npm run package` | **PASSED** (0.2.5 VSIX and payload checks) |
| 5 | **Security Hardening** | `tests/workspaceSecurity.test.js` | **PASSED** (0 escapes) |
| 6 | **Automated Doctor Check** | `localforge.doctor` | **PASSED** (All green) |
| 7 | **Automated Self-Test** | `localforge.selfTest` | **PASSED** (13/13 passed) |

---

## 2. Release Acceptance Criteria

- [x] **Zero TypeScript Errors:** Strict typechecking enforced across all source modules.
- [x] **Zero Mock Fallbacks in Runtime:** Real process execution, real filesystem diffs, real HTTP streaming.
- [x] **12 Specialized Agent Roles:** Orchestrator, Planner, Repository Analyst, Researcher, Coder, Test Engineer, Debugger, Reviewer, Security Reviewer, Documentation Agent, Git Agent, Performance Agent.
- [x] **Dynamic TaskGraph (DAG):** Topological sorting, cycle detection, parallel execution, and file write conflict prevention.
- [x] **35+ Core Tools Registered:** Filesystem, Git, diagnostics, project analysis, terminal execution, and capability-gated browser tools.
- [x] **Immutable Trust Hierarchy:** Workspace data isolated within `<untrusted_workspace_data>` tags.
- [x] **Persistent Checkpoints:** Task states survive extension reloads and VS Code restarts.
- [x] **Cross-Platform Process Termination:** Windows `taskkill /pid ... /T /F` and POSIX process groups verified without zombie processes.
- [ ] **Remote GPU Mode:** SSH fixture tests pass; live SSH/GPU acceptance is unverified for this release.
- [x] **Clean VSIX Packaging:** VSIX package built without dev-only runtime dependencies or plaintext secrets.

---

## 3. Remaining Manual Acceptance Tests

The normal VS Code profile installation and a live SSH GPU host have not been verified on this workstation. Complete these steps before claiming full production acceptance.

1. Install the VSIX into a clean VS Code profile:
   ```bash
   code --install-extension localforge-vscode-0.2.5.vsix
   ```
2. Open a software repository.
3. Open the Secondary Sidebar -> **LocalForge Agent**.
4. Confirm discovered local models (e.g. `qwen2.5-coder:7b`).
5. Execute an Ask task: `"Explain project architecture"` -> verify no file mutations occur.
6. Execute an Agent task: `"Add a health check endpoint and test it"` -> observe DAG subagent dispatching, code edit proposal, diff review, automated test run, and walkthrough artifact generation.
7. Run `LocalForge: Doctor` and `LocalForge: Run Self-Test` to confirm all 13 runtime subsystems report healthy.
