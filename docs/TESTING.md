# LocalForge Testing Strategy & Verification Guide

**Version:** LocalForge v0.2.0 Autonomous Engineering Operating System  
**Classification:** Quality Assurance & Testing Architecture  
**Date:** September 2026  

---

## 1. The 10-Layer Testing Strategy

LocalForge is verified through 10 distinct, non-overlapping testing layers to ensure bulletproof reliability before release:

```
+-------------------------------------------------------------+
| Layer 10: Real End-to-End Local Model Live Acceptance      |
+-------------------------------------------------------------+
| Layer 9:  Real VS Code Extension Host Testing (@vscode)     |
+-------------------------------------------------------------+
| Layer 8:  Security & Path Traversal Fuzzing                |
+-------------------------------------------------------------+
| Layer 7:  Real Terminal & Cross-Platform Subprocess Tests   |
+-------------------------------------------------------------+
| Layer 6:  Filesystem & Atomic Two-Phase Edit Tests          |
+-------------------------------------------------------------+
| Layer 5:  Model Provider & Streaming Protocol Tests        |
+-------------------------------------------------------------+
| Layer 4:  Multi-Agent Runtime & DAG Orchestration Tests     |
+-------------------------------------------------------------+
| Layer 3:  Real Tool Registry Execution Tests                |
+-------------------------------------------------------------+
| Layer 2:  End-to-End Subsystem Integration Tests            |
+-------------------------------------------------------------+
| Layer 1:  Pure Unit Tests (Diffs, Hashing, Normalization)   |
+-------------------------------------------------------------+
```

---

## 2. High-Volume Mass Testing & Fuzzing

LocalForge includes dedicated high-volume stress suites (`tests/highVolumeStress.test.js`) executing **3,320+ iterations**:
- **1,000 Valid Tool Parser Inputs:** Fuzzing XML, native JSON, fenced Markdown, and nested tool calls.
- **1,000 Malformed Output Cases:** Verifying zero crashes or unhandled rejections when models emit malformed JSON, truncated tags, or syntax errors.
- **1,000 Path Validation Security Cases:** Stress-testing traversal vectors, UNC paths, and Windows reserved device names (`CON`, `PRN`, `AUX`, `NUL`).
- **1,000 Webview Message Contracts:** Verifying strict runtime validation via `isWebviewMessage`.
- **100 Edit Proposal & Diff Hashes:** Validating deterministic SHA-256 hash generation and line diff statistics.
- **100 Permission & Shell Safety Cases:** Verifying operator blocking and command classification.
- **100 Synthetic AgentLoop Step Boundaries:** Verifying loop bounds, round limits, and timeout enforcement.
- **10 Real Subprocess Executions:** Testing stdout/stderr capture, exit codes, and process tree termination on Windows and POSIX.

---

## 3. How to Run the Test Suites

### Run All Unit and Integration Tests:
```powershell
npm test
```
*Compiles TypeScript with `tsc -p ./` and executes all 27+ test files under `tests/*.test.js` using Node.js native test runner.*

### Run Real VS Code Extension Host Tests:
```powershell
npm run test:extension-host
```
*Spawns a real, headless instance of VS Code via `@vscode/test-electron`, activates the LocalForge extension, tests command registration, Secondary Sidebar view resolution, model switching, and agent execution.*

### Run Automated Self-Test:
Inside VS Code, open the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`) and run:
```text
LocalForge: Run Self-Test
```
Or execute `LocalForge: Doctor` to inspect platform health, providers, models, GPU, and Git integration.
