# TuxNest — Runtime Integration Map & Architecture Graph

**Date:** October 2026  
**Audited Target:** TuxNest VS Code Extension (`tuxnest-vscode` / v1.0.0)  
**Status:** Authoritative Runtime Convergence Baseline

---

## 1. Production Entry Point & Live Call Graph

The extension entry point is [`src/extension.ts`](file:///c:/Users/ganes/OneDrive/Desktop/LocalForge/src/extension.ts). When activated by VS Code, execution flows through the following graph:

```text
[VS Code Activation: src/extension.ts]
      │
      ├── TuxNestViewProvider (src/ui/chatView.ts)
      ├── ModelCenterViewProvider (src/ui/modelCenter.ts)
      ├── TuxNestCompletionProvider (src/completion/completionProvider.ts)
      │
      └── TuxNestEngine (src/core/LocalForgeEngine.ts)
            │
            ├── ModelRegistry (src/providers/modelRegistry.ts)
            ├── CompositeProvider (src/providers/compositeProvider.ts)
            ├── ModelRouter (src/providers/modelRouter.ts)
            ├── WorkspaceIndexer (src/context/workspaceIndexer.ts)
            ├── ContextEngine (src/context/contextEngine.ts)
            ├── SessionManager (src/core/sessionManager.ts)
            ├── TurnManager (src/core/turnManager.ts)
            ├── ArtifactManager (src/core/artifactManager.ts)
            ├── TerminalManager (src/terminal/terminalManager.ts)
            ├── BrowserTool (src/browser/browserTool.ts)
            ├── PermissionManager (src/agent/permissionManager.ts)
            ├── EditEngine (src/editing/editEngine.ts)
            ├── AgentEngine (src/agent/agentEngine.ts)
            │     └── AgentLoop (src/agent/agentLoop.ts)
            │           └── ToolRegistry (src/agent/toolRegistry.ts)
            │                 ├── coreTools (src/agent/coreTools.ts)
            │                 ├── workspaceTools (src/agent/workspaceTools.ts)
            │                 ├── workflowTools (src/agent/workflowTools.ts)
            │                 └── subagentTools (src/agent/subagentTools.ts)
            │
            └── MultiAgentOrchestrator (src/agent/orchestration/orchestrator.ts)
                  ├── AgentPool (src/agent/orchestration/agentPool.ts)
                  └── AgentManager (src/agent/orchestration/agentManager.ts)
```

---

## 2. Comprehensive Module Classification

Every major subsystem is classified according to actual production call-path reachability:

| Module / Path | Status | Live Callers | Architecture Role / Remediation Plan |
|---|---|---|---|
| `src/extension.ts` | **LIVE_RUNTIME** | VS Code Host | Primary extension entry point and command router. |
| `src/core/LocalForgeEngine.ts` | **LIVE_RUNTIME** | `extension.ts` | Central engine orchestrating sessions, turns, tools, and models. |
| `src/runtime/runManager.ts` | **PARTIALLY_INTEGRATED** | *Tests only* | Must become the authoritative lifecycle kernel of `LocalForgeEngine`. |
| `src/runtime/runStateMachine.ts` | **PARTIALLY_INTEGRATED** | `runManager.ts` | Formal state machine for run states (`idle` -> `planning` -> `executing`). |
| `src/runtime/cancellationTree.ts` | **PARTIALLY_INTEGRATED** | `runManager.ts` | Hierarchical abort propagation; replaces raw `AbortController`. |
| `src/runtime/resourceLeaseManager.ts`| **PARTIALLY_INTEGRATED** | `runManager.ts` | Mutex file, terminal, and port locks. |
| `src/runtime/runBudget.ts` | **PARTIALLY_INTEGRATED** | `runManager.ts` | Multi-dimensional token, time, tool, and file mutation budgets. |
| `src/policy/policyBroker.ts` | **PARTIALLY_INTEGRATED** | *Tests only* | Central capability broker; must mediate `PermissionManager` and all tools. |
| `src/policy/filesystemDefense.ts` | **PARTIALLY_INTEGRATED** | `policyBroker.ts` | Cross-platform traversal, ADS, device, and symlink protection. |
| `src/policy/networkPolicy.ts` | **PARTIALLY_INTEGRATED** | `policyBroker.ts` | SSRF, loopback, private IP, and redirect validation. |
| `src/policy/secretClassifier.ts` | **PARTIALLY_INTEGRATED** | `policyBroker.ts` | High-entropy secret detection and inline redaction. |
| `src/policy/shellParser.ts` | **PARTIALLY_INTEGRATED** | `policyBroker.ts` | AST/lexical shell injection and catastrophic command analysis. |
| `src/terminal/terminalManager.ts` | **LIVE_RUNTIME** | `LocalForgeEngine.ts` | Subprocess lifecycle, ring buffering, and platform shell execution. |
| `src/terminal/environmentFilter.ts`| **PARTIALLY_INTEGRATED** | *Tests only* | Must sanitize `process.env` in `TerminalManager.runCommand`. |
| `src/terminal/shellResolver.ts` | **LIVE_RUNTIME** | `terminalManager.ts`| Multi-shell discovery (Git Bash, WSL, PowerShell, CMD). |
| `src/terminal/commandTimeoutClassifier.ts` | **LIVE_RUNTIME** | `terminalManager.ts`| Adaptive ceilings (10m install, 5m build) and streaming watchdog. |
| `src/terminal/ringBuffer.ts` | **PARTIALLY_INTEGRATED** | *Tests only* | Memory-capped FIFO subprocess output stream buffer. |
| `src/agent/agentLoop.ts` | **LIVE_RUNTIME** | `agentEngine.ts` | Single-agent reasoning and tool dispatch loop. |
| `src/agent/coreTools.ts` | **LIVE_RUNTIME** | `LocalForgeEngine.ts` | System tools: `run_command`, `read_file`, `write_file`, `find_files`. |
| `src/agent/workspaceTools.ts` | **LIVE_RUNTIME** | `LocalForgeEngine.ts` | Workspace mutations with directory traversal guards. |
| `src/agent/orchestration/orchestrator.ts` | **LIVE_RUNTIME** | `LocalForgeEngine.ts` | Multi-agent orchestrator; currently invokes hardcoded `decomposeGoal`. |
| `src/agent/orchestration/dynamicPlanner.ts` | **PARTIALLY_INTEGRATED** | *Tests only* | Must replace static decomposition in `MultiAgentOrchestrator`. |
| `src/agent/orchestration/handoffSchema.ts` | **PARTIALLY_INTEGRATED** | *Tests only* | Typed `AgentHandoffV2` contracts between subagents. |
| `src/agent/orchestration/checkpointManager.ts` | **PARTIALLY_INTEGRATED** | `LocalForgeEngine.ts`| Constructed but not passed into `MultiAgentOrchestrator`. |
| `src/worktree/worktreeManager.ts` | **PARTIALLY_INTEGRATED** | *Tests only* | Ephemeral Git worktree isolation and merge verification for parallel coders. |
| `src/editing/editEngine.ts` | **LIVE_RUNTIME** | `LocalForgeEngine.ts` | Live file mutation engine with diff generation and undo history. |
| `src/editing/transactionalEditEngine.ts` | **PARTIALLY_INTEGRATED**| *Tests only* | Journaled multi-file atomic writes with rollback guarantees. |
| `src/editing/patchValidator.ts` | **PARTIALLY_INTEGRATED** | *Tests only* | Unified diff structure, boundary, and line validity assertions. |
| `src/editing/lineEndingPreserver.ts` | **PARTIALLY_INTEGRATED** | *Tests only* | Preserves exact CRLF / LF line endings across atomic edits. |
| `src/mcp/mcpClient.ts` | **PARTIALLY_INTEGRATED** | *Tests only* | JSON-RPC stdio transport for Model Context Protocol servers. |
| `src/mcp/mcpToolAdapter.ts` | **PARTIALLY_INTEGRATED** | *Tests only* | Adapts external MCP server tools into internal ToolRegistry under policy. |
| `src/hooks/hookEngine.ts` | **PARTIALLY_INTEGRATED** | *Tests only* | Lifecycle hooks for pre/post tool execution and run phases. |
| `src/rules/rulesEngine.ts` | **PARTIALLY_INTEGRATED** | *Tests only* | Rule evaluation against file contexts and user objectives. |
| `src/agent/orchestration/agentProfileLoader.ts` | **PARTIALLY_INTEGRATED** | *Tests only* | Custom `AGENTS.md` and role profile loader. |
| `src/context/symbolIndexer.ts` | **PARTIALLY_INTEGRATED** | *Tests only* | Workspace symbol indexer for AST/declarations. |
| `src/context/dependencyGraph.ts`| **PARTIALLY_INTEGRATED** | *Tests only* | Dependency import graph construction across workspace files. |
| `src/context/contextSanitizer.ts`| **PARTIALLY_INTEGRATED** | *Tests only* | Prompt-injection mitigation and boundary wrapping for retrieved context. |
| `src/context/memoryV2.ts` | **PARTIALLY_INTEGRATED** | *Tests only* | Durable 4-tier structured memory with confidence and TTL. |
| `src/providers/providerGateway.ts`| **PARTIALLY_INTEGRATED** | *Tests only* | Unified multi-provider gateway with health checks and metrics. |
| `src/providers/adaptiveRouter.ts` | **PARTIALLY_INTEGRATED** | *Tests only* | EWMA latency and cost-optimized model routing. |
| `src/review/codeReviewEngine.ts` | **PARTIALLY_INTEGRATED** | *Tests only* | Automated static and stylistic code review engine. |
| `src/review/securityReviewEngine.ts`| **PARTIALLY_INTEGRATED** | *Tests only* | Automated vulnerability scanner for injections and hardcoded secrets. |
| `src/verification/evidencePlanner.ts` | **PARTIALLY_INTEGRATED** | *Tests only* | Structured verification plan generation and evidence validation. |
| `src/verification/testImpactAnalyzer.ts` | **PARTIALLY_INTEGRATED**| *Tests only* | Maps modified files to impacted test suites. |
| `src/verification/debugController.ts` | **PARTIALLY_INTEGRATED** | *Tests only* | Autonomous root-cause analysis and repair controller. |
| `src/sandbox/executionTiers.ts` | **PARTIALLY_INTEGRATED** | *Tests only* | Tier classification (`read_only`, `workspace_host`, `container`, `remote`). |
| `src/observability/runEventLogger.ts` | **PARTIALLY_INTEGRATED** | *Tests only* | Structured JSON event streaming across correlation IDs. |
| `src/runner/runnerProtocol.ts` | **PARTIALLY_INTEGRATED** | *Tests only* | Headless remote runner protocol. |
| `src/runner/scopedVault.ts` | **PARTIALLY_INTEGRATED** | *Tests only* | Ephemeral credential store for runners. |
| `src/ui/chatProtocol.ts` | **PARTIALLY_INTEGRATED** | *Tests only* | Typed RPC message contracts between webview and extension host. |
| `src/computerUse/*` | **NOT_STARTED** | *None* | Native desktop control kernel (ScreenObserver, WindowManager, InputController). |

---

## 3. Disconnection Root Causes

The hostile audit identified that 48 source files were unreached from `src/extension.ts`. Investigation confirms:

1. **Parallel Engine Construction:**
   `LocalForgeEngine` continued to instantiate legacy `AgentAccessPolicy` and legacy `PermissionManager` directly, instead of wiring `PolicyBroker` into the capability decision chain.
2. **Omission in Subsystem Dependency Injection:**
   `CheckpointManager` was instantiated in `LocalForgeEngine` line 150, but line 144 instantiated `MultiAgentOrchestrator` without passing it.
3. **Static Heuristics Bypassing Dynamic Planner:**
   `MultiAgentOrchestrator.decomposeGoal()` implemented inline hardcoded `switch(mode)` rather than delegating to `DynamicPlanner.plan()`.
4. **Direct Inheritance Bypassing Sanitizer:**
   `TerminalManager.runCommand()` spread `...process.env` directly rather than invoking `EnvironmentFilter.sanitizeSubprocessEnv()`.
5. **Stand-alone Tool Modules:**
   `McpToolAdapter`, `WorktreeManager`, `TransactionalEditEngine`, and `EvidencePlanner` were unit-tested in isolation rather than registered into `ToolRegistry` and `EditEngine`.

---

## 4. Target Unified Runtime Architecture

All 48 modules converge into a single authoritative pipeline:

```text
User Request / Command / UI Message
        │
        ▼
   RunManager (src/runtime/runManager.ts)
   ├── RunStateMachine (src/runtime/runStateMachine.ts)
   ├── CancellationTree (src/runtime/cancellationTree.ts)
   ├── ResourceLeaseManager (src/runtime/resourceLeaseManager.ts)
   ├── RunBudgetManager (src/runtime/runBudget.ts)
   └── RunEventLogger (src/observability/runEventLogger.ts)
        │
        ▼
   Context & Rules Gate
   ├── RulesEngine (src/rules/rulesEngine.ts)
   ├── HookEngine (src/hooks/hookEngine.ts)
   ├── ContextSanitizer (src/context/contextSanitizer.ts)
   └── MemoryManagerV2 (src/context/memoryV2.ts)
        │
        ▼
   Dynamic Multi-Agent Planner
   ├── DynamicPlanner (src/agent/orchestration/dynamicPlanner.ts)
   └── CheckpointManager (src/agent/orchestration/checkpointManager.ts)
        │
        ▼
   Scheduler & Isolation Fabric
   ├── AgentPool (src/agent/orchestration/agentPool.ts)
   └── WorktreeManager (src/worktree/worktreeManager.ts)
        │
        ▼
   Capability & Security Control Plane (MANDATORY)
   └── PolicyBroker (src/policy/policyBroker.ts)
         ├── FilesystemDefense (src/policy/filesystemDefense.ts)
         ├── ShellParser (src/policy/shellParser.ts)
         ├── NetworkPolicy (src/policy/networkPolicy.ts)
         ├── SecretClassifier (src/policy/secretClassifier.ts)
         └── EnvironmentFilter (src/terminal/environmentFilter.ts)
              │
              ▼
   Execution Subsystems
   ├── TerminalManager (with EnvironmentFilter & RingBuffer)
   ├── TransactionalEditEngine (with PatchValidator & LineEndingPreserver)
   ├── McpToolAdapter (with McpClient & McpHealth)
   ├── BrowserTool (with BrowserEvidence)
   └── ComputerUseManager (src/computerUse/computerUseManager.ts)
        │
        ▼
   Verification & Review Quality Gate
   ├── EvidencePlanner (src/verification/evidencePlanner.ts)
   ├── TestImpactAnalyzer (src/verification/testImpactAnalyzer.ts)
   ├── CodeReviewEngine (src/review/codeReviewEngine.ts)
   └── SecurityReviewEngine (src/review/securityReviewEngine.ts)
        │
        ▼
   MergeCoordinator & Persistent Run Record
```
