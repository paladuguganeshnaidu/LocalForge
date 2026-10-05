# LocalForge / LOMVREN implementation verification

## Status

Latest 2026-10-05: local version 1.0.0 candidate packaged and installed, 439 regressions and all 16 native stages passed, actual installed UI ready/visible. Its source/installed bundle matches the GPU-tested runtime. Real Qwen3.5 9B reasoning-enabled Node and CSV tasks passed independent execution checks; the fresh second tiny-site task passed actual browser/runtime verification after repairing a missing-favicon completion gate. Exact evidence, hashes, historical failures, native fixture cleanup EPERM and remaining larger-model/full-site/100-tool limitations are in AGENT-TEST-REPORT.md. Publication/Git push are held for confirmation; the version number is not production certification. Following status paragraphs are historical.

2026-10-05 follow-up: the previous 0.3.2 installation passed 432 regressions, 16 native stages and rendered chat UI, but the new-studio minimal-site driver failed with an empty result.json after one saved HTML file. It is not website acceptance. Current source adds task-adaptive non-web tool priorities, atomic benchmark evidence and an input-driven release/install/publish helper documented in RELEASE.md. The first helper run passed 435 regressions and packaging but failed automatic installation because the installed VS Code uses a versioned CLI directory and the sandbox environment's LOCALAPPDATA did not resolve the real installation. CLI discovery now reads the trusted installed code.cmd, checks paths stay inside the installation, supports the standard home fallback and has an actual filesystem regression. Final rerun evidence is separate. Full GPU/20B/40B acceptance, 100 independent tools and original full-site repeat success remain unverified; no Marketplace upload or GitHub push is implied. The older status below describes historical evidence.

Working evidence ledger, updated 2026-10-04. **The complete repair mission is still active. This is not a production sign-off or a claim that all requested features are implemented.** A 0.3.0 checkpoint is preserved and a verified session-tools 0.3.0 development build is installed locally. Current source includes additional effort/directory repairs with 424 regressions and all 16 native stages passing. Real GPU Node acceptance passed; the first full NexusFlow/3D test failed and does not justify 1.0.0. Current hashes, installed/source distinctions, failures and pending gates are in `AGENT-TEST-REPORT.md`; usage is in `USER_GUIDE.md`. No commit, push or Marketplace upload has occurred in this repair turn yet. Older sections describe historical states.

## Repository and environment

- Repository: `C:\Users\ganes\OneDrive\Desktop\LocalForge`.
- Branch: `main`; starting commit: `797cf4811dadef15d815edfa083e3fe9bf08195a`.
- Manifest version: `0.2.24`; VS Code engine: `^1.106.0`.
- Node `v24.13.1`; npm `11.17.0`; Windows PowerShell.
- Ending state for this checkpoint: uncommitted source, tests, manifest, scripts, and documentation changes. The final working-tree inventory must be regenerated at release sign-off.

## Baseline before the architectural repair

| Command | Exit | Observed evidence |
| --- | --- | --- |
| `npm ci` | 0 | 326 packages added; 327 audited; six high-severity development dependency findings. Native install scripts were not approved in that installation. |
| `npm run build` | 0 | TypeScript and production bundle initially built. |
| `npm test` | 0 | 245 passed; 0 failed, cancelled, skipped. The old three missing-`ssh2` load failures did not reproduce after installation. |
| `npm run test:extension-host` | 1 | Runner opened no workspace unless live editing was enabled; the unconditional File-scope/directory stage needed a workspace. |
| `npm run test:recovery-restart` | 0 | Two real VS Code processes verified exact-byte restoration, binary deletion/move, created-file diff, open editor refresh, and rollback activity. |
| `npm run test:ollama-smoke`, `npm run test:ollama-agent`, `npm run test:ollama-summary` | 1 each | Local Ollama was stopped: connection refused at `127.0.0.1:11434`, before model behavior could be tested. |

Baseline logs are in the machine's temporary directory under `localforge-repair-baseline-*.log`. Baseline V8 evidence is in `localforge-repair-coverage-unit.log` and `localforge-repair-coverage-20261003`.

The extension-host runner now always opens an isolated temporary project/profile, not the user's repository. Its first repaired run passed all 12 stages. A later `npm audit fix --ignore-scripts` populated the optional `cpu-features` package without its native binary; the production bundle then failed resolving `cpufeatures.node`. The build now explicitly externalizes optional native accelerators. `ssh2`'s guarded require retains its JavaScript fallback; native extension activation subsequently passed. This does not verify a real remote GPU connection.

## Architecture changes implemented so far

### Conversations

`src/core/conversationStore.ts` is the sole conversation source of truth. `sessionManager.ts` reexports it for compatibility; `chatView.ts` no longer owns a model-keyed message map.

Production persistence uses `conversations.v2.json` in VS Code's private per-workspace storage. Writes use an exclusive temporary file, sync, and atomic rename. Operations are serialized; committed in-memory state changes only after persistence succeeds. Snapshots are cloned, and stale full-session saves are refused. A cleared-chat epoch prevents a late response or stale activity record from resurrecting cleared content. Legacy session and model-keyed UI histories migrate once; original Memento keys are retained, not overwritten or repeatedly reimported.

Chats retain IDs, titles, timestamps, revision, messages with stable metadata, model, mode, strategy, modified-file metadata, artifact references, and context preview. Chat controls emit real create/switch/rename/delete/clear messages. Changing the model leaves history intact. Disappeared explicit model selections remain unavailable rather than silently routing a request to another provider.

Clear/delete purge their own activities and in-memory artifacts without touching user files or edit-recovery records. Activity writes are serialized and awaited at task completion. Startup filters activity by surviving chat identity and cleared-history epoch. Artifact content restoration and more complete turn retention are still pending.

Storage is bounded to 250 chats, 10,000 messages per chat, and 16 MiB overall. Corrupt data fails closed and is preserved. Guided corruption recovery, backup policy, retention settings, and bounded history pagination are not yet implemented.

### Request intent and cancellation

The shared `taskIntent.ts` contract separates pure greetings/thanks from inspection and coding tasks. Pure conversation requests use direct streaming with a coding-assistant identity instruction and the current message only: no workspace retrieval, references, previous project messages, tool loop, or plan artifact. Actual coding requests retain the existing agent path.

Standalone Stop invalidates the active UI interaction, including late tokens, activities, artifacts, and completion callbacks. Cancelled/empty conversational streams do not store false successful answers. Task failure/cancellation records are finalized. This is conservative intent classification, not a guarantee of model quality for arbitrary natural-language requests.

### RAG, policies, providers, orchestration

These architectural repairs are not yet complete. Older-chat lexical retrieval now derives from the canonical private store, with current-chat isolation and deletion/provenance invalidation. Workspace indexing now has atomic reconciliation, live watchers and hash-verified chunk retrieval; detailed evidence and remaining rendered UI gates are recorded below. A shared canonical tool policy, complete endpoint registration, reachable orchestration and real checkpoints/resume still require implementation and verification. Existing modules or passing plumbing tests are not sufficient evidence of these features.

## Current test evidence

| Command actually executed | Exit | Result and log |
| --- | --- | --- |
| `npm run build` | 0 | TypeScript and 1.3 MiB production bundle pass with optional-native fallback. |
| `node --test tests/conversationIntent.test.js tests/toolCancellation.test.js tests/chatInteractionLifecycle.test.js tests/conversationStore.test.js tests/webviewRenderedScript.test.js` | 0 | 27 passed before the additional cleanup/model-unavailability cases. |
| `npm test` | 0 | 255 passed, 0 failed/cancelled/skipped, after chat cleanup; `localforge-repair-chat-final-unit.log`. |
| `NODE_V8_COVERAGE=<fresh temporary directory> node --test tests/*.test.js` | 0 | 257 passed, 0 failed/cancelled/skipped, including the additional routing regressions; `localforge-repair-current-coverage.log`. |
| Final checkpoint `npm test` | 0 | 258 passed; 0 failed/cancelled/skipped, including stale-package/duplicate-payload/contribution mismatch rejection; `localforge-repair-final-checkpoint-unit.log`. |
| `node tests/runChatRestartTests.js` | 0 | All three real VS Code process phases passed; `localforge-repair-chat-restart.log`. |
| `node tests/runChatRestartTests.js --live-greeting` | 0 | Actual local `qwen2.5-coder:1.5b` streamed `Hello! How can I assist you today?`; `localforge-repair-live-greeting.log`. |
| `node tests/runExtensionHostTests.js` | 0 | All 12 current native integration stages passed; `localforge-repair-current-host.log`. |
| `node tests/runRecoveryRestartTests.js` | 0 | Both real process phases and exact-byte rollback passed; `localforge-repair-current-recovery.log`. |
| `node scripts/smoke-ollama-agent.cjs` | 0 | Actual local model invoked exactly one approved `echo LOCALFORGE_COMMAND_OK`; one permission prompt; process exit 0; final response contained stdout; two visible Thinking updates. `localforge-repair-live-agent-retest.log`. |
| `node scripts/smoke-ollama.cjs` | 0 | Nine installed models discovered; actual generation returned `LOMVREN_OK`. |
| `npm audit --json` | 1 | Six high-severity development findings remain; `localforge-repair-current-audit.json`. |
| `git diff --check` | 0 | No whitespace errors; Git reports Windows line-ending normalization warnings. |
| `npx --no-install vsce package --out <unique temporary VSIX>` then `node scripts/verify-marketplace-package.cjs <VSIX>` | 0 | New package built without overwriting existing releases. Identity, icon, payload exclusions, SHA-256 runtime/icon equality, and current contributions passed; `localforge-repair-package.log`. |

Package verification artifact: `C:\Users\ganes\AppData\Local\Temp\localforge-repair-check-80c8974e-30f9-4e4e-9cc9-2c233d3c4db3.vsix`. This is an uninstalled/unpublished verification package, not a release candidate approved against the complete mission. The machine-specific working report is excluded from its payload.

An additional live native run with `LOCALFORGE_REAL_OLLAMA_EDIT=1` passed existing-file persistence, an actual model-created proposal/approval/disk write, and an actual approved terminal command. It then failed entering File scope because an unexpected engine execution was still busy; its live summary stage was not reached. Caller tracing and an additional no-leaked-execution assertion were added without weakening the scope guard. The next isolated live run passed **all 16 integration stages**, including actual file creation/approval, approved terminal execution, File-scope enforcement, a real read of package.json, and a grounded Markdown summary with the current build/test scripts. Logs: `localforge-repair-live-native.log` (failed first run) and `localforge-repair-live-native-trace.log` (16-stage pass). The intermittent busy-state observation is not labeled fixed merely because the traced rerun passed.

Native rendered UI verification was also attempted in the separate fixture `C:\Users\ganes\AppData\Local\Temp\localforge-ui-9b40c8d6-59f7-49fd-afb6-8e0fc0c0c96a`. The UI helper discovered its actual `[Extension Development Host] LOMVREN-UI-Acceptance - Visual Studio Code` window, but both initial and freshly reselected state capture failed: `window id 330246 no longer belongs to Microsoft.VisualStudioCode; current owner is Microsoft.VisualStudioCode`. No click, typing, security/permission approval, or deletion was performed through the UI helper. No rendered screenshot/click acceptance is claimed. Native IPC tests remain separate evidence; this UI-control limitation does not prevent independent implementation work.

The first live-agent retest executed the command successfully but failed an obsolete assertion expecting `Model working`. The replacement requires natural `Thinking` updates before and after the successful command and rejects model-round counters. Existing command-count, permission, result, and completion assertions remain intact.

Ollama was started explicitly on localhost. `/api/tags` returned nine installed models, including `qwen2.5-coder:1.5b`. No model was installed/deleted, and no SSH credentials were requested or used.

The 257-test V8 inventory contains 69 production TypeScript files and 52 JavaScript test/runner files, with named functions executed in 60 production modules. The later package regression makes the current test/runner inventory 53 files; no additional TypeScript module was introduced. `scratch/repair-source-coverage.md` and `.json` contain the per-file ledger for that coverage run. Its directory is `C:\Users\ganes\AppData\Local\Temp\localforge-repair-coverage-584a0b29-34ed-46a0-b412-222a7f5d0f37`. Module execution is not proof of semantic correctness or rendered UI reachability; a deep pass remains open.

The dependency chain is development packaging tooling through `@vscode/vsce`, secretlint, globby, fast-glob, micromatch, and braces. The [reviewed upstream advisory](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) currently lists no patched braces version; the registry's latest braces version is 3.0.3. A forced downgrade or invented override was not used. Packaging verification and remediation/mitigation still need completion.

## Native chat acceptance evidence

`tests/extensionHost/chatRestartSuite.js` runs the actual extension backend and generated webview message handlers, with a controlled local provider and controlled dialog answers. It is not a screenshot/click test of the rendered VS Code webview.

1. Create A and B through IPC; send `LOCALFORGE_CHAT_A_FACT_7391` / `LOCALFORGE_CHAT_B_FACT_4826` through the actual engine. Verify B's provider request does not contain A's fact.
2. Switch A → B → A → B → A; compare exact stored and transmitted histories.
3. Select a different model within A; verify history unchanged and selection persisted.
4. Accept a real reviewed file creation with an actual recovery record.
5. Exit the first VS Code process. In a new process, verify exact A/B history and A's model.
6. Rename B through IPC. Cancel then accept A's delete confirmation; verify B unchanged and A absent.
7. Verify the reviewed workspace file and recovery backup are still present after chat deletion.
8. Clear B via UI IPC; verify messages and activities empty. Send a new turn and `/clear`; verify the handler sends an empty history and storage/activity agree.
9. Exit the second process. In the third, verify A does not return, B's rename survives, B stays cleared, and the file/recovery remain intact.

The separate live greeting case deliberately seeds Clinch Works data in old messages and README, selects real Ollama in Agent mode, and inspects the actual provider request. The request has exactly two messages; it contains none of the seeded project data. Workspace assembly/reference resolution/tool-loop calls are exactly 0/0/0. Streaming, completion, model/provider metadata, and absence of proposals/artifacts are checked.

## Issue ledger — no final DONE claims yet

`Confirmed / in progress` means a current defect or incomplete requirement has evidence but has not met every Definition-of-Done gate. `Pending reconfirmation` deliberately does not certify an old audit hypothesis as a current fact.

| Issue | Current state | Root cause / evidence / remaining work |
| --- | --- | --- |
| LF-001 | Confirmed / in progress | Normal chat calls `AgentEngine.runTask`; `executeMultiAgentTask` remains separate. No genuine selectable orchestration integration yet. |
| LF-002 | Confirmed / in progress | Checkpoint class exists; safe live task checkpoints and restart/resume acceptance are not implemented/verified. |
| LF-003 | Pending reconfirmation | Enumerate all descriptors and remove policy classification drift; full tool × mode × scope table still required. |
| LF-004 | Confirmed / in progress | Workspace `/search <query>` and `/search chat <query>` now execute deterministically without a model call, with ranked excerpts and traceable source metadata. Unit/native IPC checks pass; complete rendered acceptance remains pending. |
| LF-005 | Confirmed / in progress | Typed request composition drives persisted `/context` output for the last successful request, with recent IDs, older source IDs, references, hash/versioned workspace chunks, estimates and exclusions. Native/live evidence passes; failed-request inspection and complete rendered acceptance remain pending. |
| LF-006 | Pending reconfirmation | Finish picker/resolver coherence, path/security cases, and real UI workflow. |
| LF-007 | Confirmed / in progress | Activation still uses `openAiUrls.split(',')[0]`; endpoint registration/runtime identity repair pending. |
| LF-008 | Confirmed / in progress | Production now starts/disposes live watchers, coalesces events, replaces rebuild snapshots atomically, revalidates source hashes, and refreshes after edits/rollback. Actual native create/change/rename/delete tests pass. Settings/status/rebuild are wired; full rendered end-user acceptance remains pending. |
| LF-009 | Confirmed / in progress | BrowserTool checks browser executables but navigates using fetch. Real rendered browser automation pending. |
| LF-010 | Pending reconfirmation | Structured orchestration outputs, conflict prevention, handoff consumption, concurrency evidence still required. |
| LF-011 | Pending reconfirmation | Shared multi-ecosystem command resolver and complete registered build/lint semantics still required. |
| LF-012 | Pending reconfirmation | Repository-controlled script approval needs comprehensive malicious-fixture verification; do not interpret permissions as isolation. |
| LF-013 | Pending reconfirmation | Explicit local-only default completion routing/privacy tests still required. |
| LF-014 | Pending reconfirmation | Dynamic registry uniqueness/descriptors and explicit replacement semantics still required. |
| LF-015 | Pending reconfirmation | True execution Resume must be distinguished from textual retry after checkpoint integration. |
| LF-016 | Confirmed / in progress | README greeting/chat claims updated; remaining docs/capability/version audit not complete. |
| LF-017 | Confirmed / in progress | Same fetch-versus-browser defect as LF-009; no rendered DOM/click/console verification. |
| CHAT-001 | Confirmed / in progress | Dual histories replaced by ConversationStore; migration/unit/native restart pass. Rendered end-user gate remains. |
| CHAT-002 | Confirmed / in progress | Reachable chat list/filter/switch/rename/delete/clear handlers implemented; native IPC scenarios pass. Actual rendered click coverage pending. |
| CHAT-003 | Confirmed / in progress | Serialized/awaited writes, stale-save guard, clear epochs, trace queue, and late-callback suppression tested. Corruption recovery and broader failure/rapid-operation UI tests pending. |
| CHAT-004 | Confirmed / in progress | First-message deterministic titles/manual rename/active session title wired; rename survives restart. Rendered title/model/filter checks pending. |
| RAG-001 | Confirmed / in progress | Real local BM25-style older-chat retrieval is connected to normal requests, separately budgeted and source-traceable. Actual Ollama recovered the fact outside the recent window. Native restart and lower-level checks pass; rendered UI acceptance and further scale work remain pending. |
| RAG-002 | Confirmed / in progress | Current-chat default, confirmed workspace all-chat opt-in, clear/delete, queued deletion, restart, copied-answer provenance and transitive-source invalidation are implemented/tested. Original displayed histories are preserved; previously untraceable copies/historical previews are not cryptographically erased. Rendered UI acceptance remains pending. |
| RAG-003 | Confirmed / in progress | Bounded lexical chunks carry path/ranges/ID/SHA-256/mtime/language. Native watcher/edit/rollback, ignore/binary/size and File-scope checks pass. No mandatory cloud embeddings; final rendered/scaled release-wide acceptance remains pending. |
| ART-001 | Confirmed / in progress | Artifacts remain in memory; persisted turn history omits artifact content. Per-chat purge added, but coherent artifact restoration is pending. |
| SET-001 | Confirmed / in progress | Chat-memory and index-limit drawer settings are validated and saved at Workspace scope; all-chat opt-in has native IPC confirmation coverage. Index status/rebuild has real runtime IPC. Existing other drawer settings still update globally; full settings/provider and rendered UI coverage remain pending. |
| EXT-001 | Pending reconfirmation | Full MCP client/discovery/cancellation/policy/mock-server lifecycle not certified. |
| EXT-002 | Pending reconfirmation | Typed lifecycle hooks and timeout/security behavior not certified. |
| EXT-003 | Pending reconfirmation | Discoverable trusted skills/provenance/tool restrictions not certified. |
| EXT-004 | Pending reconfirmation | Background process support does not prove background agent support; complete task lifecycle not certified. |
| SEC-001 | Confirmed / in progress | README explicitly says processes are not OS-sandboxed. Permission tightening and remaining security matrix still required. |

Changed implementation/test files are listed in the current Git working tree. The principal evidence for CHAT issues is `conversationStore.test.js`, `conversationIntent.test.js`, `chatInteractionLifecycle.test.js`, `canonicalModelIdentity.test.js`, and the three-process native chat suite. Existing rollback/security/permission suites remain passing at the 255-test checkpoint.

## Remaining gates

- Fresh source coverage ledger after all added files, deep semantic reachability review of every production module, and complete docs/manifest/message/setting inventory.
- Rendered chat-RAG/settings/context acceptance, further retrieval scale measurements, complete workspace chunk composition and failed-request context inspection. Lexical older-fact, cross-chat opt-in, deletion/provenance and actual Ollama checks now have evidence below.
- Workspace chunks/watchers/rebuild/status, coherent `@file`, deterministic `/search` and `/context`, all endpoint registration, and settings scope/validation.
- Canonical tool policy/unique registration/shared commands, stricter process approvals, all supported ecosystem fixtures, and updated dynamic N²/N³ matrices.
- Reachable structured multi-agent execution, conflict-safe concurrency, recoverable checkpoints, real restart Resume, and honest Retry labels.
- Genuine browser automation, default-private autocomplete, and feasible MCP/hooks/skills/background architecture with tests.
- Actual rendered VS Code end-user verification, including webview console/CSP, chat controls, approval/review, failure states, and all new feature interactions.
- Guided conversation corruption recovery, meaningful artifact persistence, bounded UI history rendering, scale measurements, final VSIX package inspection, dependency findings, and final release regression.

The complete goal is not achieved. This ledger must be updated with exact final counts, dynamic registered tool count, final matrix results, package evidence, UI evidence, and every issue's actual end state before release.

## 2026-10-03 continuation — actual older-chat retrieval checkpoint

This continuation makes implementation progress, not a completion claim. The previous response to the user's edit-prompt question did not change goal state; the objective and current working tree were reread before further implementation. Branch/version remain `main` / `0.2.24`, with no staging, commit, push, installation or publication.

### Source and ownership changes

- `src/context/chatMemory.ts` derives a bounded lexical BM25-style index from canonical private chat messages, with no second persisted chat database or mandatory embedding service. Requests yield periodically, honor cancellation, wait for queued persistence and revalidate source revisions before returning. Queries trace chat/message/turn IDs and sanitized-character ranges. Only user/assistant text without tool calls is eligible; NUL data and messages over 8,000 characters are excluded. One excerpt per message and duplicate excerpt suppression avoid redundant evidence.
- `src/context/requestContext.ts` composes actual outbound recent messages, older evidence and permitted typed file/workspace sources within estimated character budgets. It reserves output/system allowances, records exactly included sources and truncation/exclusion decisions, and formats the persisted inspector. Estimates are not an exact tokenizer or a guarantee that unlimited output fits every model.
- `LocalForgeEngine` calls this composition in normal task execution; `/search chat` and `/context` run deterministically without a model call. Pure greetings remain project/history/tool-free. File access excludes broader chat memory and hides prior broader context inspection. Context/reference assembly now runs inside task failure handling, so an assembly exception fails the task/turn and releases busy state instead of leaving a running trace.
- `ConversationStore` validates assistant memory-source provenance. Retrieval and recent context exclude answers whose recorded source messages/chats were cleared/deleted, including transitive dependencies and cyclic/invalid provenance. This does not erase original displayed messages, user-owned copies, old untraceable copies or historical inspector text.
- Settings contributions and the real drawer expose enabled/current-or-all/recent budget/retrieved budget/result count. Only these new settings now use Workspace scope; the old settings scope/UI defects are not declared fixed. Native IPC proves declined opt-in preserves Current and accepted opt-in stores `workspaceValue=all`, not `globalValue`.

Known credential patterns are redacted before automatic retrieval/context, not overwritten in storage. This is not a universal secret detector. Workspace indexing/watchers, embeddings, artifact indexing/persistence and full end-user rendered coverage remain separate unfinished requirements.

### Reproduced failures and repairs

1. The initial concurrent deletion regression found retrieval could finish before an already queued file-store deletion committed. Waiting for the canonical persistence queue before snapshotting and before returning makes the regression pass without clearing original history or weakening assertions.
2. Initial native memory acceptance failed with `Inspection needed`: the old literal `test` check forced repository execution for “What was the internal test codename I gave earlier?” Shared task intent now recognizes memory questions, without bypassing actual actions such as “run the test I mentioned earlier” or “read the file I mentioned earlier.” The native test was rerun, not removed. Initial failure log: `%TEMP%\localforge-chat-memory-native.log`.

### Exact evidence at this checkpoint

- `npm run build`: exit 0; TypeScript and production bundle passed. Logs: `%TEMP%\localforge-chat-memory-build.log` and `%TEMP%\localforge-chat-memory-live-build.log`.
- `npm test`: exit 0; **271 passed, 0 failed/cancelled/skipped**, 24.94 s. Log: `%TEMP%\localforge-chat-memory-final-unit.log`. This count is from the checkpoint before the subsequent typed workspace-summary preservation addition; that final small change still needs a fresh complete rerun.
- `node --test tests/chatMemory.test.js tests/chatMemoryEngine.test.js`: exit 0; **13 passed**, including privacy, direct/derived/transitive deletion, cyclic provenance, restart, persistence queue, known-secret/tool exclusion, character budgeting, File access, real engine injection, deterministic shortcuts, context failure handling and settings validation.
- Scale fixture: **1,200 messages**, bounded 500-character result, event-loop yield observed; lexical query measured **2,168.8 ms** on this machine during concurrent native testing. This is a single measurement, not a release-wide performance signoff.
- `node tests/runChatRestartTests.js --chat-memory` with verified local VS Code 1.140.0 executable: exit 0; **two native processes passed** (`memory-prepare`, `memory-verify`). Log: `%TEMP%\localforge-chat-memory-native-retest.log`. This exercised real view IPC, actual engine/provider dispatch, exact older source IDs, `/context`, `/search chat`, restart, declined/accepted all-chat confirmation, immediate configuration target/runtime behavior, source-chat deletion and active-chat clearing. Windows retained the owned temp profile `localforge-chat-restart-e6G9z1` after an EPERM cleanup warning; this is recorded, not hidden. This run preceded the later lexical chunk refinement; final-state native rerun remains required.
- `node tests/runChatRestartTests.js --live-memory`: exit 0; actual Ollama `qwen2.5-coder:1.5b` response: **“The internal test codename I gave earlier was ORBITAL-MANGO-91734.”** The inspected real provider request had no fact in recent messages, included supporting message `617b4a0a-5e16-408e-b102-a9fd0583ac10` in retrieved evidence, excluded Chat B's private fact, and `/context` showed the exact source. Log: `%TEMP%\localforge-chat-memory-live-ollama.log`. This is real inference, not a hard-coded success; the subsequent workspace-summary preservation addition still needs final-state revalidation.

Native fixture tests use a controlled webview message bridge, not rendered mouse clicks. The live model case uses real Ollama inference; the restart case uses a deterministic provider to inspect plumbing. Neither substitutes for the outstanding rendered UI/manual acceptance gates.

### Final-state revalidation for this continuation

The fresh results below supersede the small-change revalidation caveats above; they do not certify the unfinished full mission.

- Final app `npm run build`: exit 0, `%TEMP%\localforge-chat-memory-final-build.log`. Typed workspace identity is retained as a budgeted `workspace_summary` source rather than being accidentally dropped when switching from concatenated prompt text to typed sources.
- `NODE_V8_COVERAGE=<unique temp directory> npm test`: exit 0, **271 passed, 0 failed/cancelled/skipped**, 25.96 s; `%TEMP%\localforge-chat-memory-final-coverage.log`. `node scripts/collect-source-coverage.cjs <coverage directory>`: exit 0; **71 production TS files, 55 JS tests/runners, 62 production modules with executed named functions**. Current ledgers: `scratch/repair-source-coverage.md` / `.json`. Coverage directory: `C:\Users\ganes\AppData\Local\Temp\localforge-chat-memory-coverage-76c83dc9-4d4b-4412-bc11-a82812cd1b8a`. This is execution/structural coverage, not complete semantic/manual proof.
- The repeated 1,200-message measurement in this fresh run was **1,140.2 ms**, with bounded output and an event-loop yield. Broader activation/index/storage/rendered performance gates remain pending.
- `node tests/runChatRestartTests.js --chat-memory`: final runtime **two-process native acceptance passed**, exit 0; `%TEMP%\localforge-chat-memory-final-native.log`. This includes the refined chunking/deduplication, validated provenance and typed workspace context.
- `node tests/runChatRestartTests.js --live-memory`: final runtime actual Ollama acceptance passed, exit 0; `%TEMP%\localforge-chat-memory-final-live.log`. Response again: **“The internal test codename I gave earlier was ORBITAL-MANGO-91734.”** Exact supporting message `cadc29e0-7402-429d-9f15-eed92d869763` was retrieved/injected and visible in `/context`; recent-only context lacked the fact and private B was excluded.
- `vsce package --out <unique temporary path>` plus `node scripts/verify-marketplace-package.cjs <same path>`: exit 0; `%TEMP%\localforge-chat-memory-final-package.log`. Actual temporary artifact: `C:\Users\ganes\AppData\Local\Temp\localforge-chat-memory-check-0308383c-a0c0-4236-a698-fd230da0bdfa.vsix`, **3,374,034 bytes**, version **0.2.24**. Runtime/icon byte hashes and current manifest contributions match; development material is excluded. No user release file was overwritten, and nothing was installed/published. The verifier's misleading default-name output label was corrected to print the actual supplied path; extraction/hash checks already used the correct path.
- `git diff --check`: exit 0. No staged changes, commit, push or version bump.

Native VS Code logs also contain bundled agent authentication/proposal warnings and periods reported as Extension Host unresponsive/responsive. The tests ultimately exited 0, but those logs do not establish clean rendered UI/console behavior or a performance release signoff. The previously intermittent busy-state finding is not declared repaired by these unrelated passing memory cases.

Next independent implementation work remains the reconfirmed workspace-index lifecycle: production never calls `startWatching`, reindex retains deleted entries, skipped binary/oversized changes can leave stale prior text, watcher callbacks have no coalescing/awaited drain and there are no versioned chunk/status semantics yet. Then proceed through all remaining original phases/gates; do not shrink completion to chat memory alone.

## 2026-10-03 — user-requested 0.2.25 installation and pause

The user explicitly requested installing the latest current repair as **0.2.25** and stopping until they ask to continue. Only manifest/lockfile version metadata was changed; no further feature implementation was undertaken. The full mission remains unfinished, not completed or release-certified.

- `package.json` and both root version fields in `package-lock.json` now agree on `0.2.25`; dependencies were not changed.
- `npm run build`: exit 0; `%TEMP%\localforge-install-0.2.25-build.log`.
- `npm run package`: exit 0, including actual payload/manifest/icon/runtime-hash verification; `%TEMP%\localforge-install-0.2.25-package.log`. New local installer: `C:\Users\ganes\OneDrive\Desktop\LocalForge\localforge-vscode-0.2.25.vsix`. An existing 0.2.25 file was checked for and not overwritten.
- Normal installed VS Code CLI reports **1.139.1 x64**. Before installation it listed `paladuguganeshnaidu.localforge-vscode@0.2.24`.
- `code.cmd --install-extension <0.2.25 VSIX> --force`: exit 0, successfully installed; `%TEMP%\localforge-install-0.2.25-install.log`. Subsequent normal CLI listing reports **`paladuguganeshnaidu.localforge-vscode@0.2.25`**.
- On-disk installed manifest version/publisher and SHA-256 equality of installed runtime/icon against the current build were asserted successfully. Actual installed folder: `C:\Users\ganes\.vscode\extensions\paladuguganeshnaidu.localforge-vscode-0.2.25`.
- `git diff --check`: exit 0. No commit, push or Marketplace publication. No new full test/manual acceptance claim accompanies this version-only installation; the earlier 271-test and live/native checkpoints remain historical evidence for the current repair code.

The user should reload/reopen their normal VS Code to load the installed update. Existing editor windows were not forcibly closed or reloaded, preserving unsaved work. All remaining original requirements are retained for resumption; work is paused at the user's request.

## 2026-10-03 — targeted repair of reported edit/approval/save failure

The user supplied an actual failed `agent-edit-test.md` run. This is a scoped response to that bug report, not resumption or completion of the broader paused mission. The transcript proves an attempted editor modification and a save failure, followed by repeated reads; it does not prove a saved, correct, approved edit. The model also copied task instructions into the file text. The exact cause of the user's save failure cannot be inferred from that transcript (permissions, file locks and save-provider errors remain possibilities, not diagnoses).

- Added conservative request-level constraints from the actual user prompt, not retrieved workspace/chat context. Recognized requests to show a proposed change for approval override Always proceed for the turn; requests to stop if a target exists are enforced by the shared edit engine, including the alternate write/create tools. Explicit single-file restrictions reject proposals for other paths. Restricted turns do not offer terminal tools. The constraints are cleared in `finally`, so subsequent approval can apply the stored proposal. These safeguards are not a general natural-language parser or an OS sandbox.
- Actual production-turn proposals now inherit conversation/turn identity. Proposed results finish in waiting-for-approval status, not completed. Added model guidance to separate file contents from task directions, but a small model can still generate incorrect content: the preview remains the point of review, not a guarantee of model obedience.
- Native save failures return structured editor-change, disk-verified-file and recovery information rather than losing it in a generic throw. The whole batch is not described as saved/applied if only some files were verified. Such failures stop automatic tool actions immediately, preserve the dirty buffer and recovery snapshot, and explicitly tell the user to inspect/save manually instead of entering a read/retry loop. Known read-only providers/files are rejected before native edit submission. There is no direct-write fallback that bypasses editor/save errors.
- Reused successful tool results now include explicit instructions to finish the answer rather than repeatedly requesting the same evidence. The existing bounded repetition guard remains in place.
- `npm test`: exit 0, **281 passed, zero failed/cancelled/skipped**; `%TEMP%\localforge-edit-approval-full-tests.log`. Ten new regressions cover the reported request, auto-mode preview, creation-only refusal, alternate tool bypass, scope reset, dirty-save preservation, partial-save reporting, read-only preflight, file-appears-before-approval and repeated-read feedback. The first focused run exposed a missing test-mock FileSystemError class; that fixture was corrected without weakening assertions. Focused rerun passed all 36 then-selected checks; the full run includes the subsequent ten-case final regression file.
- `npm run test:extension-host`: build and native tests exit 0, **13 stages passed**; `%TEMP%\localforge-edit-approval-native.log`. Added a real VS Code stage executing the normal engine with Always proceed: verified that the target is absent before review, a real proposal belongs to the chat/turn, explicitly accepting saves the exact expected bytes, and rerunning against an existing file stops immediately without overwrite or reread. This uses a controlled model and programmatic approval decision in an isolated temporary workspace/profile, not a new live-model or rendered-button-click acceptance claim. Existing native activation, commands, IPC, File scope and Models checks also passed. Diagnostics/doctor produced transient extension-host unresponsive/responsive messages; no broad performance certification is asserted.
- Version remains **0.2.25**. The previously installed user's extension and original 0.2.25 VSIX are intentionally preserved; this source/build repair is not installed, committed, pushed or published automatically. The user's actual affected document was not edited, saved or discarded by this task. The broader mission remains paused.
- Separate repair installer generated successfully: `C:\Users\ganes\OneDrive\Desktop\LocalForge\localforge-vscode-0.2.25-edit-fix.vsix`, 3,376,313 bytes. `vsce package --out <repair path>` (including prepublish TypeScript/bundle build), the payload/identity/runtime/icon verifier and `git diff --check` all exited 0; `%TEMP%\localforge-edit-approval-package.log`. The original installed snapshot was not overwritten. Packaging is not Marketplace publication or full production certification.

## 2026-10-03 continuation — live workspace retrieval and reported edit acceptance

The active goal was checked and its complete objective reread before continuing. The older user-requested pause above is historical; this is implementation progress toward the active full objective, not a completion claim. The preceding targeted edit repair also constituted progress: it changed production safety behavior and passed 281 unit checks plus 13 native stages. Branch remains `main`, starting HEAD `797cf4811dadef15d815edfa083e3fe9bf08195a`, version **0.2.25**, with existing unstaged/untracked work preserved and no commit/push.

### Baseline and reproduced index defects

- `npm ci --offline`: exit 0, 326 packages added / 327 audited; `%TEMP%\localforge-index-baseline-install.log`. Cached dependencies were sufficient. Deprecated-package and pending optional-install-script warnings were retained. Offline output saying zero vulnerabilities does not supersede the earlier fresh-online six-high-advisory evidence; no new online audit/remediation certification is claimed.
- `npm run build`: exit 0; `%TEMP%\localforge-index-baseline-build.log`. Production initialization previously never called `startWatching`; rebuild retained deleted entries, and binary/oversized conversions could preserve old cached text. There was no awaited/coalesced lifecycle, atomic full snapshot or versioned chunk status.
- Added explicit bundled runtime dependencies `ignore@7.0.10` and `minimatch@10.2.6`, from the available local cache. `npm install --offline --ignore-scripts --no-audit`: exit 0; lockfile updated, `%TEMP%\localforge-index-dependencies.log`. These dependencies are bundled; development `node_modules` is excluded from the VSIX.

### Actual production changes

- `WorkspaceIndexer` owns serialized atomic rebuilds, shared concurrent scans, cancellation, create/change/delete watchers, rename reconciliation, 120 ms coalescing, awaited drains, configuration/folder/trust rebuilds, explicit disposal and post-edit/rollback notifications. Missing/excluded/binary/oversized/invalid-UTF-8 files invalidate their cached text. Late disposed operations cannot repopulate the index or change disposed status.
- `WorkspaceIndexRules` applies root/nested `.gitignore`/`.ignore`, configured file/search exclusions and simple sibling conditions. Shared secret/path/junction guards and hard generated/binary/packaging exclusions precede negation. Rule files and candidate discovery are bounded. Unsupported/unreadable/excessively expanded rules produce an explicit index error rather than silently admitting excluded files.
- The lexical retriever now uses bounded, non-overlapping chunks with normalized path, line range, stable chunk ID, file SHA-256, mtime and language metadata. It ranks actual query matches, diversifies files, deduplicates excerpts, yields to the event loop and checks selected source bytes again before returning or attaching them. An irrelevant active editor no longer produces a fabricated positive match. It is not semantic/hybrid retrieval or exhaustive repository coverage.
- Workspace `/search <query>` runs deterministically with no provider invocation and displays excerpts/ranges/scores/chunk/hash/truncation. `/search chat` remains distinct. Actual model context and `/context` retain workspace chunk identity. File scope blocks workspace search, drawer rebuild and command-palette rebuild. Rebuild cancellation is exposed by the command-palette progress UI.
- Settings/status events show real files/chunks/time/state/errors/partial coverage. New validated workspace-scoped limits default to 2,000 files, 262,144 bytes per file and 8,000,000 characters. Candidate discovery is separately capped. Doctor reports partial, unwatched, rebuilding and failed indexes as warnings/errors, not healthy.

### Failures found and corrected without weakening tests

1. The first lifecycle run found that a late `indexFile` completion overwrote disposed state with ready. Added a production post-await disposal check; the existing assertion now passes.
2. Initial full suite: **293 tests, 291 passed, two failed**, `%TEMP%\localforge-index-full-tests.log`. The Doctor test's stale two-field mock omitted the new actual status fields; its fixture was updated to ready/watching/complete, preserving the green assertion and adding partial/unwatched/rebuilding/error regressions.
3. The second failure proved `minimatch` silently truncates brace expansion instead of throwing. Production now expands only up to 129 alternatives and rejects more than 128 per pattern / 4,000 total, avoiding both unsafe silent truncation and unlimited expansion. Tests preserve the rejection assertion, verify the previous snapshot survives and confirm exactly 128 alternatives are accepted.
4. Review found a remaining File-scope bypass through the VS Code reindex command despite the drawer guard. The command now enforces the same restriction; native acceptance explicitly calls both entry points.

### Evidence obtained in this continuation

- Focused compile/index/Doctor regression: exit 0, **15 passed**; `%TEMP%\localforge-index-focused-final.log`.
- Final `NODE_V8_COVERAGE=<fresh temp directory> npm test`: exit 0, **294 passed, 0 failed/cancelled/skipped**, 12.35 s; `%TEMP%\localforge-index-release-check-unit.log`. The synthetic 1,200-file index-plus-query fixture measured **321.3 ms**, with an event-loop yield and bounded traceable result. This is one memory-filesystem measurement, not a real large-repository performance certification.
- `node scripts/collect-source-coverage.cjs <coverage directory>` enumerated **74 production TypeScript files / 57 JavaScript tests/runners**; named functions executed in **66 production modules**. Current source-level ledgers are `scratch/repair-source-coverage.md` / `.json`. Structural/execution coverage is not every branch, feature semantics or rendered UI proof.
- Production TypeScript and bundle build passed before the final scoped command guard; the final release-check build/native/package results are recorded in the next subsection after completion.
- `node tests/runExtensionHostTests.js`: pre-command-guard final build passed **14 native stages**, exit 0; `%TEMP%\localforge-index-final-native.log`. The new real filesystem stage covers create/query → modify/new hash/old query absent → rename with spaces → delete/query absent, ignored/binary/oversized files, actual accepted edit/rollback invalidation, source metadata, real status IPC and File scope. The provider throws if deterministic search tries to call it. Final command-guard rerun is recorded below.
- `node tests/runChatRestartTests.js --live-edit`: exit 0; `%TEMP%\localforge-edit-live-normal-engine-final.log`. Actual local Ollama **qwen2.5-coder:1.5b**, normal Agent chat handler, Always proceed configured: a clarified prompt with explicitly quoted exact file text produced one chat-owned pending proposal containing exactly `# Agent Edit Test\nLOMVREN successfully created this file.\n`. The file was absent before approval. Explicit native acceptance saved exact bytes. Repeating the same request against the existing file produced no new proposal and left bytes unchanged. No model response or tool call was mocked; acceptance was programmatic, not a rendered click. This does not prove every ambiguous prompt or small-model output is correct, or reproduce the user's exact OneDrive save-provider failure.
- `node tests/runChatRestartTests.js --chat-memory`: exit 0; **two native processes passed**, `%TEMP%\localforge-index-memory-final-native.log`. Older source retrieval, source inspector, restart, declined/accepted all-chat opt-in, actual Workspace configuration target, source deletion and chat clear remain working with the new index lifecycle.
- `node tests/runRecoveryRestartTests.js`: exit 0; **two native processes passed**, `%TEMP%\localforge-index-recovery-final-native.log`. Exact original bytes, binary deletion/move, new-file diff, synchronized editor contents and rollback timeline survived restart.

These native tests use actual VS Code 1.140.0 APIs in disposable profiles/workspaces, with an IPC bridge instead of mouse clicks. The live edit case uses real local inference; deterministic restart/search cases use controlled model or permission decisions. Neither is a rendered UI signoff. No SSH server credentials, publisher account or user project file was accessed or changed by those fixtures. Bundled VS Code agent authentication/proposal/deprecation messages remain in logs and are not hidden.

### Final-state build, package and rendered-test boundary

- `npm run build`: exit 0, final scoped command guard included; `%TEMP%\localforge-index-release-check-build.log`. TypeScript and 1.4 MiB production bundle passed.
- `node tests/runExtensionHostTests.js`: exit 0, **all 14 native stages passed**, including the command-palette and drawer reindex File-scope denial; `%TEMP%\localforge-index-release-check-native.log`. This supersedes the preceding native caveat, not the full rendered UI gate.
- `vsce package --out <unique temporary path>` and `node scripts/verify-marketplace-package.cjs <same path>`: exit 0; `%TEMP%\localforge-index-release-check-package.log`. Verified metadata, manifest contributions, icon, actual runtime/icon byte equality and development payload exclusions. Temporary package: `C:\Users\ganes\AppData\Local\Temp\localforge-index-edit-check-f327af23-2746-43a2-8b1e-a7fb29ff82dd.vsix`.
- Preserved a byte-identical copy under a new non-overwriting filename: **`C:\Users\ganes\OneDrive\Desktop\LocalForge\localforge-vscode-0.2.25-edit-index-fix.vsix`**, **3,406,835 bytes**. Earlier original 0.2.25 and edit-only VSIX files remain untouched. Nothing installed/published/committed/pushed; no release-certification claim follows from packaging.
- `git diff --check`: exit 0. Working tree has 49 changed/untracked entries, no staged changes. Windows line-ending normalization warnings are recorded, not treated as source errors.
- Actual rendered UI capture attempted in owned disposable fixture `C:\Users\ganes\AppData\Local\Temp\localforge-index-ui-final-57db5c5d-11c3-4498-807d-6b67c41c27b7\LOMVREN-Index-UI`. Native helper freshly enumerated its unique `[Extension Development Host] LOMVREN-Index-UI - Visual Studio Code` window, ID **1706792**. Both state capture and the one freshly reselected/native-handle recovery failed: **`window id 1706792 no longer belongs to Microsoft.VisualStudioCode; current owner is Microsoft.VisualStudioCode`**. No screenshot, clicking, typing, account/permission action or UI deletion occurred. An earlier non-unique generic fixture selection was abandoned rather than guessing a target. The disposable profiles/windows were left separate from the user's normal editor; this external helper identity failure blocks rendered verification, not independent development. Do not label rendered UI acceptance passed.

### Still required before complete mission/release certification

Rendered end-user acceptance, release-wide scale measurements, all settings/endpoints, canonical tool policy and dynamic N²/N³ matrices, project-command/process security, selectable structured multi-agent/conflicts/checkpoints/resume, genuine browser automation, local-only autocomplete enforcement, artifacts and feasible extensibility/background capabilities remain unfinished. Optional embeddings are not implemented. The normal installed extension and earlier VSIX snapshots are preserved; this newer source is not automatically installed or published. The user's unsaved reported document is not saved/discarded by this task. The active goal must not be marked complete on these narrower passing checks.

## 2026-10-03 — current reported edit failure: fresh repair verification

This turn addresses the user's pasted approval/save/repeated-read failure only. The broader goal was checked and is paused; it was not resumed or marked complete. Existing uncommitted source changes and earlier installers were preserved.

- The normal installed 0.2.25 bundle still contains the old `could not be saved` failure and lacks the new request-review error. Its SHA-256 is `965B896511D5A85127C02ABFCDB5F1837801B20705A1D007F9265C662082BBA2`; the current repaired bundle is `51ABCC891B4D285EEFCF14CA45B3EDA17D800CD6044DB4789F25CAE232C8E8CE`. Matching version labels do not establish matching runtime code.
- Existing source repairs enforce preview-only requests even in Always proceed, refuse existing targets for creation-only tasks, preserve dirty buffers and recovery evidence after failed saves, and halt automatic actions instead of rereading indefinitely. A later read is not proof of a saved file. Small-model content generation is not guaranteed: the actual local-model acceptance uses explicitly quoted exact file text, not the ambiguous single-line prompt from the report.
- Corrected stale unit fixtures to use the actual ModelRouter result and a real-shaped disposable subscription list. The first native run exposed a stale `getConfiguration` snapshot in the endpoint test; assertions now acquire fresh configuration after updates and retain their original expected values. No test was skipped or acceptance assertion relaxed. Rejected webview messages no longer log their payload, which can contain accidentally entered credentials.
- Final `npm test`: exit 0, **301 passed, zero failed/cancelled/skipped**. Log: `%TEMP%\localforge-reported-edit-full-final.log`. Focused approval/save/cancellation/chat checks: **29 passed**; `%TEMP%\localforge-reported-edit-focused-current.log`.
- Final `npm run test:extension-host`: TypeScript and production bundle build plus **all 15 native stages passed**, exit 0; `%TEMP%\localforge-reported-edit-native-current-retest.log`. The approval stage verifies no pre-approval file, exact approved disk bytes and no overwrite/retry on an existing target. The first failed run remains at `%TEMP%\localforge-reported-edit-native-current.log`.
- `node tests/runChatRestartTests.js --live-edit`: exit 0 using actual local Ollama `qwen2.5-coder:1.5b` and the normal Agent chat handler. Verified exact pending preview, target absent before approval, explicit acceptance with exact saved bytes, and refusal to overwrite on repetition. Log: `%TEMP%\localforge-reported-edit-live-current.log`. These tests use real VS Code in isolated temporary profiles/workspaces and programmatic approval, not rendered-button clicks. They do not reproduce the user's exact OneDrive/save-provider failure or certify all model outputs.
- Separate non-overwriting installer: `C:\Users\ganes\OneDrive\Desktop\LocalForge\localforge-vscode-0.2.25-approval-verified.vsix`, **3,409,690 bytes**, SHA-256 `E38B3F0DE89B6A77AA550AB6EF6A9F8555356C885106E8A6867EF67A2268D09F`. Packaging and identity/current-runtime/icon/contribution/payload checks passed; `%TEMP%\localforge-reported-edit-package-current.log`. `git diff --check` passed with line-ending warnings. This is a verified targeted repair artifact, not full production or Marketplace certification.
- Nothing installed, committed, pushed or published. The user's reported file and unsaved editor documents were not modified, saved or discarded. Normal VS Code and the older installed bundle remain unchanged until a new installation is authorized.
