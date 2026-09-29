# LocalForge Codebase File Matrix Audit

**Audit Date:** September 2026  
**Auditor:** Principal Engineer & Systems Architect  
**Scope:** Complete inventory of all source, configuration, and infrastructure files.

---

## Complete Source Code Matrix

| File Path | Purpose | Dependents | Dependencies | Risk | Status | Required Changes |
| :--- | :--- | :--- | :--- | :---: | :---: | :--- |
| `src/extension.ts` | Main VS Code extension activation, command registrations, UI wiring | VS Code Host | `LocalForgeEngine`, `chatView`, `completionProvider`, `vscode` | Medium | Functional | Wire new doctor (`localforge.doctor`) and self-test (`localforge.selfTest`) commands. |
| `src/agent/agentEngine.ts` | Orchestrates single agent runs and automated test validation/repair loop | `LocalForgeEngine` | `agentLoop`, `validationEngine`, `toolRegistry`, `permissionManager` | High | Functional | Connect to multi-agent orchestrator and DAG task scheduler. |
| `src/agent/agentLoop.ts` | Core conversational tool execution loop | `agentEngine`, `toolAgent` | `modelProvider`, `toolRegistry`, `permissionManager`, `toolCallParser` | High | Functional | Support cooperative tool cancellation and typed error emission. |
| `src/agent/permissionManager.ts` | Evaluates tool permissions, user approval policies, shell command safety | `agentLoop`, `LocalForgeEngine`, `toolRegistry` | None | Critical | Functional | Unify command validation with `CommandPolicy` and strict shell parsing. |
| `src/agent/toolAgent.ts` | Legacy adapter function `runToolAgent` | Legacy tests | `agentLoop`, `toolRegistry`, `permissionManager` | Low | Deprecated | Mark deprecated and forward calls to canonical `AgentLoop`. |
| `src/agent/toolCallParser.ts` | Universal tool-call parser supporting native, XML, fenced JSON, bare JSON | `agentLoop`, `ollamaProvider` | None | Critical | Production | Expand streaming delta parsing and argument chunk validation. |
| `src/agent/toolRegistry.ts` | Central registry for tools, categories, definitions, and execution handlers | `agentLoop`, `LocalForgeEngine` | `permissionManager`, `modelProvider` | High | Functional | Expand to 35+ core tools (Git, diagnostics, filesystem). |
| `src/agent/validationEngine.ts` | Detects project type (npm, cargo, python) and executes validation tests | `agentEngine` | `vscode`, `node:child_process` | Medium | Functional | Expand test frameworks detection and structured error diagnostics parsing. |
| `src/agent/workspaceTools.ts` | Implementations of workspace filesystem and terminal execution tools | `LocalForgeEngine`, tests | `vscode`, `node:fs/promises`, `workspaceContext`, `editEngine` | Critical | Functional | Add Windows device path protection and UNC path guards. |
| `src/browser/browserTool.ts` | Browser automation tool (capability-gated HTTP fetching and inspection) | `LocalForgeEngine` | `node:http`, `node:https` | Medium | Functional | Add private IP gating and offline capability checks. |
| `src/completion/completionProvider.ts` | Low-latency inline code completion provider | `extension.ts` | `compositeProvider`, `vscode` | Low | Functional | Ensure debounce and cancellation propagation on keystrokes. |
| `src/context/contextBudget.ts` | Allocates strict token budgets across prompt sections | `contextEngine` | None | Medium | Production | Maintain token limits per model context window. |
| `src/context/contextEngine.ts` | Builds context package combining snippets, git status, and diagnostics | `LocalForgeEngine` | `workspaceIndexer`, `contextBudget`, `vscode` | High | Functional | Integrate symbol graph and untrusted data boundary tags. |
| `src/context/gitContext.ts` | Reads git status, diffs, and branch information via git CLI | `LocalForgeEngine`, `referenceResolver` | `node:child_process` | Medium | Functional | Expand to support branch manipulation, commits, and worktrees. |
| `src/context/referenceResolver.ts` | Parses slash commands (`/plan`, `/diagnose`, `/clear`) and `@file` references | `LocalForgeEngine` | `gitContext`, `terminalManager` | Medium | Functional | Add support for newly specified slash commands (`/agent`, `/review`). |
| `src/context/relevance.ts` | Scoring algorithm ranking file snippets by query similarity | `retrieval.ts` | None | Low | Production | Maintain keyword frequency and path proximity weighting. |
| `src/context/retrieval.ts` | Extracts and windows relevant code snippets | `workspaceContext.ts` | `relevance.ts` | Low | Production | Enforce line windowing and character caps. |
| `src/context/workspaceContext.ts` | Workspace snippet search across files | `workspaceTools.ts` | `retrieval.ts`, `vscode` | Medium | Functional | Maintain file read size caps and UTF-8 validation. |
| `src/context/workspaceIndexer.ts` | Real-time incremental file system watcher and indexer | `LocalForgeEngine` | `vscode` | High | Production | Add incremental symbol indexing. |
| `src/core/artifactManager.ts` | Creates and persists deliverable artifacts (plans, walkthroughs) | `LocalForgeEngine` | None | Low | Production | Support machine-readable structured artifacts. |
| `src/core/diagnosticsService.ts` | Generates diagnostic health report for models, GPU, and indexer | `LocalForgeEngine`, `extension.ts` | `modelRegistry`, `remoteManager`, `workspaceIndexer` | Medium | Functional | Upgrade into canonical `localforge.doctor`. |
| `src/core/events.ts` | Lightweight typed EventEmitter for engine events | `LocalForgeEngine` | `node:events` | Low | Production | Add multi-agent lifecycle events. |
| `src/core/LocalForgeEngine.ts` | Central engine orchestrating models, context, sessions, and tasks | `extension.ts` | All core services | Critical | Functional | Integrate multi-agent orchestrator and DAG task scheduler. |
| `src/core/sessionManager.ts` | Manages conversation sessions in VS Code workspace memento | `LocalForgeEngine` | `vscode` | Medium | Functional | Add checkpoint save and resume capabilities. |
| `src/core/taskManager.ts` | Records historical tasks, completion statuses, and modified files | `LocalForgeEngine` | `vscode` | Medium | Functional | Connect task records to subagent task graph nodes. |
| `src/core/turnManager.ts` | Tracks conversational turns, operational activities, and status badges | `LocalForgeEngine` | None | High | Production | Support multi-agent concurrent activity streams. |
| `src/editing/diffService.ts` | Generates unified diffs and calculates additions/deletions | `editEngine.ts` | None | High | Production | Deterministic LCS line diff generation. |
| `src/editing/editEngine.ts` | Two-phase atomic multi-file edit proposals and hash validation | `LocalForgeEngine`, `workspaceTools.ts` | `diffService`, `patchService`, `vscode` | Critical | Production | Add transactional rollback journal and range replacement. |
| `src/editing/patchService.ts` | Computes SHA-256 hashes and verifies clean file state | `editEngine.ts` | `vscode`, `node:crypto` | High | Production | Maintain hash verification. |
| `src/features/completionProvider.ts` | Legacy 2-line re-export shim | None | `completion/completionProvider` | Low | Deprecated | Remove in Phase B cleanup. |
| `src/providers/compositeProvider.ts` | Routes requests across registered local and remote providers | `LocalForgeEngine` | `modelProvider` | High | Functional | Route based on canonical ModelRef IDs. |
| `src/providers/modelCapabilities.ts` | Infer capabilities and canonical `ModelRef` definitions | `modelRegistry`, `modelRouter` | None | High | Production | Support local GPU and accelerator metadata. |
| `src/providers/modelProvider.ts` | Core interfaces for providers, models, chat messages, and tools | All providers | None | Critical | Production | Maintain strict TypeScript typing. |
| `src/providers/modelRegistry.ts` | Discovers models across providers and queries capabilities | `LocalForgeEngine` | `modelProvider`, `modelCapabilities` | High | Functional | Add hardware discovery telemetry. |
| `src/providers/modelRouter.ts` | Heuristic router selecting best model for task type | `LocalForgeEngine` | `modelRegistry`, `modelCapabilities` | Medium | Functional | Support task-based model scoring and ranking. |
| `src/providers/ollamaProvider.ts` | Native adapter for local Ollama HTTP API | `LocalForgeEngine` | `modelProvider`, `node:http` | High | Functional | Maintain streaming and non-streaming tool calling. |
| `src/providers/openAiCompatibleProvider.ts` | Adapter for LM Studio, llama.cpp, vLLM servers | `LocalForgeEngine` | `modelProvider`, `node:http` | High | Functional | Maintain OpenAI protocol compatibility. |
| `src/remote/gpuMonitor.ts` | Parses `nvidia-smi` CSV telemetry and predicts VRAM model fit | `remoteManager.ts` | None | Low | Production | Add local GPU detection support. |
| `src/remote/remoteManager.ts` | Manages SSH tunnels and remote GPU provider lifecycle | `LocalForgeEngine`, `extension.ts` | `sshOllamaTunnel`, `compositeProvider`, `modelRegistry` | High | Functional | Maintain pinned host key verification. |
| `src/remote/sshOllamaTunnel.ts` | SSH tunnel connection using `ssh2` with port forwarding | `remoteManager.ts` | `ssh2`, `node:net` | High | Functional | Pinned host key verification and zero credential exposure. |
| `src/terminal/terminalManager.ts` | Cross-platform subprocess execution with process tree kill | `LocalForgeEngine`, `workspaceTools.ts` | `node:child_process`, `vscode` | Critical | Production | Support real-time output chunk streaming. |
| `src/ui/chatView.ts` | Monolithic Secondary Sidebar webview provider (HTML/CSS/JS) | `extension.ts` | `LocalForgeEngine`, `compositeProvider`, `vscode` | High | Functional | Stream multi-agent events and avoid state invention. |
| `src/ui/webviewMessages.ts` | Runtime validation for incoming webview messages (`isWebviewMessage`) | `chatView.ts`, `extension.ts` | None | High | Production | Strict message schema validation. |
| `src/ui/webviewState.ts` | Defines state contract between extension and webview | `chatView.ts` | None | Medium | Production | Maintain strict bidirectional state synchronization. |
| `package.json` | Extension manifest, contributes, commands, configurations, scripts | VS Code, npm | None | Critical | Production | Clean dependencies, correct activation events. |
| `tsconfig.json` | TypeScript compiler configuration | `tsc` | None | Critical | Production | Strict typing enabled (`strict: true`). |
| `.github/workflows/ci.yml` | GitHub Actions CI workflow | GitHub Actions | npm | Critical | Production | Run compile, test, package on Node 22. |

---

## Conclusion of Phase 1 Forensic Audit

The forensic audit is complete. All 6 required audit documents have been created in `/docs/audit/`:
1. `/docs/audit/ARCHITECTURE_AUDIT.md`
2. `/docs/audit/PRODUCTION_READINESS.md`
3. `/docs/audit/SECURITY_AUDIT.md`
4. `/docs/audit/TEST_GAP_ANALYSIS.md`
5. `/docs/audit/IMPLEMENTATION_MAP.md`
6. `/docs/audit/FILE_MATRIX.md`

We are now cleared by the engineering rules to proceed to **Phase B: Remove Architectural Duplication & Dead Code**, followed by **Phase C: Canonical Contracts**, and **Phase D / K: Multi-Agent Runtime Engine**.
