# TuxNest World-Class Super Upgrade Master Plan

**Target product:** TuxNest VS Code autonomous engineering extension  
**Current package reviewed:** `tuxnest-vscode` v1.0.1  
**Input artifacts:** `LocalForge-main(1).zip`, `tuxnest-vscode-1.0.1.vsix`, and the production-readiness audit generated from them  
**Plan date:** 2026-10-06  
**Planning standard:** production-grade, security-first, evidence-driven, local-first, multi-agent engineering platform  

> This is an engineering blueprint, not a claim that the current product is bug-free or “100% secure.” The goal is to define the changes and acceptance gates required before TuxNest can defensibly compete with leading coding-agent products.

---

## 1. Executive goal

TuxNest should evolve from a strong local-first VS Code agent into a **full autonomous software-engineering platform** with five differentiators:

1. **Local-first/private by default** — powerful local Ollama/OpenAI-compatible execution, remote GPU support, and no forced cloud dependency.
2. **Real multi-agent engineering** — dynamic planning, isolated parallel workers, typed handoffs, worktrees, retries, reviewer/tester/security gates, and resumable long-running jobs.
3. **Evidence before completion** — no “done” state without build/test/runtime/security evidence appropriate to the task.
4. **Safe execution** — capability-based permissions, isolated execution backends, strong secret handling, prompt-injection defenses, MCP/plugin policy, and auditable approvals.
5. **Open extensibility** — MCP, hooks, custom agents, rules, workflows, provider adapters, self-hosted runners, and a stable automation/SDK surface.

The target is not to copy Cursor, Copilot, Claude Code, Codex, Windsurf, or Cline. TuxNest should reach parity on the capabilities users now expect, while differentiating on **privacy, local models, self-hosted compute, transparent verification, and inspectable agent orchestration**.

---

## 2. Current verified baseline

The supplied project is already materially beyond a normal extension.

### 2.1 Existing strengths to preserve

- Strict TypeScript configuration.
- 22 contributed VS Code commands.
- 23 product configuration keys.
- Approximately 42 distinct built-in/registered tool names found in source.
- Local Ollama support.
- OpenAI-compatible endpoints.
- SSH/remote Ollama tunneling and remote GPU telemetry concepts.
- Workspace indexing and retrieval.
- Local lexical chat memory.
- Inline completion.
- Workspace trust checks.
- Explicit access scopes: file/workspace/machine.
- Permission manager and tool-risk separation.
- Atomic/diff-reviewed editing and recovery journal.
- Terminal/process manager with cancellation and process-tree handling.
- Localhost rendered browser automation.
- Multi-agent classes: `TaskGraph`, `AgentPool`, `AgentManager`, `MultiAgentOrchestrator`.
- 12 registered specialist agent roles.
- Self-test/doctor/diagnostic concepts.
- VSIX payload verification script.
- 81 automated test files.
- 335 named tests discovered during the previous audit; 316 passed in that environment and 19 were blocked/failed, mostly because dependencies were incomplete after a failed clean install.
- Thousands of stress-loop executions already exist.

### 2.2 Important current architectural limitations confirmed from source

These are not theoretical gaps; they are visible in the supplied v1.0.1 code.

1. **Multi-agent planning is mostly static.**  
   `src/agent/orchestration/orchestrator.ts::decomposeGoal()` constructs fixed graphs based on mode and rough goal length. It does not yet produce a model-generated, repository-informed dynamic DAG.

2. **Default orchestrator concurrency is effectively serial.**  
   `executeGoal()` computes concurrency from `options.maxConcurrency ?? 1`, so callers that do not explicitly raise it run one subagent at a time even though the pool itself can support more.

3. **File-conflict detection is not yet useful in the default graph.**  
   `TaskGraph` can detect overlap in `targetFiles`, but the default decomposition populates `targetFiles: []` for tasks. Dynamic ownership/lock planning is required.

4. **Typed handoffs are structurally shallow.**  
   `AgentManager.extractHandoff()` often fills fields with empty arrays/defaults and truncates free-form output. Handoffs need schema-constrained model output plus runtime evidence.

5. **Checkpoint manager is not integrated into the normal multi-agent execution path.**  
   `CheckpointManager` exists and is instantiated, but `TuxNestEngine.executeMultiAgentTask()` currently calls `orchestrator.executeGoal()` without persist/resume checkpoints.

6. **The public `delegate_task` tool is intentionally limited.**  
   It supports only `planner`, `repository_analyst`, `reviewer`, and `researcher`, read-only, using an `AgentPool(1)`. This is safe, but not yet a general multi-agent execution interface.

7. **MCP is planned in docs but absent from implementation.**  
   Source search found no MCP implementation in `src/`.

8. **Git worktree isolation is described in role/docs but absent from implementation.**  
   Source search found no worktree execution implementation.

9. **Git automation is narrow.**  
   Built-in Git tools include status/diff/log/commit, but not a complete safe branch/worktree/rebase/merge/PR lifecycle.

10. **No OS sandbox is active for shell commands.**  
    The product correctly documents that commands execute as the existing OS account. This must remain explicit until an isolation backend exists.

11. **The UI is monolithic.**  
    `src/ui/chatView.ts` is ~2,089 lines and mixes HTML/CSS/state/message protocol/rendering/action logic. It should be split before the feature surface grows significantly.

12. **The core engine and agent loop are also large.**  
    `LocalForgeEngine.ts` is ~1,023 lines and `agentLoop.ts` ~888 lines. Their responsibilities should be separated into durable runtime services.

13. **CI is far too small for a world-class agent.**  
    Current CI is essentially Ubuntu + Node 22 + `npm ci` + `npm test` + package. It does not provide the cross-platform, security, supply-chain, Extension Host, provider, package-install, fuzz, or endurance gates needed here.

14. **Current docs contain historical identity drift.**  
    LocalForge/LOMVREN/v0.2.x naming and commands remain in many shipped/reference documents. Current docs and historical docs need clean separation.

---

## 3. 2026 competitive benchmark: what “world class” now means

The product target must be measured against current agent platforms, not 2024-style chat extensions.

| Capability | Current market expectation | TuxNest v1.0.1 | Upgrade target |
|---|---|---:|---|
| Autonomous local agent | Standard | Strong | Harden + speed + evidence |
| Plan/Ask/Agent/Review modes | Standard | Present in runtime concepts | Productize fully |
| Long-running background tasks | Increasingly standard | Limited to active extension runtime | Local/self-hosted background runner |
| Cloud/remote isolated execution | Leaders support it | SSH remote model only | Self-hosted runner + optional isolated remote execution |
| Parallel agents | Leaders support coordinator/subagents | Infrastructure exists, defaults limited | Dynamic parallel DAG + worktrees |
| Worktree/task isolation | Common in parallel-agent tools | Not implemented | Mandatory parallel-write isolation |
| Custom agents | Common | Fixed 12 roles | User/team agent profiles |
| MCP | Common | Not implemented | First-class MCP client/policy layer |
| Hooks | Common | No general lifecycle hook framework | Pre/post policy + automation hooks |
| Project/team rules | Common | Prompt/system conventions only | Scoped rules + provenance |
| Task checkpoints | Common | Partial manager only | Durable resumable event-sourced jobs |
| Browser/computer interaction | Common for UI verification | Localhost Playwright path | Structured browser evidence + screenshots + accessibility |
| PR/code-review agent | Major differentiator | Review role only | Diff review, PR integration, security review, incremental review |
| Scheduled/event automation | Emerging standard | Not productized | Local runner + Git provider automation |
| Cross-device task supervision | Leaders support cloud | No | Optional web/mobile control via self-hosted runner later |
| Repository deep research | Standard | Retrieval + analyst role | Symbol graph + hybrid retrieval + citations |
| Model routing | Standard | Present | Cost/quality/latency/capability adaptive router |
| Local models | Some support, but often secondary | Major strength | Make this a flagship advantage |
| Remote GPU/self-hosted model | Differentiator | Present foundation | Harden into runner fabric |
| Enterprise policy/audit | Expected for teams | Partial safety policies | Central policy, signed config, audit export |
| Reproducible evals | Rarely visible but essential | Some stress tests | First-class evaluation platform |

### Competitive references consulted

- Cursor Cloud Agents: https://prod.cursor.com/help/ai-features/background-agents
- Cursor Agent/Projects: https://prod.cursor.com/docs/agent/overview
- Cursor Bugbot: https://prod.cursor.com/docs/bugbot
- GitHub Copilot cloud agent: https://docs.github.com/en/copilot/concepts/agents/cloud-agent/about-cloud-agent
- GitHub custom agents/subagents: https://docs.github.com/en/copilot/concepts/agents/copilot-cli/about-custom-agents
- GitHub agent mode + MCP: https://docs.github.com/en/copilot/how-tos/copilot-in-your-ide/use-copilot-agents/use-agent-mode
- Claude Code autonomous patterns: https://www.anthropic.com/news/enabling-claude-code-to-work-more-autonomously
- Claude Code subagents/hooks/MCP: https://www.anthropic.com/webinars/claude-code-advanced-patterns
- OpenAI Codex cloud environments: https://help.openai.com/en/articles/20001545-using-codex-cloud
- OpenAI Codex multi-agent app: https://openai.com/index/introducing-the-codex-app/
- Windsurf hooks: https://docs.windsurf.com/windsurf/cascade/hooks
- Windsurf Arena/worktrees: https://docs.windsurf.com/windsurf/cascade/arena
- Cline tasks/checkpoints: https://docs.cline.bot/core-workflows/task-management
- ClineCore sessions/remote/automation: https://docs.cline.bot/cline-sdk/sessions

---

# 4. Product North Star: TuxNest 2.x

## 4.1 Product definition

**TuxNest = a local-first autonomous engineering control plane inside VS Code, able to plan, delegate, execute, verify, review, recover, and document engineering work across local or self-hosted compute.**

It should support these primary operating modes:

1. **Ask** — read-only repository research with evidence.
2. **Plan** — repository-aware implementation plans and risk analysis.
3. **Agent** — controlled local edits and commands.
4. **Team** — multi-agent DAG execution with isolated worktrees.
5. **Review** — diff/branch/PR quality and security review.
6. **Debug** — runtime evidence collection and hypothesis-testing loop.
7. **Automate** — event/scheduled jobs via TuxNest Runner.
8. **Offline** — fully local models/tools, no network.
9. **Remote** — execute against a user-owned remote runner/GPU.

## 4.2 Product principles

- Local-first, cloud-optional.
- Least privilege by default.
- No silent permission escalation.
- Separate instructions from untrusted data.
- Every destructive action is traceable.
- Every autonomous task has a budget.
- Every “done” claim has evidence.
- Every long-running task is resumable.
- Every parallel writer is isolated.
- Every external tool has provenance and policy.
- Every persistent schema is versioned.
- Every release is reproducibly built and install-tested.

---

# 5. Target architecture

```text
┌────────────────────────────────────────────────────────────────────┐
│                         VS CODE PRODUCT SHELL                      │
│ Chat | Plan | Team | Review | Models | Runs | Artifacts | Policy   │
└──────────────────────────────┬─────────────────────────────────────┘
                               │ typed UI protocol
┌──────────────────────────────▼─────────────────────────────────────┐
│                         TUXNEST RUNTIME KERNEL                     │
│ Run Manager | Event Log | Cancellation | Budgets | State Machine  │
└───────┬──────────────────────┬─────────────────────┬───────────────┘
        │                      │                     │
        ▼                      ▼                     ▼
┌──────────────┐      ┌──────────────────┐   ┌──────────────────────┐
│ ORCHESTRATOR │      │  POLICY BROKER   │   │  CONTEXT INTELLIGENCE│
│ Planner/DAG  │      │ permissions      │   │ symbol graph          │
│ Scheduler    │      │ capabilities     │   │ hybrid retrieval      │
│ Agent teams  │      │ hooks/MCP policy │   │ memory/provenance     │
└──────┬───────┘      └────────┬─────────┘   └──────────┬───────────┘
       │                       │                        │
       └───────────────────────┼────────────────────────┘
                               ▼
┌────────────────────────────────────────────────────────────────────┐
│                         TOOL / ACTION BUS                          │
│ Files | Git | Terminal | Tests | Diagnostics | Browser | MCP      │
└───────────────┬──────────────────────────────────────┬─────────────┘
                │                                      │
                ▼                                      ▼
┌──────────────────────────────┐       ┌─────────────────────────────┐
│ LOCAL EXECUTION BACKENDS     │       │ SELF-HOSTED RUNNER FABRIC   │
│ workspace/read-only          │       │ SSH / daemon / container    │
│ isolated git worktree        │       │ remote GPU / CI-like jobs   │
│ container sandbox (optional) │       │ encrypted channels/secrets  │
└──────────────────────────────┘       └─────────────────────────────┘
                │                                      │
                └──────────────────┬───────────────────┘
                                   ▼
┌────────────────────────────────────────────────────────────────────┐
│                       MODEL PROVIDER GATEWAY                       │
│ Ollama | OpenAI-compatible | first-class adapters | routing       │
│ capability negotiation | retries | budgets | observability        │
└────────────────────────────────────────────────────────────────────┘
```

---

# 6. The 20-program super-upgrade plan

The following workstreams are designed to be developed in parallel by specialist teams/agents, with explicit integration gates.

---

## Program 01 — Runtime Kernel Decomposition

### Current issue

Core lifecycle responsibilities are distributed across large classes (`LocalForgeEngine.ts`, `agentLoop.ts`, UI provider classes). This increases coupling and makes cancellation/recovery/testing harder.

### Build

Create dedicated runtime services:

- `RunManager`
- `RunStateMachine`
- `RunEventBus`
- `RunBudgetManager`
- `CancellationTree`
- `ResourceLeaseManager`
- `TaskExecutionCoordinator`
- `RuntimeHealthService`

### Required changes

- Replace implicit boolean/busy state with a strict run state machine.
- Introduce stable IDs: `runId`, `taskId`, `agentId`, `toolCallId`, `approvalId`, `artifactId`.
- Make every async operation accept a shared cancellation context.
- Track nested child operations as a tree.
- Add hard task deadlines and per-tool deadlines.
- Add CPU/memory/output/tool-call/token budgets.
- Separate product shell state from execution state.
- Eliminate legacy `LocalForge*` compatibility exports from current runtime after a migration window.

### Acceptance

- No task can remain permanently “running” after extension reload.
- Cancel propagates to model stream, tools, subprocesses, browser, subagents, SSH, and pending approvals.
- Runtime state transitions are exhaustively unit-tested.

---

## Program 02 — Dynamic Multi-Agent Planner & Scheduler

### Current issue

The DAG exists but decomposition is template-based and task ownership is weak.

### Build

A real **Planner → Validated DAG → Scheduler** pipeline.

### Required changes

- Planner returns schema-constrained `TaskGraphPlan` JSON.
- Validate graph before execution:
  - no cycles
  - bounded nodes
  - valid roles
  - defined dependencies
  - target files/areas
  - acceptance criteria
  - verification strategy
  - risk level
  - expected artifacts
- Repository analyst runs before planning for medium/large tasks.
- Dynamically choose agent count based on task graph, model capability, CPU/RAM, and user budget.
- Add critical-path scheduling.
- Add task priorities and cost estimates.
- Add speculative parallel analysis only for read-only tasks.
- Add fail-fast vs continue-independent policy.
- Add task-level retry policy based on error taxonomy, not generic retry.
- Add replanning when assumptions fail.
- Add “ask user” nodes for truly blocked external decisions.
- Add reviewer veto and security veto nodes.
- Add merge coordinator for parallel code branches.

### Agent role upgrade

Expand fixed roles into configurable profiles:

- orchestrator
- architect
- repository analyst
- researcher
- coder/frontend/backend/data/infra specializations
- test engineer
- debugger
- reviewer
- security reviewer
- performance engineer
- accessibility reviewer
- documentation agent
- git/merge agent
- dependency/supply-chain agent

### Acceptance

- Complex task can generate different DAGs based on repository shape.
- Parallelism occurs only when write sets are isolated.
- Planner output is validated before any side effect.
- Replanning handles failed assumptions without restarting the full run.

---

## Program 03 — Git Worktree Isolation & Merge Engine

### Current issue

Parallel writer isolation is not implemented. `targetFiles` conflict detection alone is insufficient.

### Build

Each mutating subagent works in an isolated Git worktree/branch.

### Required changes

- Add safe tools:
  - `git_branch_list`
  - `git_create_branch`
  - `git_worktree_create`
  - `git_worktree_remove`
  - `git_stage`
  - `git_restore`
  - `git_show`
  - `git_merge_base`
  - `git_merge`
  - `git_rebase_preview`
  - `git_conflict_status`
- Never overwrite the user’s dirty working tree.
- Detect untracked/ignored-file dependencies before isolation.
- Add setup hook for worktrees.
- Add deterministic merge ordering.
- Detect semantic conflicts even when Git merges cleanly by rerunning relevant tests.
- Provide a final unified diff before application to primary workspace.
- Preserve every agent branch until user accepts or cleanup policy expires.

### Acceptance

- Two coder agents can edit overlapping repository areas without touching the user’s active worktree.
- Failed worker branches are inspectable and removable.
- Merge conflict handling never silently chooses one side.

---

## Program 04 — Execution Isolation / Sandbox Tiers

### Current issue

Shell commands run with the user account and are not OS-sandboxed.

### Build

A tiered execution model:

1. `read_only`
2. `workspace_host`
3. `isolated_worktree`
4. `container_sandbox`
5. `full_machine`
6. `remote_runner`

### Required changes

- Default autonomous mutation to isolated worktree.
- Optional container sandbox for untrusted repositories.
- Deny network by default in sandbox; explicit domain allowlist.
- Mount repository read/write only as required.
- No home-directory mount by default.
- Filter environment variables.
- Inject only approved secrets.
- Linux backend: container or namespace/bubblewrap adapter.
- Windows backend: Docker/WSL/container adapter where available.
- macOS backend: container/VM adapter where available.
- Never claim OS isolation when falling back to host mode.
- Add preflight UI showing effective execution tier.

### Acceptance

- Agent can build/test a repository without inheriting unrelated user secrets.
- Attempts to access host `$HOME`, SSH keys, browser credentials, or arbitrary network are blocked in sandbox mode.

---

## Program 05 — Security Boundary & Capability Policy Engine

### Current issue

Strong safety concepts exist, but policy is distributed between access policy, tool policy, permission manager, path validation, and individual tools.

### Build

A single **Security Boundary Service** that authorizes every action.

### Required changes

Every tool request becomes an `ActionRequest` containing:

- principal/agent
- tool
- source (builtin/MCP/plugin/workflow)
- workspace
- paths
- command AST
- network destinations
- environment access
- secrets requested
- risk class
- user authorization state

Policy decision returns:

- allow
- deny
- prompt
- allow-once
- allow-session
- allow-workspace
- transformed request

### Add

- shell parser instead of regex-only command policy
- Windows command semantics (`cmd`, PowerShell)
- POSIX shell semantics
- symlink/reparse-point/UNC/device-path defenses
- TOCTOU-resistant file checks where possible
- SSRF protections
- IP-range policy
- DNS rebinding defenses for external fetch
- secret-path taxonomy
- secret-content classifiers
- policy provenance in activity details

### Acceptance

- No built-in, MCP, plugin, workflow, subagent, or remote runner can bypass the same policy engine.

---

## Program 06 — MCP Client, Plugins & Skills Platform

### Current issue

MCP is absent from runtime source.

### Build

First-class MCP with the same policy/security layer as built-ins.

### Required changes

- stdio MCP client.
- streamable HTTP/remote MCP client.
- server lifecycle manager.
- tool/resource/prompt discovery.
- JSON schema validation.
- capability negotiation.
- OAuth/token storage via VS Code SecretStorage.
- per-server enable/disable.
- per-tool permissions.
- server trust levels.
- timeout/retry/circuit breaker.
- server logs.
- provenance label on every MCP result.
- tool-name collision isolation.
- prompt-injection marking on MCP content.
- remote MCP domain policy.

### Plugin/skill layer

Add `.tuxnest/agents/*.md`, `.tuxnest/skills/*`, and signed extension manifests for reusable engineering workflows.

### Acceptance

- A malicious MCP server cannot silently gain terminal/file/network privileges beyond its declared grants.

---

## Program 07 — Hooks, Rules & Governance

### Build

Lifecycle hooks:

- `pre_user_prompt`
- `post_user_prompt`
- `pre_context_build`
- `post_context_build`
- `pre_tool_use`
- `post_tool_use`
- `pre_file_write`
- `post_file_write`
- `pre_command`
- `post_command`
- `pre_mcp_tool`
- `post_mcp_tool`
- `pre_commit`
- `post_test`
- `post_agent_response`
- `on_run_complete`

### Rules hierarchy

1. product security policy
2. organization policy
3. workspace policy
4. path-scoped rules
5. task instructions
6. untrusted repository content

Support:

- `AGENTS.md`
- `.tuxnest/rules/*.md`
- `.tuxnest/policy.json`
- path globs
- mandatory/optional rules
- rule provenance viewer
- size limits/truncation visibility

### Acceptance

- Hooks can block pre-actions with structured reasons.
- Repository text can never override higher-level policy.

---

## Program 08 — Context Intelligence / RAG 2.0

### Current issue

Workspace indexing is useful but capped and primarily text-oriented. Chat memory is lexical BM25-style retrieval.

### Build

A hybrid repository intelligence layer:

- lexical retrieval
- AST/symbol index
- reference/call graph
- import/dependency graph
- Git history context
- diagnostics
- test-to-source relationships
- optional local embeddings
- reranking
- context provenance

### Required changes

- Language adapters using VS Code language services first.
- Tree-sitter or parser adapters where language service data is insufficient.
- Incremental index persistence.
- content hashes and invalidation.
- chunk by symbol/function/class rather than arbitrary text only.
- query intent classifier.
- relevance scoring tuned by task type.
- duplicate suppression.
- recency weighting for modified files.
- “why included?” context inspector.
- strict secret exclusion.
- token-aware packing based on real tokenizer adapters when available.

### Large repository target

Design for:

- 100k files discovered
- 20k–50k indexed source files depending on user limit
- millions of symbols via incremental/on-disk storage
- monorepo workspace folders

### Acceptance

- Repository questions cite exact files/symbols.
- Incremental changes do not trigger full reindex.
- Context latency remains bounded on large repos.

---

## Program 09 — Memory 2.0

### Build

Separate memory classes:

- current conversation
- task memory
- workspace engineering memory
- user opt-in preferences
- learned project conventions
- verified facts

### Required changes

- provenance + timestamp + confidence.
- explicit source links.
- TTL for weak memories.
- deduplication and contradiction handling.
- no raw tool logs in long-term memory.
- user-visible memory inspector.
- delete/export controls.
- local encryption option.
- never store secrets by default.

### Acceptance

- Agent can explain exactly which stored fact influenced a decision.

---

## Program 10 — Model Gateway & Adaptive Routing

### Current issue

Ollama and generic OpenAI-compatible support are a good base, but world-class operation needs capability and protocol normalization.

### Build

A provider gateway with:

- normalized streaming
- tool-call normalization
- structured-output support
- reasoning/visible-output separation
- multimodal capability metadata
- context-window discovery
- cost/latency/quality signals
- retries/circuit breakers
- fallback policies

### First-class adapters

Keep OpenAI-compatible as the universal escape hatch, but add well-tested named profiles/adapters for major endpoints where protocol quirks matter.

### Smart router

Route by:

- task type
- model capabilities
- context size
- expected tool reliability
- local hardware
- user privacy mode
- latency preference
- cost budget
- past eval scores

### Arena mode

Run 2–3 models/agents against the same read-only task or isolated worktree, then let a judge/reviewer compare verified outputs.

### Acceptance

- Provider quirks do not leak into agent logic.
- Fallback never silently sends private code to a cloud endpoint when the user selected local-only.

---

## Program 11 — Remote Runner & Background Agent Fabric

### Current issue

Remote GPU SSH tunneling exists, but model hosting is different from remote autonomous execution.

### Build

**TuxNest Runner** — optional user-owned daemon for long-running tasks.

### Capabilities

- clone/sync repository
- create isolated workspace/worktree
- install dependencies under policy
- run tools/tests/browser
- use local or remote model endpoints
- checkpoint state
- stream logs/artifacts back to VS Code
- continue when VS Code closes

### Security

- mutual TLS or SSH-authenticated control channel
- device pairing
- encrypted secret vault
- domain allowlists
- runner capabilities declared at registration
- no ambient secrets
- immutable task audit log

### Later integrations

- GitHub issue/PR tasks
- scheduled maintenance
- CI failure repair
- dependency update jobs
- nightly test generation

### Acceptance

- Laptop can disconnect and reconnect to a self-hosted long-running task without losing state.

---

## Program 12 — Editing Engine 2.0

### Preserve

Existing diff/recovery/journal architecture is a strength.

### Upgrade

- syntax-aware edits.
- multi-file transaction plans.
- precondition hashes.
- semantic conflict checks.
- formatter integration.
- import organization.
- rename-symbol via language service.
- code action integration.
- automatic smallest-diff strategy.
- generated-file detection.
- protected-file policy.
- binary-file policy.
- line-ending/encoding preservation.
- undo across agent/worktree merge.

### Acceptance

- No stale edit is silently applied.
- A partial multi-file apply can always be reconciled or rolled back.

---

## Program 13 — Browser, UI Testing & Computer Evidence

### Current strength

Rendered browser is intentionally constrained to localhost.

### Upgrade

- browser session lifecycle service.
- structured DOM snapshot.
- accessibility tree.
- console/network error capture.
- screenshot artifacts.
- visual diff baseline support.
- viewport matrix.
- keyboard-only interaction checks.
- responsive checks.
- performance timing collection.
- deterministic selectors.

### Optional external browser tier

If external sites are supported later, separate it from localhost app verification and apply strict domain/network policy.

### Acceptance

A frontend task cannot claim success merely because `npm test` passes; when appropriate it must render the app and provide browser evidence.

---

## Program 14 — Verification, Debug & Repair Engine

### Build

A task-specific evidence planner.

For each change determine required evidence:

- compile/typecheck
- lint
- unit tests
- integration tests
- E2E
- browser checks
- security checks
- performance benchmark
- package build

### Repair loop

1. run verification
2. classify failure
3. collect relevant evidence
4. form hypothesis
5. apply minimal fix
6. rerun smallest affected test
7. rerun broader regression gate
8. stop on repeated/non-progress behavior

### Add

- flake detection
- failure signature hashing
- repeated-action suppression
- test-impact analysis
- root-cause artifact
- “verified / not verified / blocked” final status

### Acceptance

- Final response distinguishes code written from behavior actually executed and verified.

---

## Program 15 — Code Review & Security Review Product

### Build

A dedicated review engine separate from general coding.

### Review capabilities

- diff-first analysis
- only-new-changes mode
- repository rules
- historical finding deduplication
- severity/confidence
- suggested fix
- “fix all safe findings” flow
- incremental rerun after fixes

### Security reviewer

- CWE mapping
- taint-style source/sink reasoning where possible
- dependency vulnerabilities
- secret scan
- dangerous permission changes
- command injection
- path traversal
- SSRF
- XSS/webview issues
- unsafe deserialization
- auth/access-control changes

### GitHub integration target

- optional GitHub Action/App or runner integration
- PR comments/checks
- review status
- user-controlled autofix branch

### Acceptance

- Review findings are tied to lines/diffs and can be reproduced from evidence.

---

## Program 16 — UI/UX Rebuild

### Current issue

`chatView.ts` is a large mixed-responsibility webview.

### Rebuild into modules

- webview shell
- typed protocol
- conversation timeline
- activity timeline
- agent-team panel
- plan graph/DAG viewer
- approvals panel
- diff/review panel
- artifacts panel
- run history
- models/hardware panel
- settings/policy panel
- diagnostics panel

### UX capabilities

- queued follow-up messages
- reorder queued prompts
- interrupt/steer a subagent
- pause/resume task
- expand/collapse reasoning summaries
- per-agent status and files
- live cost/token/time budgets
- exact permission reason
- one-click open diff/test/browser artifact
- search conversation/run history
- keyboard accessibility
- screen-reader labels
- DOM virtualization for long sessions

### Acceptance

- 1,000-message/run timeline remains responsive.
- All webview messages have typed validation.

---

## Program 17 — Observability, Diagnostics & Local Analytics

### Build

A structured local event schema for:

- model requests
- tool requests
- approvals
- retries
- failures
- subagent lifecycle
- resource usage
- indexing
- edits
- test evidence

### Requirements

- correlation IDs everywhere.
- local rotating logs.
- secret redaction before persistence.
- exportable support bundle.
- privacy-safe optional telemetry only if ever added; off by default unless product strategy explicitly chooses otherwise.
- performance traces.
- health dashboard.
- doctor output with actionable fixes.

### Acceptance

A user can export a diagnostic bundle without exposing code/secrets unless explicitly opted in.

---

## Program 18 — Performance, Scale & Resource Governance

### Major refactors

- lazy-load heavy features.
- split UI/runtime bundles.
- virtualize chat/activity DOM.
- incremental index persistence.
- bounded caches.
- streaming backpressure.
- process output ring buffers.
- model response limits.
- browser resource cleanup.

### Suggested SLOs (excluding model inference itself)

- extension activation p95: <300 ms on normal workspace.
- UI input/action acknowledgment: <50 ms.
- cancel signal propagation: <250 ms.
- incremental index update for one normal file: p95 <250 ms.
- checkpoint persistence: p95 <100 ms for normal state.
- no extension event-loop stalls >100 ms under normal operation.
- bounded terminal output memory.
- zero leaked child processes after clean shutdown gate.

### Acceptance

Performance regression budgets become CI gates.

---

## Program 19 — CI, Supply Chain & Release Engineering

### Replace current minimal CI with a release matrix

#### Required OS matrix

- Ubuntu
- Windows
- macOS

#### Required Node/build matrix

- supported build Node version(s)
- clean checkout
- delete `dist`
- `npm ci`
- compile
- bundle
- test
- package
- verify VSIX

#### Static gates

- TypeScript strict compile
- ESLint
- formatting check
- dead-code/unreferenced export scan
- CodeQL/Semgrep-style security scan
- secret scan
- dependency vulnerability scan
- license policy

#### Supply-chain gates

- lockfile integrity
- SBOM (CycloneDX/SPDX)
- provenance metadata
- release checksum
- artifact signing where supported
- dependency pin/review policy
- Dependabot/Renovate equivalent

#### VS Code gates

- real Extension Host tests
- Stable VS Code
- selected newer/Insiders compatibility lane
- clean profile install
- extension reload
- upgrade from previous release
- uninstall/reinstall

#### Packaging gates

- manifest/source identity match
- no secret/test fixture leakage
- no obsolete branding in current docs
- no stale version in release instructions
- exact bundle hash checks

### Acceptance

No marketplace release can be created locally outside the same verified release pipeline without a deliberate maintainer override recorded in release evidence.

---

## Program 20 — Evaluation Platform, 85,000-Execution Quality Gate & Documentation

### Why

A giant count by itself is meaningless. The test program must cover **states, risks, combinations, recovery, and real environments**.

### Target recurring release execution budget: 85,000+

| Test family | Target executions |
|---|---:|
| Unit/contract/schema tests | 10,000 |
| Property-based/fuzz tests | 30,000 |
| Security/adversarial tests | 10,000 |
| Pairwise/3-way feature combinations | 15,000 |
| Fault-injection/recovery tests | 5,000 |
| Real VS Code Extension Host/UI scenarios | 5,000 |
| Provider/protocol/model-routing scenarios | 4,000 |
| Browser/app-verification scenarios | 2,000 |
| Remote runner/SSH/GPU scenarios | 2,000 |
| Performance/soak/resource scenarios | 1,000 |
| Package/install/update/migration scenarios | 1,000 |
| **Total** | **85,000** |

### Critical state dimensions for combinatorial generation

- OS: Windows/Linux/macOS
- workspace trust: trusted/untrusted/changes-mid-run
- workspace shape: single/multi-root/monorepo/empty
- Git state: clean/dirty/untracked/conflict/detached
- access scope: file/workspace/machine/sandbox
- permission mode: ask/session/deny
- model provider: Ollama/OpenAI-compatible/remote/offline/failing
- stream behavior: normal/slow/partial/malformed/disconnected
- tool result: success/error/timeout/cancel/oversized
- edit state: clean/stale/read-only/failure/recovery
- index state: empty/building/ready/partial/stale
- memory state: disabled/current/all/corrupt/migrated
- agent count: 1/2/4/8/16
- DAG: linear/branch/join/independent/failure/replan
- process state: normal/hang/spawns child/ignores TERM/port listener
- browser: no server/startup/running/crash/navigation failure
- SSH: host key known/unknown/changed/auth fail/drop/reconnect
- MCP: trusted/untrusted/schema error/hang/oversized/permission denied
- hook: success/block/fail/timeout/malformed output
- release: fresh install/update/downgrade/reinstall

### Security adversarial corpus

At minimum test:

- prompt injection in README/source comments/tool output/test output/web content/MCP results
- shell metacharacters/quoting/encoding tricks
- PowerShell command variants
- path traversal and Unicode normalization
- symlink/junction/reparse attacks
- workspace-to-home secret reads
- `.env`, credentials, SSH keys, cloud tokens, npm/pip config
- URL credentials
- DNS rebinding/private-network SSRF
- malicious package lifecycle scripts
- malicious repository tasks
- gigantic tool outputs
- malformed tool-call JSON
- nested/recursive tool calls
- permission-race conditions
- stale approval reuse
- webview XSS/link payloads
- corrupted checkpoints and persisted state
- compromised/hostile MCP server
- remote runner impersonation

### Evaluation quality metrics

Track more than pass/fail:

- task success rate
- verified success rate
- false completion rate
- regression rate
- average tool calls
- average retries
- time to first useful action
- total task latency
- token use
- cost for cloud models
- diff size
- rollback rate
- permission prompt rate
- security-policy block rate
- hallucinated file/symbol rate
- test-fix resolution rate

---

# 7. Immediate P0 blockers before adding flashy features

These must happen first.

1. Make clean `npm ci -> compile -> test -> package` reproducible in CI.
2. Reproduce and resolve the process-tree/HTTP-listener lifecycle failure from the previous audit on all three desktop OSes.
3. Install and test the generated VSIX in a clean real VS Code profile.
4. Wire checkpoint persistence into multi-agent execution.
5. Add state-version migration for sessions/checkpoints/recovery records.
6. Remove current-document identity drift; keep old names only under historical release notes/migration docs.
7. Add dependency/security/SBOM release gates.
8. Add cross-platform Extension Host CI.
9. Split “host execution” from “isolated execution” clearly in UI and security docs.
10. Define the canonical product security threat model.

**Rule:** do not begin public “world-class autonomous” marketing until these gates are continuously green.

---

# 8. P1 product upgrades required for competitive parity

1. Dynamic model-generated DAG planning.
2. Worktree-isolated parallel agents.
3. Real checkpoint/resume.
4. MCP client and permissions.
5. Hook system.
6. Custom agent profiles.
7. Rules hierarchy and scoped instructions.
8. Hybrid context intelligence/symbol graph.
9. Provider gateway normalization.
10. Structured verification engine.
11. Dedicated debug mode.
12. Review/security-review product.
13. Browser screenshot/accessibility evidence.
14. UI modularization and agent-team visualization.
15. Strong local observability/support bundle.
16. 85k evaluation framework.
17. Self-hosted background runner.
18. Git branch/worktree/merge tools.
19. Enterprise policy export/import.
20. Performance budgets and soak testing.

---

# 9. P2 differentiation: features that can make TuxNest better, not merely equal

## 9.1 Privacy Modes

One-click modes:

- **Air-Gapped Local** — no outbound traffic at all.
- **Local Models + Docs Web** — model local, approved web docs only.
- **Hybrid** — local default, explicit cloud fallback.
- **Enterprise Locked** — admin policy decides endpoints/tools.

Display a permanent privacy badge showing where code can flow.

## 9.2 Self-Hosted Agent Cluster

Turn existing remote GPU work into a general user-owned compute fabric:

- desktop GPU box
- lab server
- home server
- enterprise runners
- queued jobs
- hardware-aware model placement

## 9.3 Verification Score

Every completed run receives an evidence score based on:

- build
- tests
- runtime/browser
- review
- security
- unresolved assumptions

Never show “100%” unless every required gate passed and the score definition is visible.

## 9.4 Agent Replay

Allow a run to be replayed from its event log using the same code snapshot, tool inputs, policies, and model identifiers where feasible.

## 9.5 Local Engineering Knowledge Graph

Build relationships between:

- symbols
- tests
- commits
- failures
- architecture docs
- agent decisions

Use this to answer “what will break if I change this?” locally.

## 9.6 Model Benchmark Lab

On a user repository, run safe standardized tasks against selected models and compare:

- correctness
- latency
- tool-call reliability
- token use
- local VRAM/RAM
- coding style

Use results to improve routing.

---

# 10. Persistent state redesign

All persistent state needs versioned schemas.

```text
.tuxnest/ (workspace-local, opt-in where appropriate)
  rules/
  agents/
  skills/
  workflows/
  evals/

VS Code storage
  sessions.vN
  runs.vN
  checkpoints.vN
  editRecovery.vN
  modelProfiles.vN
  policyGrants.vN
  runnerProfiles.vN
  indexMetadata.vN
```

### Migration requirements

- schema version on every record.
- forward migration.
- safe rejection of unsupported newer schemas.
- corruption handling.
- backup before destructive migration.
- migration tests from every supported previous release.
- eliminate legacy key names such as `localforge.agent.checkpoint` after controlled migration to `tuxnest.*`.

---

# 11. API/contracts to introduce

## 11.1 `RunManifest`

```ts
interface RunManifest {
  schemaVersion: number;
  runId: string;
  goal: string;
  mode: ProductMode;
  createdAt: number;
  workspaceFingerprint: string;
  baseGitCommit?: string;
  executionTier: ExecutionTier;
  modelPolicy: ModelRoutingPolicy;
  budget: RunBudget;
  graph: TaskGraphPlan;
  status: RunStatus;
  evidence: EvidenceSummary;
}
```

## 11.2 `TaskGraphPlan`

```ts
interface TaskGraphPlan {
  rationale: string;
  assumptions: string[];
  nodes: PlannedTask[];
  globalAcceptanceCriteria: AcceptanceCriterion[];
  verificationPlan: VerificationStep[];
}
```

## 11.3 `ActionRequest` / `PolicyDecision`

Every side effect flows through the same authorization contract.

## 11.4 `EvidenceArtifact`

```ts
interface EvidenceArtifact {
  id: string;
  type: 'build' | 'test' | 'diagnostic' | 'browser' | 'security' | 'performance' | 'diff';
  producer: string;
  timestamp: number;
  commandOrAction?: string;
  exitCode?: number;
  summary: string;
  immutableHash?: string;
}
```

## 11.5 `AgentHandoffV2`

Handoffs must be validated structured data, not primarily truncated prose.

---

# 12. File/module refactor plan

## Split `src/ui/chatView.ts`

Proposed:

```text
src/ui/chat/
  chatViewProvider.ts
  chatProtocol.ts
  chatState.ts
  conversationRenderer.ts
  activityRenderer.ts
  approvalRenderer.ts
  diffRenderer.ts
  agentTeamRenderer.ts
  runHistoryRenderer.ts
  settingsRenderer.ts
  markdownRenderer.ts
  webviewTemplate.ts
```

## Split `src/core/LocalForgeEngine.ts`

```text
src/runtime/
  runManager.ts
  runStateMachine.ts
  runEventBus.ts
  runBudget.ts
  cancellationTree.ts

src/services/
  conversationService.ts
  taskService.ts
  artifactService.ts
  diagnosticsService.ts
  providerService.ts
```

## Split `src/agent/agentLoop.ts`

```text
src/agent/runtime/
  reasoningLoop.ts
  toolDispatch.ts
  toolResultNormalizer.ts
  verificationPlanner.ts
  retryController.ts
  completionController.ts
  promptAssembler.ts
```

## New major packages

```text
src/policy/
src/mcp/
src/hooks/
src/rules/
src/runner/
src/worktree/
src/evals/
src/review/
src/observability/
src/migrations/
src/sandbox/
```

---

# 13. Security threat model

Treat these as primary adversaries:

1. Malicious repository content.
2. Prompt injection embedded in code/docs/test output.
3. Malicious dependency/package lifecycle scripts.
4. Compromised external webpage.
5. Compromised MCP server.
6. Hostile model endpoint.
7. Malicious/compromised remote runner.
8. Secret leakage through logs/context/memory.
9. Shell command injection.
10. Path traversal/symlink/reparse attacks.
11. SSRF and private network access.
12. Webview injection.
13. Permission-grant replay/race.
14. Checkpoint/state tampering.
15. Supply-chain compromise of extension build.

### Security architecture rules

- Untrusted content is always tagged with provenance.
- Model output is never authority.
- The model never grants its own permissions.
- Tool schemas are validated before dispatch.
- Arguments are revalidated at execution time.
- Approval binds to exact normalized action arguments/hash.
- Changed arguments invalidate approval.
- Secrets are not placed in prompts unless explicitly required and approved.
- Remote runners receive scoped task secrets, not the whole environment.
- External content cannot instruct the security layer.

---

# 14. Enterprise-readiness plan

Add only after core runtime is stable:

- organization policy file.
- locked model/provider allowlist.
- MCP allowlist.
- network domain allowlist.
- required sandbox tier.
- forbidden command classes.
- secret provider integration.
- audit-log export.
- managed settings.
- signed policy bundles.
- per-repository trust settings.
- retention controls.
- team rules/custom agents.
- admin diagnostics.
- no hidden telemetry.

---

# 15. Product UX roadmap

## Stage A — trustworthy local agent

- clearer mode selector
- privacy/execution-tier badge
- approval explanations
- improved diff/recovery
- run evidence card

## Stage B — agent team

- visual DAG
- parallel agent cards
- worktree branches
- handoffs
- task steering
- merge review

## Stage C — automation

- runner dashboard
- queued/background tasks
- schedules/events
- PR/issue integration

---

# 16. Release strategy

Do **not** attempt all changes in one giant rewrite.

## Release 1 — `1.1 Hardening`

- clean CI
- process lifecycle fixes
- cross-platform host tests
- docs identity cleanup
- schema migration framework
- checkpoint integration
- security scans/SBOM
- modularize highest-risk core pieces

## Release 2 — `1.2 Isolation`

- worktree manager
- safer Git tools
- execution tiers
- environment filtering
- sandbox beta
- dynamic target-file ownership

## Release 3 — `1.3 Agent Teams`

- dynamic DAG planner
- structured handoffs
- true parallel isolated workers
- replanning
- visual DAG/team UI

## Release 4 — `1.4 Extensibility`

- MCP
- hooks
- rules
- custom agents
- skill/workflow manifests

## Release 5 — `1.5 Intelligence`

- hybrid context index
- symbol/call graph
- memory 2.0
- adaptive router
- model Arena

## Release 6 — `1.6 Verification`

- evidence engine
- debug mode
- browser artifacts
- review/security product
- performance regression gates

## Release 7 — `2.0 Runner`

- self-hosted background runner
- long-running jobs
- remote isolated execution
- automation API
- optional Git provider integration

**Important:** version numbers are suggested milestones, not a promise. Each release ships only when its acceptance gates pass.

---

# 17. Engineering dependency order

```text
P0 build/release/security foundation
        ↓
Runtime Kernel + schema migrations
        ↓
Policy Boundary + observability
        ↓
Worktree/execution isolation
        ↓
Dynamic DAG + structured handoffs
        ↓
MCP/hooks/rules/custom agents
        ↓
Context/Memory/Model routing upgrades
        ↓
Verification/Review/Browser evidence
        ↓
Self-hosted background runner
        ↓
Enterprise + external automation surface
```

Do not build background automation before the run state machine, policy boundary, and checkpoint system are trustworthy.

---

# 18. “Definition of Done” for every feature

A feature is not complete unless it has:

- documented threat model impact
- typed interface/schema
- unit tests
- failure-path tests
- cancellation tests where async
- permission tests where side-effecting
- persistence migration tests where stateful
- Extension Host test when VS Code APIs are involved
- cross-platform test where OS behavior is involved
- performance impact measurement
- documentation
- diagnostic visibility
- rollback/recovery behavior
- release-note entry

---

# 19. Production certification gate for TuxNest 2.x

Do not label the product “production certified” until all of the following are true:

### Build and release

- clean builds reproducibly on supported OSes.
- no dependency-install ambiguity.
- package verifier passes.
- VSIX clean-profile installation passes.
- update/migration tests pass.
- SBOM and checksums produced.

### Runtime

- zero known task-state deadlocks.
- cancellation propagates through every backend.
- process cleanup tests pass.
- crash/reload recovery passes.

### Security

- no unaccepted Critical/High scanner findings.
- hostile-repository suite passes.
- MCP/plugin security suite passes.
- secret-leak suite passes.
- command/path/network policy suite passes.
- sandbox claims match real platform behavior.

### Multi-agent

- isolated parallel writes.
- deterministic conflict handling.
- dynamic DAG validation.
- typed handoff validation.
- replanning tests.
- reviewer/security gates.

### Quality

- 85k recurring execution suite meets required pass rates.
- flaky-test budget below threshold.
- performance budgets pass.
- soak test passes.
- no unacceptable memory/process leaks.

### Product

- accessibility review passes.
- docs match the current manifest and UI.
- all claims in Marketplace description are backed by current release evidence.

---

# 20. Detailed first 30 implementation tickets

These are the first concrete tickets I would create, in order.

1. **CI-001:** Expand CI to Windows/macOS/Linux and clean-build from zero.
2. **REL-001:** Add current-version/identity scanner for TuxNest docs and manifest.
3. **SEC-001:** Introduce central `ActionRequest` policy contract.
4. **RUN-001:** Introduce `RunStateMachine` and migrate busy/task states.
5. **RUN-002:** Introduce cancellation tree and resource leases.
6. **RUN-003:** Wire persistent checkpointing into `executeMultiAgentTask()`.
7. **MIG-001:** Version and migrate `localforge.*` persistent storage keys to `tuxnest.*`.
8. **TERM-001:** Reproduce/fix child-process listener cleanup on all OSes.
9. **TERM-002:** Implement structured shell parser/classifier per shell family.
10. **ENV-001:** Default-filter subprocess environment and add explicit pass-through policy.
11. **GIT-001:** Implement worktree manager with dirty-tree safety.
12. **GIT-002:** Implement branch/stage/restore/merge-base/conflict tools.
13. **ORCH-001:** Define JSON schema for model-generated `TaskGraphPlan`.
14. **ORCH-002:** Add planner validation and graph budget limits.
15. **ORCH-003:** Populate target write sets and resource locks.
16. **ORCH-004:** Introduce structured `AgentHandoffV2` schemas.
17. **ORCH-005:** Add replanning on failed assumptions.
18. **UI-001:** Split typed webview protocol from `chatView.ts`.
19. **UI-002:** Add timeline virtualization.
20. **UI-003:** Build agent-team/DAG panel.
21. **OBS-001:** Add structured run event log and support-bundle export.
22. **SEC-002:** Add adversarial prompt-injection corpus.
23. **SEC-003:** Add secret classifier and redaction test corpus.
24. **SUP-001:** Add dependency audit, SBOM, secret scan, static security scan.
25. **MCP-001:** Implement local stdio MCP client behind policy engine.
26. **HOOK-001:** Implement pre/post tool and command hooks.
27. **RULE-001:** Implement scoped `.tuxnest/rules` and `AGENTS.md` loader with provenance.
28. **CTX-001:** Add symbol index and incremental persistence.
29. **EVAL-001:** Create deterministic seeded fuzz/property harness.
30. **EVAL-002:** Create generated pairwise/3-way feature interaction matrix.

---

# 21. Next 50 implementation tickets

31. `TEST-001` real VS Code Stable Extension Host matrix.  
32. `TEST-002` VS Code Insiders compatibility lane.  
33. `TEST-003` clean install/update/uninstall suite.  
34. `PROC-001` hard/soft shutdown escalation and port reuse tests.  
35. `FS-001` Windows UNC/device/reparse hardening.  
36. `FS-002` TOCTOU/symlink race suite.  
37. `NET-001` endpoint SSRF/DNS rebinding policy.  
38. `NET-002` sandbox domain allowlist.  
39. `WEB-001` browser screenshot and accessibility artifacts.  
40. `WEB-002` viewport/responsive test matrix.  
41. `PROV-001` normalized provider error taxonomy.  
42. `PROV-002` streaming parser conformance suite.  
43. `ROUT-001` capability-aware routing policy.  
44. `ROUT-002` local-only hard constraint.  
45. `MODEL-001` hardware benchmark/profile cache.  
46. `MODEL-002` Arena execution mode.  
47. `MEM-001` memory schema/provenance.  
48. `MEM-002` contradiction/TTL system.  
49. `CTX-002` import/reference/call graph.  
50. `CTX-003` optional local embedding index.  
51. `CTX-004` context provenance inspector.  
52. `EDIT-001` syntax-aware edit provider.  
53. `EDIT-002` formatting/import normalization.  
54. `EDIT-003` semantic conflict validation after merge.  
55. `VERIFY-001` evidence planner.  
56. `VERIFY-002` test impact selection.  
57. `VERIFY-003` repeated-failure signature handling.  
58. `DEBUG-001` dedicated debug mode and hypothesis log.  
59. `REVIEW-001` incremental diff review engine.  
60. `REVIEW-002` repository review rules.  
61. `REVIEW-003` safe autofix batch.  
62. `SEC-004` CWE-tagged security review findings.  
63. `SEC-005` dependency-change risk reviewer.  
64. `MCP-002` remote MCP + OAuth.  
65. `MCP-003` MCP server health/circuit breaker.  
66. `HOOK-002` hook timeout/block semantics.  
67. `AGENT-001` custom agent profiles.  
68. `AGENT-002` path-scoped tool grants per agent.  
69. `AGENT-003` agent profile provenance viewer.  
70. `WORKFLOW-001` durable workflow manifests.  
71. `RUNNER-001` runner protocol specification.  
72. `RUNNER-002` device pairing/mTLS or SSH transport.  
73. `RUNNER-003` remote job checkpoint/artifact stream.  
74. `RUNNER-004` scoped secret injection.  
75. `RUNNER-005` queued/background task UI.  
76. `PERF-001` activation profiling gate.  
77. `PERF-002` event-loop stall monitor.  
78. `PERF-003` memory/resource soak harness.  
79. `PERF-004` large-repository benchmark corpus.  
80. `DOC-001` generate command/settings reference from manifest.  

---

# 22. What should NOT be done

1. Do not add dozens of flashy tools before fixing the runtime/release foundation.
2. Do not market “sandboxed” host shell execution unless actual OS/container isolation is active.
3. Do not equate stress-loop iterations with independent E2E tests.
4. Do not make 20 agents write directly into one working tree.
5. Do not expose unrestricted MCP tools by default.
6. Do not allow model text to create persistent permissions.
7. Do not send local code to fallback cloud models silently.
8. Do not store tool outputs/secrets indefinitely as memory.
9. Do not keep expanding `chatView.ts` or `LocalForgeEngine.ts` monolithically.
10. Do not rely on old internal audit docs as release evidence; regenerate evidence from current CI.
11. Do not declare “100% secure,” “unrejectable,” or “bug free.” Use measurable gates.
12. Do not implement background agents before durable checkpoints and isolation.

---

# 23. Success metrics after the super upgrade

TuxNest should be able to demonstrate, with current-release evidence:

- A large feature can be decomposed into a repository-informed DAG.
- Multiple coders operate in isolated worktrees concurrently.
- A failed machine/VS Code restart can resume safely.
- Local-only mode provably makes no external model calls.
- A hostile README cannot trick the agent into bypassing security policy.
- MCP tools obey exactly the same policy as built-ins.
- Every code change can show build/test/review/browser evidence.
- A user can run long tasks on their own GPU server and reconnect later.
- The extension installs/upgrades cleanly across supported desktop OSes.
- Release artifacts are reproducible, scanned, checksummed, and accompanied by an SBOM.
- 85,000+ seeded release-validation executions run with categorized evidence rather than a vanity count.
- TuxNest can explain **why** it chose a model, context, tool, permission, and verification step.

---

# 24. Final strategic direction

The strongest path is **not** to become another generic cloud coding assistant. TuxNest already has the foundation for a more differentiated position:

> **“The private, inspectable, self-hostable engineering agent team that runs where your code and GPUs already live.”**

To earn that position, prioritize in this order:

1. **Reliability and release proof.**
2. **Security boundary and isolation.**
3. **True dynamic multi-agent execution with worktrees.**
4. **MCP/hooks/rules/custom agents.**
5. **Repository intelligence and adaptive routing.**
6. **Evidence-driven verification/review.**
7. **Self-hosted background runner and automation.**
8. **Enterprise governance and ecosystem.**

That sequence turns the existing v1.0.1 codebase into a defensible high-end engineering platform rather than a feature-heavy extension with fragile foundations.

---

## Appendix A — Current source evidence referenced by this plan

- `src/agent/orchestration/orchestrator.ts` — fixed mode-based graph decomposition and concurrency handling.
- `src/agent/orchestration/taskGraph.ts` — DAG, cycle detection, retry/failure propagation, target-file conflict concept.
- `src/agent/orchestration/agentManager.ts` — scoped subagent execution and current handoff extraction.
- `src/agent/subagentTools.ts` — current read-only public delegation roles and pool size.
- `src/agent/orchestration/checkpointManager.ts` — checkpoint storage implementation.
- `src/core/LocalForgeEngine.ts` — checkpoint manager instantiation and current multi-agent execution path.
- `src/agent/coreTools.ts` / `projectTools.ts` / `externalTools.ts` — core tool surface.
- `src/agent/permissionManager.ts` / `toolPolicy.ts` / `accessPolicy.ts` — current safety controls.
- `src/editing/editEngine.ts` / `editJournal.ts` — editing/recovery foundation.
- `src/context/*` — index, retrieval, memory, budget, boundaries.
- `src/providers/*` — Ollama/OpenAI-compatible provider system and routing.
- `src/remote/*` — remote GPU/SSH foundation.
- `src/browser/*` — local rendered browser.
- `src/terminal/*` — command/process lifecycle.
- `src/ui/chatView.ts` — current large webview implementation.
- `.github/workflows/ci.yml` — current minimal CI pipeline.
- `scripts/verify-marketplace-package.cjs` — existing strong package verification foundation.

## Appendix B — Previous audit evidence to carry forward

- Current package identity: TuxNest 1.0.1.
- 81 automated test files.
- 335 named tests discovered in the audit run.
- 316 passed / 19 failed in that environment; most failures were dependency-environment related after clean install failure.
- Investigate the terminal descendant/listener cleanup case as a cross-platform release blocker if reproducible.
- Current source/package should not be called fully production-certified until clean reproducible CI, real Extension Host acceptance, live provider acceptance, release-document cleanup, and systematic combinatorial/fuzz/security testing are green.

