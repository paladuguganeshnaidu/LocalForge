# Forensic Audit — LOMVREN / LocalForge

## Audit baseline

Audited branch: hardening/forensic-implementation-2026-09-30
Baseline main commit: aa031b126d6470388a7f696ae309c29f680e9e22

### Verified findings

| File | Symbol | Current behavior | Expected behavior | Impact | Root cause | Fix |
|---|---|---|---|---|---|---|
| src/ui/chatView.ts | handleChatMessage | Normal chat called LocalForgeEngine.executeTask, which used AgentEngine directly | One authoritative execution entry that routes into orchestration | Multi-agent runtime was not on the primary Agent path | Parallel runtime entry points | Added ExecutionCoordinator and made executeTask delegate to it for normal prompts |
| src/agent/orchestration/orchestrator.ts | executeGoal/decomposeGoal | DAG topology was largely hard-coded and targets were often empty | Runtime should discover relevant files and avoid real conflicts | Parallel execution could be unsafe or ineffective | Static graph + empty targetFiles | Added workspace target discovery and conflict-safe task batching |
| src/agent/orchestration/checkpointManager.ts | CheckpointManager | Storage API existed but orchestration did not persist node/run boundaries | Runtime checkpoints at meaningful boundaries | Restart recovery state could be stale | Checkpoint manager was not wired into orchestration | Wired run/graph/node/final checkpoints |
| src/agent/orchestration/agentManager.ts | extractHandoff | Tester/reviewer state could be inferred from LLM prose | Runtime state must come from runtime observations | False pass/review state risk | Heuristic text inspection | Typed validators + non-fabricating runtime handoffs |
| src/agent/coreTools.ts | create_file/delete_file/move_file/run_command | Some mutation/execution paths could bypass canonical gateways | All autonomous writes and commands must pass canonical gateways | Security and audit bypass | Direct VS Code FS / child_process fallback | Routed mutations to EditEngine and commands to TerminalManager/CommandPolicy |
| src/editing/editEngine.ts | applyProposal | Headless fallback could write directly with workspace.fs.writeFile | Atomic mutation must remain within EditEngine | Canonical editing boundary could be bypassed | Direct-write fallback | Removed fallback; VS Code applyEdit failure now fails closed |
| src/terminal/terminalManager.ts | runCommand | shell execution was not centrally classified | Commands require canonical policy | Injection/security exposure | Duplicated command checks | Added CommandPolicy, cancellation state, detached process groups, redaction |
| src/agent/toolRegistry.ts | executeTool | Validation/permission existed but redaction/audit were decentralized | One authoritative pipeline | Weak observability | Partial registry enforcement | Added policy gate, secret redaction, bounded audit trail |
| src/core/coreTools / workspace path helpers | path validation | Validation logic existed locally in tools | One canonical path policy | Cross-platform edge cases and symlink escapes | Duplicated path handling | Added security/pathPolicy.ts and routed core tools through it |

## Reachability

The normal prompt flow is now:

ChatView -> LocalForgeEngine.executeTask -> ExecutionCoordinator -> MultiAgentOrchestrator -> TaskGraph -> AgentManager -> AgentLoop -> ToolRegistry.

Slash/maintenance commands retain their specialized legacy handler by design; this is a deliberate boundary rather than a second autonomous task engine.

## Remaining verification boundaries

Automated CI can verify compile, unit/integration tests, package creation, and Extension Host execution. Live local-model inference, remote SSH GPU inference, and manual GUI acceptance require the corresponding provider/hardware/UI environment and are not asserted unless a real run is recorded.
