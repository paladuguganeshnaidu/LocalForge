# TuxNest — World-Class Hostile Post-Upgrade Audit & Super-Upgrade Blueprint

**Audit date:** 2026-10-07  
**Audited input:** `tuxnest-main.zip`  
**ZIP SHA-256:** `6046c6498eccca9e59194cdd5c91b1b46122b494afd3c0d9671d8e1b4f8283fc`  
**Repository package:** `tuxnest-vscode` / TuxNest `1.0.0`  
**Audit posture:** hostile verification; no upgrade claim is accepted merely because a module, tracker entry, or test exists.

---

## 1. Executive verdict

The uploaded repository contains a meaningful amount of serious engineering and a large set of newly added production-oriented components. However, the claim that the entire modernization is **fully executed and verified across all programs** is **not supported by the runtime wiring and test evidence in this repository**.

The most important finding is architectural:

> **Many of the flagship upgrade modules exist in source and have isolated tests, but are not reachable from the VS Code extension's production import graph and therefore do not currently govern real user execution.**

A static import reachability analysis starting at `src/extension.ts` found:

| Metric | Result |
|---|---:|
| TypeScript source files | 147 |
| Approx. source LOC | 22,950 |
| Runtime-reachable TS files | 99 |
| Runtime-unreachable TS files | **48** |
| Tracker tickets discovered | **60** |
| Tracker tickets whose listed source files are all runtime-unreachable | **43** |
| Tracker tickets with mixed live/dead source | 5 |
| Tracker tickets whose listed source is fully runtime-reachable | 6 |
| Tracker tickets listing no source files | 6 |

This does **not** mean all 48 files are useless. It means they do not participate in the active extension graph unless loaded dynamically by some mechanism not found during the audit. For a claimed production feature, that is a critical distinction.

### Release decision

**DO NOT certify this repository as “world-class production-ready” yet.**

A more accurate description is:

> TuxNest has a solid existing extension/agent foundation and a promising second-generation architecture partially implemented beside it, but the modernization layer is incompletely integrated, the high-scale qualification numbers overstate behavioral coverage, the claimed 100% pass result is not reproducible in this audit environment, and native whole-desktop computer-use does not yet exist.

### Approximate readiness view

These are engineering judgment scores, not formal certifications:

| Area | Current audited state |
|---|---:|
| Existing workspace/terminal/browser agent foundation | 7.0 / 10 |
| Runtime integration of the new architecture | **2.5 / 10** |
| Multi-agent autonomy | 4.0 / 10 |
| Security enforcement architecture | 6.0 / 10 existing controls, but new broker mostly disconnected |
| Recovery/checkpoint architecture | 4.0 / 10 |
| Test quantity | 7.5 / 10 |
| Test semantic quality / claim strength | **4.5 / 10** |
| Release qualification / supply chain | 4.5 / 10 |
| Cross-platform confidence | 4.0 / 10 |
| Native desktop/computer-use capability | **1.0 / 10** |
| Overall world-class readiness | **~5.2 / 10** |

The fastest route forward is **not more isolated modules**. It is runtime integration, hostile integration testing, real cross-platform execution, and a secure computer-use kernel.

---

# 2. What was actually scanned

The audit covered the extracted repository broadly rather than only the upgrade documents.

### Source and configuration areas inspected

- `package.json`
- `package-lock.json`
- TypeScript compiler configuration
- extension activation and command registration
- core engine
- chat/webview implementation
- model providers
- model routing
- agent loop
- tool registry
- tool policy
- access policy
- workspace and machine file tools
- terminal process management
- shell resolution and timeout classification
- editing/recovery
- context/RAG/indexing
- memory systems
- remote SSH/GPU path
- browser automation
- multi-agent orchestration
- dynamic planner
- task graph / worker pool
- checkpoint implementation
- new runtime kernel
- policy/security modules
- MCP modules
- hooks/rules/custom agent profiles
- worktree manager
- review/verification modules
- runner protocol / scoped vault
- observability
- UI protocol modules
- CI workflow
- release verification scripts
- identity scan
- high-scale qualification tests
- normal Node test suite

### Artifact identity

`package.json` reports:

- `name`: `tuxnest-vscode`
- `displayName`: `TuxNest`
- `version`: `1.0.0`
- `publisher`: `tuxnest`

But repository/homepage/bugs still point to the old LocalForge GitHub location.

A broad text scan excluding `node_modules` and `dist` still finds **hundreds of legacy LocalForge/LOMVREN/localforge references**. A narrower command executed during the audit returned 598 matches. Earlier broader scanning found still more depending on included generated/doc paths.

That means the identity verification script's “0 drift” result is too narrow to support a full branding/release claim.

---

# 3. Reproducibility and test evidence

## 3.1 Normal test run

The checked-in JavaScript output under `dist` was used where possible because a clean dependency installation could not be completed in this audit environment.

Command:

```bash
node --test tests/*.test.js
```

Observed result:

```text
tests:      392
passed:     370
failed:      22
duration:   ~9.3s
```

Several failures are environment/dependency-load failures caused by missing packages such as `undici`, `ssh2`, `playwright-core`, and `ignore`. Those should **not** automatically be treated as product defects.

However, not all failures are dependency noise. Important nontrivial failures include:

- adversarial filesystem-defense expectation failure
- terminal process-tree lifecycle failure
- cross-platform shell expectation mismatch
- worktree test running against a ZIP rather than a Git checkout

The terminal lifecycle failure is especially important because it tests whether a spawned descendant process and its HTTP listener really disappear after shutdown.

## 3.2 Claimed high-scale qualification suite

The four headline suites were rerun directly:

```bash
node --test \
  tests/combinatorialMatrix.test.js \
  tests/propertyFuzz.test.js \
  tests/concurrencyAndSchedulerFuzz.test.js \
  tests/adversarialSecurity.test.js
```

Observed result:

```text
suites/tests: 4
passed:       3
failed:       1
```

The failure was:

```text
FilesystemDefense failed to block dangerous path: ..\..\..\..\Windows\System32
expected false, actual true
```

Therefore the repository's reported **104,527 executions / 100% pass rate is not reproducible here**.

This failure may partly expose a portability mismatch in the test itself: on Linux, backslash is normally a valid filename character rather than a path separator. But that still means the suite is not cross-platform-correct as written and the 100% claim cannot be repeated unchanged.

---

# 4. The 104,527 number is arithmetically valid but semantically inflated

The report total is arithmetically consistent if the claimed 495 native tests are included:

```text
18,144 combinatorial
30,888 property/fuzz
40,000 concurrency/scheduler
15,000 adversarial
   495 native tests
--------------------------------
104,527 total
```

The problem is what those numbers actually represent.

## 4.1 “18,144 combinatorial tuples”

The test loops over:

- OS
- workspace trust
- scope
- permission mode
- agent role
- category
- risk
- shell family

But several of those loop variables are **not passed into the `PolicyBroker` decision request**. In particular, OS, workspace trust, scope, and shell family are used mainly to increase iteration count and assertion messages.

Therefore many of the 18,144 executions are behaviorally identical duplicate evaluations.

This is **not** an 18,144-case behavioral feature-interaction matrix.

## 4.2 “40,000 concurrency and scheduler fuzz”

The test imports `DynamicPlanner` and `TaskGraph` but does not use them.

The 40,000 count is:

- 10,000 cancellation-tree iterations
- 15,000 lease-manager iterations
- 15,000 budget-manager iterations

The lease test acquires and then immediately releases the lease in the same loop. That means meaningful simultaneous contention is effectively not exercised.

This is useful component stress, but it is **not scheduler concurrency fuzzing** and does not validate real parallel agent execution.

## 4.3 “15,000 adversarial vectors”

The 15,000 loop count is generated from small repeated base corpora:

- prompt injection: 6 base strings × 6 noise styles, then iteration suffixes
- SSRF: 8 base URLs repeated
- filesystem: 9 base paths repeated

This can still detect regressions, but “15,000 attack vectors” implies much more semantic diversity than exists.

A world-class adversarial corpus needs transformations and protocol variants such as:

- IPv4 integer/hex/octal encodings
- IPv4-mapped IPv6
- IPv6 compression variants
- DNS names resolving to private ranges
- DNS rebinding across connect phases
- redirect chains
- mixed encoding / percent encoding
- Unicode separator/path confusion
- symlink races
- junctions and reparse points
- Windows ADS/device namespace variants
- shell quoting/injection across PowerShell/cmd/bash/zsh/fish
- nested tool-output prompt injection
- malicious MCP schemas/results
- retrieval poisoning across multiple chunks
- desktop UI deception / stale screenshot attacks

---

# 5. Critical finding: upgrade architecture exists beside the live product

A source import graph was generated starting at `src/extension.ts`.

The following **48 source files were not reachable** from the active extension graph:

```text
agent/orchestration/agentProfileLoader.ts
agent/orchestration/handoffSchema.ts
browser/browserEvidence.ts
context/contextSanitizer.ts
context/dependencyGraph.ts
context/memoryV2.ts
context/symbolIndexer.ts
editing/lineEndingPreserver.ts
editing/patchValidator.ts
editing/transactionalEditEngine.ts
hooks/hookEngine.ts
hooks/types.ts
mcp/mcpClient.ts
mcp/mcpHealth.ts
mcp/mcpToolAdapter.ts
mcp/mcpTransport.ts
mcp/types.ts
observability/runEventLogger.ts
policy/filesystemDefense.ts
policy/networkPolicy.ts
policy/policyBroker.ts
policy/secretClassifier.ts
policy/shellParser.ts
policy/types.ts
providers/adaptiveRouter.ts
providers/providerGateway.ts
review/codeReviewEngine.ts
review/securityReviewEngine.ts
review/types.ts
rules/rulesEngine.ts
runner/runnerProtocol.ts
runner/scopedVault.ts
runtime/cancellationTree.ts
runtime/resourceLeaseManager.ts
runtime/runBudget.ts
runtime/runManager.ts
runtime/runStateMachine.ts
runtime/types.ts
sandbox/executionTiers.ts
terminal/environmentFilter.ts
terminal/ringBuffer.ts
ui/chatProtocol.ts
ui/webviewState.ts
verification/debugController.ts
verification/evidencePlanner.ts
verification/testImpactAnalyzer.ts
verification/types.ts
worktree/worktreeManager.ts
```

This list contains most of the features used to justify the “complete modernization” claim.

## Production rule going forward

A feature must not be marked VERIFIED merely because:

1. a class exists,
2. a unit test constructs it,
3. a loop executes it thousands of times.

A production feature should be considered VERIFIED only when there is evidence for:

```text
extension/UI entry point
      ↓
runtime orchestration path
      ↓
policy/capability gate
      ↓
feature implementation
      ↓
observable effect
      ↓
cleanup/recovery
      ↓
integration/E2E assertion
      ↓
packaged VSIX assertion
```

---

# 6. Tracker integrity problem

The tracker summary says all **56** tickets are complete/verified.

The detailed document actually contains **60** ticket headings.

Classification of those 60 based on the tracker-listed source files and extension import reachability:

| Classification | Tickets |
|---|---:|
| All listed source runtime-unreachable | **43** |
| Mixed live + unreachable | 5 |
| Fully runtime-reachable | 6 |
| No parsed source file listed | 6 |
| **Total** | **60** |

This is a process failure, not only a code issue. A release tracker must be mechanically reconciled with implementation and runtime evidence.

---

# 7. Runtime kernel audit

The new runtime kernel includes good concepts:

- `RunStateMachine`
- `CancellationTree`
- `ResourceLeaseManager`
- `RunBudgetManager`
- `RunManager`

However, these are not the active lifecycle backbone of the extension.

The live engine still has its own direct `AbortController` state (`currentAbortController`) and the new `RunManager` is not constructed from the production entry graph.

### Required upgrade

Make one authoritative lifecycle kernel own:

- run ID
- state transition
- cancellation tree
- time/token/tool/file budgets
- resource leases
- checkpoint ID
- telemetry correlation
- tool execution context
- recovery metadata

Every agent, tool, terminal, browser session, worktree and remote action must inherit that context.

No second shadow lifecycle system should remain.

---

# 8. Multi-agent behavior audit

## Current positive foundation

The repository has:

- an orchestrator
- a task graph
- agent roles
- a worker pool
- retries
- status tracking
- checkpoint classes
- a dynamic-planner module

## Critical problems

### 8.1 Live decomposition is still mostly static

`MultiAgentOrchestrator.executeGoal()` calls `decomposeGoal()`.

`decomposeGoal()` still builds fixed shapes such as:

```text
small task:
Code → Verify

normal agent task:
Plan → Code → Test → Review
```

The imported `DynamicPlanner` is not used by this path.

### 8.2 `targetFiles` are empty

The live task nodes repeatedly use:

```text
targetFiles: []
```

Therefore file-level conflict prediction and true write isolation cannot work as claimed.

### 8.3 Dynamic planner is heuristic rather than semantic/model-planned

The separate planner largely classifies strings and filenames. That is a valid fallback, but it is not equivalent to a repository-aware model-generated task graph with schema validation and repair.

### 8.4 Checkpoint manager is not passed to the orchestrator

The engine constructs the orchestrator with four arguments, then constructs `CheckpointManager` separately.

The orchestrator's checkpoint dependency is optional and therefore remains `undefined` in the main engine path.

The checkpoint save code exists, but the live orchestrator does not receive the manager.

### 8.5 Agent handoff V2 is disconnected

The typed `handoffSchema.ts` implementation is not runtime-reachable.

The live manager still produces simpler handoff records, with important structured fields often empty.

### World-class target

A serious multi-agent runtime should support:

- goal → dynamic typed DAG
- repository-aware affected-file estimation
- capability-aware agent selection
- dependency waves
- work-stealing worker pool
- bounded parallelism
- file/resource lease acquisition
- worktree isolation for writers
- checkpoint after each state-changing node
- typed artifact handoffs
- failed-node replanning
- verifier-selected completion gates
- deterministic cancellation cascade
- replayable run trace

---

# 9. Git worktree isolation audit

`WorktreeManager` exists but is not connected to agent execution.

Additional implementation problems:

### 9.1 Conflict preview is not a real conflict preview

The implementation uses `git merge-base HEAD branch` exit status as `hasConflict`.

A merge base existing says the histories have a common ancestor. It does **not** prove the merge is conflict-free.

Correct conflict preview options include:

- `git merge-tree` where supported
- temporary index / no-commit merge simulation
- ephemeral integration worktree

### 9.2 Only committed branch changes are diffed

The code uses `HEAD..branch`. Uncommitted edits in the worktree do not automatically become branch history.

There is no complete agent workflow in this manager that:

```text
create worktree
→ run agent there
→ stage
→ validate
→ commit
→ preview integration
→ merge
→ post-merge verification
→ cleanup
```

### Required remediation

Worktree isolation should become mandatory for parallel write-capable agents unless the task explicitly uses serialized file leases.

---

# 10. Security broker audit

TuxNest already has useful existing live security concepts:

- trusted-workspace checks
- access scopes
- explicit approval for machine reads
- tool policy classification
- workspace path validation
- symlink-aware workspace containment in live file handling
- localhost-constrained browser behavior
- SSH host fingerprint handling
- VS Code SecretStorage for remote secrets

Those are strengths.

The problem is that the newly advertised central security architecture is mostly disconnected.

## 10.1 PolicyBroker is not authoritative

`PolicyBroker` is not in the active extension graph.

Therefore it cannot be described as the authoritative control plane for all dangerous actions.

## 10.2 MCP prompt decision bug

`McpToolAdapter` blocks only:

```ts
if (decision.decision === 'deny') ...
```

A `prompt` outcome proceeds to external MCP execution unless some outer layer happens to intervene.

A capability broker must represent at least:

- ALLOW
- DENY
- REQUIRE_USER_APPROVAL
- REQUIRE_ELEVATED_SCOPE
- REQUIRE_SANDBOX

and the execution layer must refuse to continue until the decision is fully resolved.

## 10.3 Network policy is not DNS-rebinding protection

The new `NetworkPolicy` validates literal URL hostnames/IPs but does not:

- resolve DNS before connection
- evaluate every A/AAAA result
- pin resolution to the connection
- revalidate redirects
- defend against hostname → private-IP rebinding

Therefore “DNS rebinding defense” is not yet justified.

## 10.4 Filesystem defense portability

The adversarial suite itself fails a path case on Linux.

A cross-platform filesystem-security layer must model:

- POSIX paths
- Windows separators
- drive roots
- UNC paths
- `\\?\` and `\\.\`
- NTFS ADS
- device names
- junctions/reparse points
- symlinks
- Unicode normalization
- case sensitivity/case folding
- TOCTOU path swaps between validation and open/write

---

# 11. Environment secret leakage

This is a high-priority integration defect.

The new `EnvironmentFilter` is not runtime-reachable.

The live terminal manager builds child environment as:

```ts
{
  ...process.env,
  CI: 'true',
  npm_config_yes: 'false',
  ...(options?.env || {})
}
```

Therefore shell commands inherit the VS Code extension host's ambient environment variables.

This directly contradicts a claim that ambient host credentials are stripped before subprocess execution.

### Required design

Default subprocess environment should be built from an allowlist, not from `...process.env`.

Suggested layers:

1. minimal platform essentials
2. safe build/runtime variables
3. workspace-declared variables
4. explicitly capability-granted secrets
5. one-run ephemeral injected values

Never pass arbitrary host secrets merely because the agent launched a process.

---

# 12. MCP audit

The repository contains:

- MCP client
- stdio transport
- tool adapter
- health monitor
- types

But these modules are not connected to extension activation, engine startup, settings, UI, or default tool registration.

Therefore MCP should currently be classified as **implemented library code, not a shipped user feature**.

Additional hardening needed before integration:

- server process-tree cleanup
- server-specific environment filtering
- trust configuration
- executable/path approval
- server identity/provenance
- per-server capability grants
- input schema limits
- output size/content limits
- timeout/cancellation
- prompt-result handling
- result provenance
- circuit breaker
- quarantine after repeated failures
- user-visible active-server list
- explicit disconnect
- persisted configuration migration

---

# 13. Hooks, rules and custom agents

The new hook engine, rules engine and custom profile loader are not active in the extension import graph.

Do not advertise these as complete until actual runs show:

```text
workspace loads AGENTS.md/rules
→ profile is parsed and validated
→ agent configuration changes
→ hook fires on real tool/edit/run lifecycle
→ permissions still apply
→ recursion and failure are bounded
→ trace contains hook evidence
```

Hooks must never become a bypass around the capability broker.

---

# 14. Context / RAG 2.0 audit

## SymbolIndexer

The claimed AST symbol indexer is currently based mainly on pattern matching over lines rather than a true language AST service.

That means it will be weak on:

- multiline declarations
- nested declarations
- overloads
- decorators
- arrow functions
- language variants
- re-exports
- aliases
- syntax errors

## DependencyGraph

The dependency graph is also regex-oriented and limited compared with a real parser/resolver.

## ContextSanitizer

Regex detection/wrapping of injection-like strings can be useful as a signal, but **untrusted retrieved content cannot be made trusted merely by sanitizing text**.

The robust model is:

```text
retrieved repository content = untrusted evidence
system/developer policy       = trusted instruction
model must never upgrade evidence into instruction authority
```

### World-class RAG target

- tree-sitter or compiler/LSP ASTs
- language-specific import resolution
- symbol graph
- call/reference graph where possible
- lexical + semantic hybrid retrieval
- incremental indexing
- git-diff-aware recency
- provenance on every chunk
- trust labels
- source boundaries
- token-budget optimizer
- reranking
- duplication suppression
- evaluation set of real repo questions
- poisoning/injection corpus

---

# 15. Memory 2.0 audit

`MemoryManagerV2` exists but is not wired into the live product and is largely in-memory.

A production memory system needs:

- durable schema
- migration
- provenance
- source/run ID
- confidence
- user-visible controls
- deletion
- TTL
- bounded size
- contradiction model
- retrieval quality evaluation
- privacy classification
- no-secret persistence policy
- crash-safe writes

The existing conversation/history systems may already provide some persistence; the new 4-tier architecture is not yet the authoritative memory subsystem.

---

# 16. Provider gateway / adaptive routing audit

`ProviderGateway` and `AdaptiveRouter` are not in the active extension path.

The live product continues to use its earlier provider/router architecture.

Before replacing it, preserve the good existing behavior and introduce an explicit normalized provider contract containing:

- capability matrix
- context limit
- tool-call support
- structured output support
- streaming support
- vision support
- cancellation semantics
- timeout semantics
- retryability classification
- privacy/locality
- cost signal
- latency EWMA
- failure EWMA
- health state

Adaptive routing should be explainable and user-overridable.

---

# 17. Editing Engine 2.0 audit

`TransactionalEditEngine` is not connected to the live edit path.

Even in isolation, its transaction model is **best-effort rollback**, not a true filesystem-atomic multi-file transaction.

It sequentially writes final paths and, on failure, attempts to rewrite old content.

Important missing guarantees:

- temp file + fsync + atomic rename per file
- durable transaction journal
- crash recovery
- rollback-failure reporting
- workspace/security boundary checks
- symlink race defense
- concurrent editor modification handling across the whole transaction
- partial directory creation rollback

The existing live edit engine has valuable review/recovery features. The upgrade should merge the best aspects rather than creating a disconnected second editor.

---

# 18. Terminal/process lifecycle audit

The live terminal system is one of the more important and capable parts of TuxNest:

- shell resolution
- output capture
- adaptive timeout logic
- tracked children
- detached process groups on non-Windows
- Windows `taskkill /T /F`
- bounded output strings
- explicit stop operations

However, the lifecycle test:

> `awaited shutdown terminates owned shell descendants and their HTTP listener, not unrelated listeners`

failed during this audit.

That is a release-blocking class of problem until reproduced and explained.

### Required process test matrix

For Windows, macOS and Linux:

- direct child exits normally
- child spawns grandchild
- grandchild opens TCP port
- child ignores SIGTERM
- shell wrapper spawns daemon
- command exceeds timeout
- user cancels
- extension deactivates
- VS Code window closes
- process exits while cancellation races
- 100 concurrent processes
- huge stdout/stderr
- binary output
- process PID reused scenario where practically testable

Success means:

- no owned process remains
- no owned listener remains
- unrelated process remains alive
- cleanup resolves within bounded time
- final state and trace are correct

---

# 19. Browser audit

The existing browser layer is intentionally scoped around local development pages and provides useful rendered-page information including accessibility snapshots and console/network failures.

That is good for web app verification.

It is **not a whole-desktop computer-use system**.

A browser agent and a desktop agent should remain separate capability domains.

---

# 20. Remote GPU / SSH audit

The existing remote subsystem is more mature than several new upgrade modules.

Strengths include:

- SSH configuration
- secret storage
- fingerprint/host verification concepts
- tunnel management
- GPU/Ollama-oriented use case

World-class upgrades should add:

- lifecycle correlation with run IDs
- cancellation tree integration
- remote process lease management
- environment capability filtering
- encrypted structured runner protocol
- health/reconnect policy
- artifact transfer integrity hashes
- remote workspace sandbox root
- per-run credential issuance
- explicit host capability inventory
- audit receipts

Do not replace SSH safety with an opaque “remote runner” abstraction unless the new runner provides stronger guarantees.

---

# 21. Observability audit

`RunEventLogger` is not active in the runtime graph.

A world-class agent needs structured events such as:

```text
run.created
run.state_changed
plan.created
agent.spawned
agent.handoff
permission.requested
permission.resolved
tool.started
tool.finished
tool.failed
process.spawned
process.terminated
edit.prepared
edit.applied
edit.rolled_back
checkpoint.saved
recovery.started
verification.started
verification.completed
worktree.created
merge.previewed
merge.completed
run.completed
run.cancelled
run.failed
```

Every event should carry correlation identifiers but redact secrets and unnecessarily sensitive content.

---

# 22. Code quality scan

## Large files

Major monoliths remain:

| File | Approx. LOC |
|---|---:|
| `src/ui/chatView.ts` | 2,089 |
| `src/core/LocalForgeEngine.ts` | 1,023 |
| `src/agent/agentLoop.ts` | 908 |
| `src/agent/coreTools.ts` | 850 |
| `src/extension.ts` | 718 |
| `src/editing/editEngine.ts` | 640 |

These are not automatically bad, but the combination of UI, orchestration, policy and lifecycle responsibilities increases regression risk.

## TypeScript posture

Strict TypeScript is a positive.

The repository still contains numerous `any` usages and broad catches. Each must be reviewed rather than mechanically removed.

## Missing lint gate

`package.json` has no ordinary lint command, and CI does not run a lint/static-style gate.

Recommended stack:

- ESLint with TypeScript-aware rules
- import-boundary rules
- no-floating-promises
- no-misused-promises
- explicit unsafe-any tracking
- complexity thresholds for selected modules
- architecture dependency constraints

Do not enable hundreds of noisy style rules. Focus lint on correctness and maintainability.

---

# 23. Release / CI audit

Current GitHub Actions workflow runs only on Ubuntu:

```text
npm ci
npm test
npm run package
```

This is insufficient for a desktop VS Code agent whose behavior depends heavily on processes, shells and paths.

## Mandatory matrix

At minimum:

```text
ubuntu-latest × Node supported version
windows-latest × Node supported version
macos-latest × Node supported version
```

For each platform:

- clean npm install
- typecheck
- lint
- unit tests
- integration tests
- process-lifecycle tests
- Extension Host tests
- package
- install packaged VSIX into clean test profile
- smoke workflow against installed VSIX

## Release verifier flaw

`verify-release-pipeline.cjs` reports success when `dist/extension.bundle.js` is missing and prints:

```text
Bundle SHA256: N/A
```

A missing release artifact must fail the release verifier.

## SBOM weakness

The generated CycloneDX-like SBOM currently enumerates only direct runtime dependencies from `package.json`.

It does not provide a strong supply-chain graph for the ~363 package-lock entries.

Use a proper CycloneDX generator with:

- transitive dependencies
- package URLs
- hashes where supported
- dependency relationships
- tool metadata
- reproducible generation

## Identity scanner weakness

The identity scanner checks only package name/displayName/publisher and command prefixes.

It should also scan:

- repository/homepage/bugs
- README
- CHANGELOG
- docs
- command titles
- configuration titles
- telemetry/event labels
- storage keys requiring migration/legacy allowance
- media names
- class/type names where user-visible or release-sensitive

It must distinguish **intentional migration compatibility** from accidental identity drift.

---

# 24. Supply-chain observations

Direct runtime dependencies:

- `ignore`
- `minimatch`
- `playwright-core`
- `undici`

Important development/runtime-build dependencies include VS Code test tooling, VSCE, TypeScript, esbuild and SSH support.

The lockfile contains roughly **363 package entries**.

A simple secret-pattern scan found only obvious synthetic test credentials in test fixtures; no immediate real secret was proven by that scan. This is not a substitute for a dedicated secret scanner such as Gitleaks with entropy and allowlisting.

---

# 25. Native full-desktop control: current gap

The user requirement is for TuxNest to become flexible enough to operate the entire desktop for general tasks.

Current built-in tools include capabilities such as:

- workspace read/write/edit/search
- terminal command execution
- Git operations
- rendered local browser actions
- explicitly approved outside-workspace file read/list
- web page reading
- remote GPU/SSH workflows

There is no production subsystem for:

- screen capture
- mouse movement/click/double-click
- drag/drop
- wheel scrolling
- keyboard text input
- keyboard shortcuts
- window enumeration
- window focus
- application launch/focus lifecycle
- native accessibility tree querying
- OS-native UI element selection
- clipboard broker
- screen-coordinate grounding
- visual verification loop
- desktop action replay/audit

Therefore **TuxNest does not currently have full desktop control**.

---

# 26. Design: World-Class Computer-Use Kernel

Do **not** implement “full machine control” as one unrestricted `desktop_execute` command.

Build a capability-brokered computer-use runtime.

## 26.1 Core architecture

```text
Agent / Planner
     │
     ▼
ComputerUsePlanner
     │
     ▼
Desktop Capability Broker ──────► User approval UI
     │
     ├── Observe Broker
     │     ├─ screenshot
     │     ├─ windows
     │     └─ accessibility tree
     │
     ├── Input Broker
     │     ├─ click
     │     ├─ drag
     │     ├─ scroll
     │     ├─ text input
     │     └─ key chord
     │
     ├── Application Broker
     │     ├─ enumerate
     │     ├─ launch
     │     ├─ focus
     │     └─ close (approval-sensitive)
     │
     └── Clipboard Broker
           ├─ read (sensitive)
           └─ write

Every action → PolicyBroker → RunEventLogger → evidence receipt
```

## 26.2 OS adapters

### Windows

Prefer native facilities such as:

- UI Automation for semantic controls
- Windows Graphics Capture / appropriate native screen capture
- supported input APIs for current-user desktop
- process/window APIs

Never attempt to bypass:

- UAC secure desktop
- login/lock screen
- credential-protected UI
- OS policy

### macOS

Use:

- Accessibility APIs (`AXUIElement` family)
- ScreenCaptureKit / appropriate capture framework
- approved event injection mechanisms

Respect macOS Accessibility and Screen Recording permissions.

### Linux

Primary modern target:

- AT-SPI accessibility
- XDG Desktop Portal / PipeWire screen capture
- Wayland-compatible input strategy where supported by compositor/portal policy

X11 fallback can exist but must not silently assume X11 permissions on Wayland.

## 26.3 Desktop tool contract

Suggested typed actions:

```text
desktop.observe
desktop.screenshot
desktop.list_windows
desktop.focus_window
desktop.open_application
desktop.get_accessibility_tree
desktop.find_element
desktop.click
desktop.double_click
desktop.drag
desktop.scroll
desktop.type_text
desktop.key_chord
desktop.wait_for
desktop.clipboard_write
desktop.clipboard_read
```

Each action should return:

- action ID
- target window/app
- precondition snapshot ID
- semantic target or coordinate
- result
- postcondition snapshot ID
- confidence
- elapsed time
- policy decision ID

## 26.4 Observe → Act → Observe → Verify

Never allow long blind action chains based on stale pixels.

Use:

```text
observe
→ ground target
→ verify foreground window
→ act
→ observe again
→ verify expected state
```

If the screenshot/window revision changed unexpectedly, invalidate the action plan.

## 26.5 Sensitive desktop handling

Detect or conservatively protect:

- password fields
- OTP fields
- payment screens
- private keys
- password managers
- authentication dialogs
- clipboard secrets
- secure OS surfaces

The agent should be able to assist around these surfaces, but should not silently extract credentials or bypass OS/user consent.

## 26.6 Emergency control

Mandatory:

- always-visible active-control indicator
- global emergency stop hotkey
- immediate cancellation tree propagation
- mouse/keyboard release cleanup
- maximum action rate
- maximum unattended duration
- optional per-app allowlist

## 26.7 Desktop isolation from terminal authority

Desktop permission must not imply terminal permission.

Terminal permission must not imply desktop permission.

File permission must not imply clipboard permission.

Treat capabilities independently.

---

# 27. N × N × N × N: how to test this properly

A literal exhaustive product Cartesian space rapidly becomes impossible.

For example, consider these 18 meaningful dimensions:

| Dimension | Values |
|---|---:|
| OS | 3 |
| workspace trust | 2 |
| access scope | 3 |
| permission mode | 4 |
| agent role | 10 |
| task class | 8 |
| tool category | 8 |
| risk class | 4 |
| provider type | 5 |
| execution tier | 4 |
| file state | 8 |
| Git state | 6 |
| network state | 6 |
| cancellation phase | 6 |
| restart state | 5 |
| memory state | 5 |
| MCP state | 5 |
| desktop state | 10 |

The full Cartesian product is approximately:

```text
7,962,624,000,000 combinations
```

That is not a sensible release test target.

But enumerating **every four-dimension value interaction** across those 18 dimensions is around:

```text
2,981,563 raw 4-way value combinations
```

Even that can be reduced dramatically by a proper covering-array generator while preserving interaction coverage.

## Required strategy

### Layer A — deterministic unit/contract invariants

Target: 5,000–15,000 meaningful assertions.

### Layer B — pairwise covering array

Cover every 2-way value interaction across the global configuration dimensions.

### Layer C — global 3-way covering array

Use IPOG/ACTS-style generation.

Focus especially on:

```text
OS × permission × tool
OS × shell × cancellation
agent × provider × tool
scope × policy × filesystem state
provider × stream state × cancellation
```

### Layer D — focused 4-way exhaustive/covering sets

Do **not** exhaust 4-way interactions everywhere equally.

Make high-risk domains exhaustive or near-exhaustive:

```text
permission × scope × tool × risk
OS × shell × process topology × cancellation
filesystem type × path form × symlink state × operation
agent role × write target × worktree state × merge state
provider × tool-call state × cancellation × retry
MCP trust × permission × tool risk × server state
network target × DNS resolution × redirect state × permission
memory trust × retrieval source × injection type × agent role
desktop app × window state × action class × permission
```

### Layer E — property-based fuzz

Target nightly:

```text
500,000+ seeded executions
```

Requirements:

- semantic generators
- shrinking/minimization
- seed persistence
- replay command
- coverage metrics
- no count inflation from trivial suffix changes

### Layer F — state-machine traces

Target nightly:

```text
100,000+ generated traces
```

Example run-state actions:

```text
start
plan
spawn_agent
request_permission
approve/deny
start_tool
cancel
save_checkpoint
restart_extension
resume
fail_provider
retry
rollback
complete
```

Verify invariants after every action.

### Layer G — concurrency schedule fuzzing

Target nightly:

```text
100,000+ controlled schedules
```

Actually overlap operations:

- competing file leases
- worktree merge races
- cancellation during tool start
- child process exiting while kill begins
- two agents checkpointing
- provider streaming while run is cancelled
- extension shutdown during write

Use barriers/yields/fake schedulers so race windows are deliberately explored rather than left to chance.

### Layer H — fault injection

Inject failures at every async boundary:

- before operation
- during operation
- after side effect but before persistence
- after persistence but before acknowledgement

### Layer I — packaged VSIX acceptance

All critical scenarios must run against the **installed package**, not only source imports.

### Layer J — desktop computer-use qualification

Per OS, include real applications and window changes:

- text editor
- browser
- terminal
- file manager
- settings app
- native file dialog
- multi-monitor where available
- DPI scaling
- minimized/covered windows
- accessibility unavailable
- stale screenshot
- app crash
- focus theft
- clipboard mutation
- user interrupts agent

---

# 28. Agent-behavior evaluation framework

Traditional unit tests are not enough for an autonomous agent.

Create an evaluation harness with repository tasks graded on outcome rather than generated text.

## Task families

- locate bug
- implement feature
- refactor safely
- fix build
- dependency upgrade
- UI bug
- API migration
- security remediation
- failing test diagnosis
- performance regression
- documentation-aware change
- multi-file change
- cross-language repository
- monorepo
- ambiguous requirement
- malicious repository instruction
- intentionally misleading test

## Agent behavior metrics

Track:

- task success
- first-pass success
- regression count
- files touched
- unnecessary changes
- tool calls
- tokens
- elapsed time
- permission prompts
- retries
- rollback count
- user interruptions
- build/test evidence quality
- hallucinated completion rate
- destructive-action prevention
- context precision/recall

## Behavioral invariants

An agent must never mark a task complete because it merely:

- wrote code
- saw one green test
- received a model statement saying “done”

Completion should require evidence selected from the task's risk profile.

---

# 29. Verification engine target

Every state-changing task should generate a `VerificationPlan` before completion.

Example:

```json
{
  "claims": [
    "extension compiles",
    "new command is registered",
    "permission prevents unapproved execution",
    "cancel stops owned process tree"
  ],
  "evidence": [
    "tsc",
    "extension-host command test",
    "policy integration test",
    "process lifecycle test"
  ]
}
```

The verifier should fail closed when required evidence is unavailable.

“Unable to verify on this OS” is acceptable.

“Verified” without execution is not.

---

# 30. Required architectural convergence

TuxNest currently risks maintaining two generations of architecture:

```text
Generation A: existing live engine + permissions + tools + providers
Generation B: new runtime/policy/MCP/RAG/review/worktree modules
```

The product must converge to one graph.

Recommended target:

```text
VS Code Extension/UI
        │
        ▼
Application Service Layer
        │
        ▼
RunManager ───────────── RunEventBus
        │                    │
        ├─ Dynamic Planner   └─ Diagnostics / Audit
        ├─ Scheduler
        ├─ Checkpoint/Recovery
        └─ Verification
        │
        ▼
Capability Broker / PolicyBroker
        │
        ├─ Workspace/File Broker
        ├─ Terminal/Process Broker
        ├─ Browser Broker
        ├─ Desktop Computer-Use Broker
        ├─ Network Broker
        ├─ Git/Worktree Broker
        ├─ MCP Broker
        └─ Remote Runner Broker
        │
        ▼
OS / VS Code / External Systems
```

Nothing side-effectful should bypass the broker.

---

# 31. Super-upgrade execution roadmap

## P0 — Truth and safety gate

Before adding more features:

1. Fix tracker count (56 vs 60).
2. Reclassify disconnected modules as IMPLEMENTED_NOT_INTEGRATED.
3. Make release verifier fail on missing bundle.
4. Make identity scanner comprehensive.
5. Restore clean reproducible dependency install/build.
6. Re-run all tests on clean checkout.
7. Fix/triage process-tree lifecycle failure.
8. Fix cross-platform security test semantics.
9. Make CI Windows + Linux + macOS.
10. Add packaged VSIX acceptance.

**Exit criterion:** release evidence becomes trustworthy.

## P1 — Integrate runtime kernel

1. Construct one `RunManager` per run.
2. Replace ad-hoc cancellation ownership.
3. Propagate run context through agents/tools.
4. Wire budgets.
5. Wire resource leases.
6. Wire structured run events.
7. Add crash/restart recovery.

**Exit criterion:** one lifecycle model controls real user runs.

## P2 — Integrate PolicyBroker

Route every side effect through central capability decisions.

Required categories:

- filesystem
- process
- network
- browser
- Git
- MCP
- remote
- desktop
- clipboard
- credential/secret

**Exit criterion:** there is no alternate unguarded side-effect path.

## P3 — Environment and sandbox hardening

- integrate `EnvironmentFilter`
- minimal subprocess environment
- secret injection by lease
- execution tiers become real backends
- optional local container sandbox
- remote runner protocol only after authentication/integrity design

## P4 — Multi-agent V3

- make dynamic planner active
- model-generated typed plan + deterministic validator
- repository-aware target files
- scheduler resource locks
- worktree isolation
- typed handoffs
- checkpoints
- replanning
- verifier gate

## P5 — Editing convergence

Merge transactional concepts into the actual live edit engine.

- temp-write/rename
- journaling
- crash recovery
- stale hash validation
- symlink safe handles
- multi-file rollback status
- editor state conflict handling

## P6 — Context/RAG V3

- parser/LSP-based symbol graph
- semantic + lexical index
- provenance/trust labels
- injection-safe prompting architecture
- retrieval evaluation suite

## P7 — Memory V3

- durable bounded schemas
- provenance
- confidence
- contradiction resolution
- privacy/user controls
- memory quality evaluation

## P8 — MCP production integration

- settings/UI
- server lifecycle
- policy gating
- env filtering
- approval handling
- provenance
- health
- circuit breaker
- packaged E2E tests

## P9 — Hooks/rules/custom agents

Wire them to the actual lifecycle after the policy broker exists.

## P10 — Computer-Use Kernel

Build the native desktop architecture in Section 26.

Start Windows first if that is the primary user platform, but keep OS-neutral interfaces from day one.

## P11 — Verification/review convergence

Integrate evidence planning, test impact and review engines into completion decisions.

Do not rely on shallow regex scanners as the only reviewer.

## P12 — Observability

- structured run events
- trace viewer
- support bundle
- redaction
- performance counters
- deterministic replay metadata

## P13 — Release qualification V3

Implement the layered combination/fuzz/state/concurrency strategy in Section 27.

---

# 32. Twenty parallel engineering workstreams

These can be assigned to 20 specialized agents/engineers, but integration must be controlled by one architecture owner.

| # | Workstream | Deliverable |
|---|---|---|
| 1 | Runtime lifecycle | Active RunManager/Cancellation/Budget kernel |
| 2 | Capability security | Central PolicyBroker integration |
| 3 | Filesystem security | path/symlink/junction/TOCTOU hardening |
| 4 | Process runtime | cross-platform process tree correctness |
| 5 | Execution sandbox | real sandbox/container tiers |
| 6 | Multi-agent planner | dynamic typed DAG planning |
| 7 | Multi-agent scheduler | concurrency, leases, replanning |
| 8 | Git isolation | production worktrees/merge gates |
| 9 | Checkpoint/recovery | crash/restart resumability |
|10 | Editing | durable transactional edits |
|11 | Provider layer | normalized gateway + adaptive routing |
|12 | RAG/context | parser graph + hybrid retrieval |
|13 | Memory | durable structured memory |
|14 | MCP | secure production MCP runtime |
|15 | Rules/hooks/agents | lifecycle extensibility |
|16 | Browser verification | robust local web verification |
|17 | Desktop control | native computer-use kernel |
|18 | Remote runner/GPU | secure remote execution fabric |
|19 | Verification/QA | evidence, fuzz, covering arrays, E2E |
|20 | CI/release/observability | reproducible signed/traceable releases |

No workstream can mark itself VERIFIED based only on its own unit tests. Cross-workstream integration gates are mandatory.

---

# 33. P0 defect / claim-correction list

The following should be treated as immediate blockers to another “fully verified” announcement:

1. **43 tracker items point entirely to runtime-unreachable source.**
2. Tracker says 56 items; detailed tracker contains 60.
3. `RunManager` is not the active runtime kernel.
4. `PolicyBroker` is not the active authority for live tools.
5. `EnvironmentFilter` is not used; live terminal inherits `process.env`.
6. `DynamicPlanner` is not used by the live `decomposeGoal()` path.
7. live task `targetFiles` are empty.
8. `CheckpointManager` is not passed to the live orchestrator construction.
9. Handoff V2 is disconnected.
10. Worktree execution is disconnected.
11. Worktree conflict preview does not actually test merge conflicts.
12. MCP is not integrated as a product feature.
13. hooks are not integrated.
14. rules engine is not integrated.
15. custom agent profiles are not integrated.
16. RAG 2.0 symbol/dependency modules are not active.
17. symbol indexer is not truly AST-based.
18. Memory V2 is not the live memory authority.
19. provider gateway/adaptive router are not active.
20. transactional edit engine is not the live editing authority.
21. transactional writes are best-effort rollback rather than crash-atomic transactions.
22. verification engines are disconnected.
23. code/security review engines are disconnected.
24. execution tiers are metadata, not proven sandbox backends.
25. runner protocol is not a complete remote execution fabric.
26. scoped vault is not a production credential delivery system.
27. new observability logger is disconnected.
28. ring buffer is disconnected.
29. UI protocol split is disconnected; major webview monolith remains.
30. adversarial security suite fails in this audit environment.
31. normal test suite is not all green in this audit environment.
32. high-scale combination suite contains behaviorally unused dimensions.
33. concurrency suite does not exercise real scheduler concurrency.
34. adversarial count is dominated by repetitions of a tiny corpus.
35. terminal descendant cleanup test fails here.
36. release verifier passes with `Bundle SHA256: N/A`.
37. identity scanner misses substantial legacy branding/URLs.
38. SBOM is direct-dependency-only and incomplete for supply-chain claims.
39. CI is Ubuntu-only.
40. no native desktop computer-use system exists.

---

# 34. Definition of VERIFIED going forward

Every ticket should have these fields:

```text
IMPLEMENTED:
  code exists

INTEGRATED:
  production entry path reaches it

UNIT_VERIFIED:
  focused tests pass

INTEGRATION_VERIFIED:
  neighboring systems pass together

E2E_VERIFIED:
  a user-visible workflow proves it

PACKAGE_VERIFIED:
  installed VSIX proves it

CROSS_PLATFORM_VERIFIED:
  required OS matrix proves it

SECURITY_VERIFIED:
  abuse cases and policy invariants pass
```

Only then may the final status become:

```text
VERIFIED
```

Anything else should retain the strongest truthful intermediate state.

---

# 35. Required CI release gates

A world-class release should fail unless all mandatory gates pass.

```text
01 clean checkout
02 dependency integrity
03 lint
04 strict typecheck
05 architecture/import-boundary checks
06 build
07 unit
08 contract
09 integration
10 security
11 property/fuzz smoke
12 state-machine smoke
13 concurrency smoke
14 Linux lifecycle
15 Windows lifecycle
16 macOS lifecycle
17 Extension Host tests
18 recovery/restart tests
19 package
20 inspect VSIX contents
21 install VSIX into clean profile
22 packaged E2E smoke
23 secret scan
24 dependency vulnerability scan
25 SBOM generation/validation
26 provenance/hash generation
27 identity drift scan
28 documentation consistency
29 performance budget
30 release manifest/signing/publishing checks
```

Nightly and pre-release pipelines should run the much larger generated suites.

---

# 36. Performance targets

Set measurable budgets instead of saying “fast”.

Suggested initial targets, to be measured and tuned against representative repositories:

- extension activation: no expensive full-repo work on critical activation path
- idle CPU: effectively zero background busy loops
- idle memory: bounded and observable
- indexing: incremental and cancellable
- UI input response: no blocking model/index operations on extension UI path
- tool output: byte bounded
- queues: bounded
- logs: bounded/rotated
- retries: bounded
- model calls: cancellable
- desktop observe/action loop: interactive latency with stale-state invalidation

Do not hardcode these as “passed” until measured on CI hardware.

---

# 37. World-class agent behavior requirements

The final product should demonstrate all of the following:

### Autonomy

- decomposes goals
- asks only when necessary
- recovers from ordinary failure
- selects appropriate tools/models
- parallelizes safe independent work

### Restraint

- never silently escalates scope
- avoids destructive operations unless necessary and approved
- stops when evidence is insufficient
- respects user cancellation immediately

### Engineering discipline

- reads before editing
- uses smallest safe change
- tests impacted behavior
- inspects failures rather than retrying blindly
- preserves unrelated user changes
- produces verifiable completion evidence

### Security discipline

- treats repository/web/MCP/desktop content as untrusted
- prevents prompt/tool injection from gaining authority
- protects credentials
- isolates remote and desktop capabilities

### Recovery

- survives provider failure
- survives extension restart
- survives interrupted long tasks
- detects stale plans/checkpoints
- does not duplicate side effects after resume

### Explainability

- user can see what agent is doing
- user can see what it changed
- user can see why permissions were requested
- user can see what verified completion

---

# 38. Recommended final product positioning

If the architecture is completed properly, TuxNest can differentiate itself as:

> **A local-first, inspectable, multi-agent engineering and computer-use platform that can operate code, development tools, remote GPUs, browsers and the user's desktop under explicit capability controls, with evidence-driven verification and resumable execution.**

The differentiator should **not** be “we have 100,000 tests.”

The differentiator should be:

- measurable reliability
- transparent execution
- local/privacy-friendly operation
- strong permissions
- real multi-agent isolation
- powerful remote GPU integration
- native computer use
- recoverable long-running work
- deep repository intelligence
- defensible verification evidence

---

# 39. Immediate next implementation sequence

If one high-capability coding agent is going to perform the next upgrade, the highest-value order is:

```text
1. Fix verification truthfulness and tracker state.
2. Make clean build/test reproducible.
3. Integrate RunManager + cancellation + budgets.
4. Integrate PolicyBroker into every side-effect path.
5. Integrate EnvironmentFilter before terminal/MCP/runner expansion.
6. Fix process-tree cleanup across all OSes.
7. Activate dynamic planning + targetFiles.
8. Wire CheckpointManager into real orchestrator.
9. Implement real worktree agent execution and merge preview.
10. Converge editing systems.
11. Integrate structured handoffs.
12. Integrate provider gateway/router.
13. Replace regex-only RAG claims with parser-backed indexing.
14. Integrate durable memory.
15. Integrate MCP securely.
16. Integrate hooks/rules/custom agents.
17. Build verification/review completion gate.
18. Build Computer-Use Kernel.
19. Build real 3-way/4-way covering + state/concurrency fuzz suites.
20. Ship only after packaged cross-platform VSIX qualification.
```

---

# 40. Final audit conclusion

The upgrade effort added many of the **right concepts**, which is encouraging. The principal failure is that too much of the modernization currently behaves like a **parallel architecture demonstration** rather than the authoritative production runtime.

The repository should now enter an **integration-and-verification phase**, not another broad feature-addition phase.

The standard for the next release should be:

> A claim is real only when the packaged extension executes the capability through the actual runtime, under the actual security policy, on the required operating systems, and an automated test verifies the observable result and cleanup.

For the user's `N × N × N × N` goal, do not chase meaningless trillions of brute-force executions. Build high-quality covering arrays, state machines, concurrency schedules, failure injection and semantic fuzzing. That will find far more real defects than repeating a small assertion corpus 100,000 times.

For the user's “entire desktop control” goal, build a **permissioned Computer-Use Kernel** rather than granting unrestricted OS authority. TuxNest can become highly capable while still operating under the current user's rights, respecting secure OS boundaries, and producing an auditable receipt for every action.

Until the P0/P1 items above are completed and independently revalidated, the correct release statement is:

> **Promising advanced architecture, partially integrated; not yet independently qualified as a world-class fully production-ready autonomous desktop engineering agent.**

---

## Appendix A — High-scale test output reproduced during this audit

```text
AdversarialSecurity:                FAIL
CombinatorialMatrix 18,144:         PASS
ConcurrencyAndSchedulerFuzz 40,000: PASS
PropertyFuzz 30,888:                PASS
-----------------------------------------
High-scale suite tests: 3 pass / 1 fail
```

Normal checked-in-dist test invocation:

```text
392 registered tests
370 passed
22 failed
```

Failures include dependency/environment-load failures, so this is **not** equivalent to 22 confirmed product defects.

---

## Appendix B — Release-verifier reproduction

Observed:

```text
Identity drift scan passed: Package and commands adhere to canonical TuxNest identity.
```

Yet broad source/document/package scanning still finds many old LocalForge references and old repository URLs.

Observed:

```text
Release pipeline verification passed. SBOM generated. Bundle SHA256: N/A
```

A world-class release gate must not pass when the artifact it is supposed to hash is absent.

---

## Appendix C — Audit limitations

This audit is intentionally strict about what can and cannot be proven.

Limitations include:

- The uploaded ZIP is not a Git checkout, so genuine Git-worktree lifecycle cannot be fully executed from that archive alone.
- A clean dependency installation did not complete successfully in the audit environment, so a fresh TypeScript build was not certified here.
- Some checked-in `dist` tests fail because packages are absent in this environment.
- Windows and macOS behavior cannot be proven by Linux execution.
- No real remote GPU/SSH target was supplied.
- No live external model credentials were required or used for this audit.
- Native computer-use functionality is not present, so it could only be architecture-audited as a gap and designed as a target.

These limitations are precisely why claims are classified as verified, disproven, or unverified rather than guessed.

