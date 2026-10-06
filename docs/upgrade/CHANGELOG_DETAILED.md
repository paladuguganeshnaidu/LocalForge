# TuxNest / LocalForge: Detailed Modernization Changelog

## Version: 2.0.0-PROD-UPGRADE
**Date:** October 2026  
**Type:** Major Architectural & Security Overhaul  

This document chronicles the deep engineering changes implemented across all 20 programs of the Master Upgrade Plan.

---

### 1. Runtime Kernel & Storage Migrations
- **Deterministic Run Lifecycle (`src/runtime/runStateMachine.ts`):**
  - Implemented `RunStateMachine` managing transitions: `idle` -> `initializing` -> `planning` -> `executing` -> `paused` / `recovering` -> `completed` / `failed` / `cancelled`.
  - Added illegal transition guards and terminal state invariants.
- **Hierarchical Cancellation Context (`src/runtime/cancellationTree.ts`):**
  - Created `CancellationTree` and `CancellationNode` supporting tree-based cascading abort signals.
  - Linked subprocesses, model streaming, subagents, and approvals into deterministic abort contexts.
- **Resource Lease Management (`src/runtime/resourceLeaseManager.ts`):**
  - Implemented `ResourceLeaseManager` for mutually exclusive file, terminal, and port locks.
  - Guaranteed automatic LIFO resource release upon task completion, failure, or cancellation.
- **Multi-Dimensional Budget Governance (`src/runtime/runBudget.ts`):**
  - Implemented `RunBudgetManager` tracking token usage, tool call counts, execution duration, and mutated files with automatic threshold enforcement.
- **Persistence Schema Migration (`src/migrations/storageMigration.ts`):**
  - Created `StorageMigrationManager` supporting automatic migration from legacy `v1` (`localforge.*`) keys to modern `v2` (`tuxnest.*`) namespaces.
  - Added schema version headers, corruption detection, and safe fallback.

---

### 2. Multi-Agent Orchestration & Git Worktrees
- **Schema-Constrained Dynamic Planning (`src/agent/orchestration/planSchema.ts`, `src/agent/orchestration/dynamicPlanner.ts`):**
  - Defined JSON schemas for model-generated `TaskGraphPlan` (`nodes`, `dependencies`, `targetFiles`, `acceptanceCriteria`, `verificationPlan`, `riskLevel`).
  - Added topological wave resolution and cycle detection.
- **Dynamic Wave Scheduler & Concurrency Scaling (`src/agent/orchestration/orchestrator.ts`):**
  - Upgraded orchestrator to schedule independent DAG tasks into parallel execution waves according to agent pool capacity.
  - Connected step checkpoint saves to `CheckpointManager` on every task step.
- **Structured Agent Handoff Contracts (`src/agent/orchestration/handoffSchema.ts`):**
  - Implemented `AgentHandoffV2` contract with required fields: `filesModified`, `testsExecuted`, `unresolvedRisks`, `structuredArtifacts`, and `confidenceScore`.
- **Dynamic Failure Replanning (`src/agent/orchestration/dynamicPlanner.ts`):**
  - Implemented graph replanning capable of injecting remediation nodes and rewiring dependencies on task failure.
- **Ephemeral Git Worktree Isolation (`src/worktree/worktreeManager.ts`):**
  - Implemented `WorktreeManager` creating and tracking isolated git worktrees per agent task to avoid dirty working trees during concurrent edits.
  - Created `MergeCoordinator` ensuring pre-merge conflict checks and mandatory test qualification before branch integration.
- **Dynamic Agent Roles (`src/agent/orchestration/agentProfileLoader.ts`, `src/agent/orchestration/agentRegistry.ts`):**
  - Created markdown profile loader reading `.tuxnest/agents/*.md` with YAML frontmatter to register specialized dynamic roles.

---

### 3. Security Policy & Capability Broker
- **Authoritative Security Broker (`src/policy/policyBroker.ts`, `src/policy/types.ts`):**
  - Centralized security decision making across permission modes (`allow_safe_auto`, `always_proceed`, `always_ask`, `request_review`), roles, and risk classes.
- **Shell AST Lexer & Command Classifier (`src/policy/shellParser.ts`):**
  - Replaced regex matching with shell AST parser handling compound operators (`&&`, `||`, `;`, `|`, `&`), argument quoting, and dangerous binary classifications.
- **Filesystem Traversal & Reparse Defense (`src/policy/filesystemDefense.ts`):**
  - Added Windows UNC path neutralization (`\\?\`, `\\.\`), symlink realpath verification, and junction escape blocking.
- **Network Policy & SSRF Guard (`src/policy/networkPolicy.ts`):**
  - Implemented strict filtering against loopback (`127.0.0.0/8`), cloud metadata endpoints (`169.254.169.254`), and private RFC 1918 subnets.
- **Secret Classification & Redaction (`src/policy/secretClassifier.ts`):**
  - Implemented Shannon entropy calculation and pattern scanning for AWS keys, GitHub tokens, private keys, and API tokens, redacting them before prompt injection or logging.

---

### 4. Model Context Protocol (MCP) & Extensibility
- **MCP Client Implementation (`src/mcp/mcpClient.ts`, `src/mcp/mcpTransport.ts`, `src/mcp/types.ts`):**
  - Implemented stdio JSON-RPC 2.0 client supporting initialize handshake, tool discovery, and tool dispatch.
- **MCP Tool Sandbox Adapter (`src/mcp/mcpToolAdapter.ts`):**
  - Adapted MCP tools into the native tool registry, enforcing capability brokerage, parameter validation, and provenance tags.
- **MCP Health Monitor & Circuit Breaker (`src/mcp/mcpHealth.ts`):**
  - Added failure threshold tracking, automatic circuit tripping, and recovery timeouts for external MCP servers.
- **Lifecycle Hook Interceptors (`src/hooks/hookEngine.ts`, `src/hooks/types.ts`):**
  - Created `HookEngine` supporting `pre_tool_use`, `post_tool_use`, `pre_command`, `post_command`, `pre_file_write`, and `on_run_complete`.
- **Hierarchical Governance Rules (`src/rules/rulesEngine.ts`):**
  - Implemented rules engine loading workspace `AGENTS.md` and path-scoped rules with provenance attribution.

---

### 5. Context Intelligence / RAG 2.0 & Memory 2.0
- **AST Symbol Indexer (`src/context/symbolIndexer.ts`):**
  - Extracted structured symbols (functions, classes, interfaces, methods) with line ranges and signatures.
- **Bidirectional Dependency Graph (`src/context/dependencyGraph.ts`):**
  - Built source import/export dependency graph tracking forward references and reverse dependents for impact analysis.
- **Adversarial Prompt Injection Defense (`src/context/contextSanitizer.ts`):**
  - Sanitized retrieved context chunks, neutralized system prompt override attacks, and wrapped snippets in boundary tags.
- **Tiered Memory with TTL (`src/context/memoryV2.ts`):**
  - Divided memory into `task_working`, `project_decisions`, `user_preferences`, and `verified_facts` with confidence ratings, contradiction checks, and TTL pruning.

---

### 6. Provider Gateway & Adaptive Routing
- **Provider Gateway Normalization (`src/providers/providerGateway.ts`):**
  - Normalized responses and error classification across Ollama and OpenAI-compatible providers.
- **Adaptive Model Router (`src/providers/adaptiveRouter.ts`):**
  - Routed tasks to models based on task profile, capability tags, context window bounds, and local-only constraints.

---

### 7. Editing Engine 2.0 & Verification
- **Transactional Multi-File Edit Engine (`src/editing/transactionalEditEngine.ts`):**
  - Implemented two-phase staged edit plans with pre-validation and atomic rollback across multiple files.
- **Precondition SHA-256 Validation (`src/editing/patchValidator.ts`):**
  - Enforced pre-image content hashing to reject patches against modified/stale files.
- **Line Ending Preservation (`src/editing/lineEndingPreserver.ts`):**
  - Detected and preserved CRLF vs LF line endings across all edits.
- **Structured Evidence Planner (`src/verification/evidencePlanner.ts`):**
  - Generated mandatory verification plans (`build`, `test`, `diagnostic`, `browser`, `diff`) with cryptographic content hashes.
- **Test Impact Analyzer (`src/verification/testImpactAnalyzer.ts`):**
  - Mapped changed source files to candidate test files for fast regression checks.
- **Debug Controller & Failure Loop Suppression (`src/verification/debugController.ts`):**
  - Hashed failure signatures and hypothesis logs to prevent infinite retry loops.

---

### 8. Code Review, Security Review & UI
- **Diff Code Review Engine (`src/review/codeReviewEngine.ts`):**
  - Analyzed git diffs for empty catch blocks, leftover debugger statements, and large change warnings.
- **Automated Security Review Engine (`src/review/securityReviewEngine.ts`):**
  - Scanned diffs for CWE-78 (command injection), CWE-22 (path traversal), and CWE-798 (hardcoded secrets).
- **Decoupled Webview Protocol (`src/ui/chatProtocol.ts`):**
  - Formalized typed message schemas for chat, agent state, DAG visualization, and approval requests.
- **Structured Browser Evidence (`src/browser/browserEvidence.ts`):**
  - Captured accessibility tree snapshots, console logs, and network failure records.

---

### 9. Terminal, Sandbox & Observability
- **Tiered Execution Sandboxes (`src/sandbox/executionTiers.ts`):**
  - Defined execution tiers (`read_only`, `workspace_host`, `isolated_worktree`, `container_sandbox`, `remote_runner`).
- **Subprocess Environment Sanitization (`src/terminal/environmentFilter.ts`):**
  - Stripped ambient environment secrets before spawning child processes.
- **Multi-Shell Resolution & Autonomous Bash Execution (`src/terminal/shellResolver.ts`):**
  - Discovers host Git Bash (`C:\Program Files\Git\bin\bash.exe`), WSL (`wsl.exe`), PowerShell (`pwsh.exe`/`powershell.exe`), and CMD.
  - Automatically identifies POSIX syntax (shebangs, `export`, `source`, `chmod`, `$(...)`, `${...}`) and routes commands to real Bash on Windows and native platforms.
  - Upgraded `run_command` in `coreTools.ts` and `workspaceTools.ts` to accept `shell: 'auto' | 'bash' | 'powershell' | 'cmd'`.
- **Adaptive Command Timeout & Streaming Inactivity Watchdog (`src/terminal/commandTimeoutClassifier.ts`):**
  - Eliminated premature `cmd timeout` during package installations (`npm install`, `pip install`, `cargo build`, etc.) through intelligent categorization.
  - Multi-tier duration ceilings: 10 minutes for package installations, 5 minutes for compilation/tests, 2 minutes for general commands.
  - Integrated streaming inactivity watchdog: resets on `stdout`/`stderr` chunks, guaranteeing active downloads/builds are never killed while producing output.
  - Extended tool-level timeout ceiling in `coreTools.ts` to 15 minutes (900,000ms).
- **Terminal Output Ring Buffer (`src/terminal/ringBuffer.ts`):**
  - Capped process output to configured byte limits with FIFO eviction to prevent memory exhaustion.
- **Structured Run Event Logging (`src/observability/runEventLogger.ts`):**
  - Recorded correlation-traced JSON events (`runId`, `agentId`, `tool`, `duration`, `result`, `error`).
- **Remote Runner Protocol & Scoped Vault (`src/runner/runnerProtocol.ts`, `src/runner/scopedVault.ts`):**
  - Defined headless runner protocol and ephemeral least-privilege credential vault.

---

### 10. Packaging, CI & Release Qualification
- **Identity Drift Scanner (`scripts/scan-identity-drift.cjs`):**
  - Verified package and command naming compliance.
- **Release Verification & SBOM Generator (`scripts/verify-release-pipeline.cjs`):**
  - Automated SPDX Software Bill of Materials (SBOM) generation and bundle SHA256 integrity check.
- **Scale Combinatorial Matrix Test (`tests/combinatorialMatrix.test.js`):**
  - Validated security invariants across 18,144 multi-dimensional tuples.
- **Property & Generative Fuzzing Harnesses (`tests/propertyFuzz.test.js`, `tests/concurrencyAndSchedulerFuzz.test.js`):**
  - Executed 70,888 seeded fuzz iterations across DAGs, state machines, shell parsers, cancellation trees, lease managers, and run budgets.
- **Adversarial Security Suite (`tests/adversarialSecurity.test.js`):**
  - Validated 15,000 adversarial attack vectors across prompt injections, SSRF, UNC traversals, and command injections.
