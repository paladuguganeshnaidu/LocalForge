# LocalForge Production Release Checklist

**Target Version:** LocalForge v0.2.0 Autonomous Engineering Operating System  
**Date:** September 2026  
**Auditor & Release Engineer:** Principal Systems Architect & Release Engineer  

---

## 1. Engineering Verification Gate

| Step | Verification Gate | Command | Status |
| :---: | :--- | :--- | :---: |
| 1 | **TypeScript Compilation** | `npm run compile` | **PASSED** (0 errors) |
| 2 | **Full Unit & Stress Test Suite** | `npm test` | **PASSED** (95+ passing) |
| 3 | **VS Code Extension Host Test** | `npm run test:extension-host` | **PASSED** (Exit 0) |
| 4 | **Production Packaging** | `npm run package` | **PASSED** (VSIX generated) |
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
- [x] **Remote GPU Mode:** Pinned SSH host key verification and real-time `nvidia-smi` telemetry.
- [x] **Clean VSIX Packaging:** VSIX package built without dev-only runtime dependencies or plaintext secrets.

---

## 3. Post-Install Manual Acceptance Test

1. Install the VSIX into a clean VS Code profile:
   ```bash
   code --install-extension localforge-vscode-0.1.7.vsix
   ```
2. Open a software repository.
3. Open the Secondary Sidebar -> **LocalForge Agent**.
4. Confirm discovered local models (e.g. `qwen2.5-coder:7b`).
5. Execute an Ask task: `"Explain project architecture"` -> verify no file mutations occur.
6. Execute an Agent task: `"Add a health check endpoint and test it"` -> observe DAG subagent dispatching, code edit proposal, diff review, automated test run, and walkthrough artifact generation.
7. Run `LocalForge: Doctor` and `LocalForge: Run Self-Test` to confirm all 13 runtime subsystems report healthy.
