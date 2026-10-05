# Torii agent test comparison

## Latest real GPU comparison — 2026-10-05

Fresh second minimal-site run passed actual server, metadata/favicon rendering, navigation, responsive 375/768/1440, accessibility basics, button interaction and zero console/network errors, with owned cleanup. Evidence: `final-032-favicon-website-20261005/result.json`. The earlier missing-favicon failure remains preserved. Local 1.0.0 candidate contains the same tested runtime; 439 regressions, 16 native stages, exact installed hash and visible installed webview passed. Full-site/3D acceptance is still separate. Native fixture directory cleanup encountered EPERM and retained its temporary profile; do not count this as successful cleanup.

| Test | Before | After |
|---|---|---|
| Node CLI | Only one test file counted, then initial generated tests failed | Reasoning-enabled agent repaired code; seven registered tests and independent argument checks passed |
| CSV | Undefined variable, patch mismatch, total misinterpreted as row count | Full-replacement readback recovery and explicit exact-output instructions; fresh exact CSV/JSON and independent rerun passed |
| Minimal website | Actual server, interaction and responsive QA passed, but omitted required favicon; completion falsely claimed | Missing requested favicon now blocks completion; fresh identical-prompt test evidence remains separate |
| Local extension | Earlier package checks alone | Latest 0.3.2: 439 regressions, 16 real VS Code stages, packaged/installed runtime hashes match |

Version 1.0.0 is a user-requested local candidate, not a production certification. Full NexusFlow/3D, 100 independent tools and larger-model acceptance remain open; publishing/push require confirmation. Historical failures are not overwritten.

## 0.3.2 follow-up — 2026-10-05

Final 0.3.2 VSIX is installed and exact source/runtime hashes match. All 16 latest native stages passed. The complete release helper now packages and installs successfully after correcting real VS Code's versioned CLI layout. Exact artifacts/logs are in AGENT-TEST-REPORT.md. This is a local verified package, not GPU/site completion or Marketplace publication.

- Prior 0.3.2: 432 regression passes, 16 native stages and actual rendered chat UI passed. The live new-studio model returned READY with full GPU residency, but its fresh minimal-site driver failed and left empty JSON evidence: not website acceptance.
- Current repair: task-specific general tool priorities replace browser/npm bias on non-web tasks; atomic serialized benchmark snapshots preserve previous evidence through failure and permit recovery. The original host-exit cause is not established.
- Release helper accepts a validated version/output plus optional install/publish; it runs regressions and exact packaging checks, refuses preserved artifacts and requires interactive confirmation for Marketplace publishing. It does not certify real model tasks or automatically commit/push.
- Full GPU retesting, original full-site repeat acceptance and the 100-independent-tools requirement remain open. Larger model size does not constitute verification.

## Current GPU and approval comparison — 2026-10-04

| Earlier evidence | Current result | Limitation |
|---|---|---|
| Session approval remembered only the same arguments | New ordinary command and actual saved file work under one workspace/chat grant; native IPC and all three Chrome buttons pass | Protected actions still ask; shell is not OS-sandboxed; original human instance not directly reproduced |
| Failed Node repair lost its concrete diagnostic in completion feedback | Qwen3.5 9B fresh task repaired failures and passed six actual Node tests plus independent checks | Small Node acceptance is not full website acceptance |
| Whole reply wrapped in a Markdown fence | Headings/lists render normally while embedded code/HTML stays escaped | Tested rendered fixtures are not real model design quality |
| GPU context only measured at 8192 | Actual 32768-context readiness and full VRAM residency confirmed | Do not allocate the advertised model maximum blindly |
| Full NexusFlow/3D first run | Failed build/server/browser acceptance; only project preparation exists | No successful full second run yet |
| Linux mkdir and unrecovered preparation error on Windows | Real shell guidance, portable directory tool offered, fresh exact directory evidence recovery tested | New runtime still needs installation and clean full retest |
| No user-facing effort budget selector | Low/Medium/High/Ultra affects actual budgets, persists by chat and passes responsive/busy-state checks | Finite response/context/hardware; no infinite single-response promise |
| 42 legacy tool names | 44 registered executable names with specialists and fixed temporary workflows | Overlap/recipes are not 100 independent tools |

Latest source: 424 regressions and 16 native stages passed; rendered effort UI passed. Installed session-tools artifact, preserved checkpoint, exact hashes, failed logs, root causes and remaining 1.0.0 gates are recorded in `AGENT-TEST-REPORT.md`. Earlier comparisons remain historical. No complete release certification is claimed.

## Latest graduated comparison — 2026-10-04

Installed `localforge-vscode-0.2.25-ui-load-recovery.vsix`; built/installed bundle `8F660BA91D81836A8878DC159386652C54872C656442292E08C75C2839F92825`. Full regression: 397 passed. Actual UI/load fixture passed after repairing a Chromium-blocked preview port. Details and remaining failures: `AGENT-TEST-REPORT.md`. Older latest sections are historical.

| Before | After | Verified scope |
|---|---|---|
| Every token rebuilt file picker; selection lost focus | Stable nodes, busy-state-only availability, batched Markdown | 1000 files/500 tokens/100 activities; zero picker churn, all tokens retained, no errors/overflow |
| Popovers stacked; cancellation unlocked early | Exclusive/dismissible popovers and acknowledgement-based locking | Real rendered interaction/focus regression passed |
| "No website" turned file creation into website work | Negative requirements excluded; explicit newline omissions rejected | Failed local run followed by exact saved-file pass on intermediate runtime, with summary/readback limitations |
| stdout-only test failures looked like just exit code 1 | Actual diagnostics retained in UI and recovery context | ReferenceError visible; not proof the model repairs it |
| Recovery budget remained exhausted after applied repair | Distinct applied edits renew bounded recovery; fresh tests mandatory; explicit rerun reminder | Unit recovery passed; latest actual 14B Node test STILL FAILED |
| No varied latest-runtime positive task result | Real CSV-cleaning prompt writes source and executes it through agent tools | Exact outputs and deterministic independent rerun passed on SSH GPU |
| Running server/render could be mistaken for complete verification | Actual click/mobile evidence remains mandatory | Tiny site passed independent real browser QA, but agent skipped those checks; overall turn remains failed |

The local file and GPU CSV passes do not substitute for the full original website/3D goal. 42 names are not 100 independent tools. Ended graduated tests cleaned up owned servers/tunnels; no unrelated project, remote daemon or models were deleted.

An explicit Qwen3 4B/16384-context comparison did not rescue the Node benchmark: after one saved file it silently generated over 14,000 tokens/context shifts at 96% GPU without finishing its next tool response. It was deliberately cancelled, not recorded as slow success. The subsequent micro-site comparison was also cancelled rather than repeat that behavior. Both driver results were failures; owned cleanup passed. Actual pinned-host inspection then showed 0% GPU and all inference slots idle. Model/runtime-dependent autonomous reliability remains a release blocker, even with 397 passing regression tests.

Final native installed-UI check: `chat-ui-load-installed-20261004/result.json` confirms the exact 8F660BA9 runtime, actual webview ready message and visible chat in VS Code 1.140.0. The UI-only window remains open for inspection, unless the user closes it; this is startup/UI evidence, not a model or full website pass.

## Latest dependency recovery comparison — 2026-10-04

Installed `localforge-vscode-0.2.25-dependency-recovery.vsix`; built/installed bundle `27A71FB6E32BD35131598A12030B0736044F99980AC9740D844529CE9B0CAC72`. 386 full regressions, rendered UI checks and the real installed-extension controlled dependency/build/process/browser fixture passed. Earlier failing logs remain evidence: mock compatibility was fixed; an intermittent Windows taskkill 255 was recorded and diagnostics improved, but its root cause is not proven.

| Previous failure | Implemented recovery | Verified scope |
|---|---|---|
| npx/webpack waited for a missing CLI installation prompt | Closed stdin, noninteractive npm policy, actionable prompt stop, registered install_packages | Real terminal fixtures, native approved npm install and require/use |
| Production manifest omitted its requested build | Early repairable error, with explicit no-build exclusions preserved | Manifest and agent-loop regressions |
| Consecutive process inspections reused stale results | Process/browser inspections run afresh | Five actual handler executions through the loop |
| Alternate successful build left obsolete build failure unresolved | Equivalent build errors resolve after a successful declared build; unrelated errors remain | Recovery and audit-trail regressions |
| A background process was labelled Ran without readiness proof | Started process; check readiness | Updated actual activity handling; running website acceptance still separate |

This is a verified installation/recovery improvement, not a passed second full website benchmark or complete commercial-agent parity. Native executable-name count is 42, not 100 meaningful tools. The earlier GPU website failure remains failed; the broad website/ML/document/subagent goal remains active.

## Historical composer-first interface comparison — 2026-10-04

Installed `localforge-vscode-0.2.25-composer-ui.vsix`; built/installed bundle `1D03465FD8A205EE137E93CBCE94AE2A5B5806248701A44FAEE84CF5C26E0182`. 379 regressions, actual rendered browser controls/responsive checks and native installed webview startup/visibility passed. See the latest report for exact evidence and limits.

| Previous interface | Current interface | Verification |
|---|---|---|
| Model selector and modes stacked above chat | Native model and Agent/Ask/Plan selects inside bottom composer | Actual rendered structural assertions and installed HTML |
| Access, strategy and context bars permanently occupy conversation space | Access/strategy in Settings; context files/shortcuts in a popover | Five widths, dropdown messages, scope/control regressions |
| Branding card and repeated full-width bars | Quiet empty state, compact chat/history header, one rounded composer | Empty/conversation screenshots; no horizontal overflow |
| Unclear whether old installed UI remained loaded | Fresh VS Code window uses matching installed bundle and real webview ready | Native installed startup result, visible view retained |

This comparison verifies an interface change, not parity with commercial agents or a successful website benchmark. The preceding 3D website run terminated failed, not active. Remaining production agent recovery/website acceptance is unchanged. Older sections below are historical.

## Historical UI/runtime comparison — 2026-10-04

Latest installed package is `localforge-vscode-0.2.25-clean-ui-gpu-runtime.vsix`; built/installed bundle SHA-256 `63747E6F195034B1C3FE087EDD495A5C61D0A863126B7753B4767720D4B32711`. 379 regressions and real Chrome responsive/control checks passed. See the latest report for artifact hashes and exact evidence. Historical sections below describe older builds.

| Before | Root cause / repair | Verification |
|---|---|---|
| Crowded chat, inaccessible custom model modal, misleading Auto/Local badge | Single theme stylesheet, native dropdown, accessible mode toggles | Actual HTML in Chrome at five widths and light theme |
| No usable file-selection dropdown; spaces unrecognized | Bounded explicit file payload, scope/sensitive/symlink validation and quoted references | Real payload and filesystem-boundary regressions |
| Downloads always routed locally | Explicit reachable host routing, confirmation, pinned pause/resume, no fallback | Controlled host tests and actual nine-update remote existing-model pull |
| Model Center passed syntax test but failed in browser | Literal NUL changed by HTML parser into invalid regex range | NUL regression and actual browser install/pause/resume UI checks |
| Cancelled remote generation kept GPU busy | Forwarded channel/socket close propagation missing | Controlled real SSH stream close; actual GPU idle after owned-runtime recovery |
| Graceful EOF after abort looked successful | Stream cancellation checks/reader cleanup missing | New graceful-close regression; rebuilt native preflight repeat pending |
| Model smoke timeout looked like pending evidence | Setup outside persistence/cleanup | Terminal errors now persisted and setup fails native test |
| Placeholder build claimed completion | Echo-only generated build manifest | Rejected before write for build/production requests; actual build remains mandatory |

Full Qwen3 website run: cancelled/incomplete, package.json only. Progress-instrumented repeat: model smoke timeout before task, exit 1. Two 3D preflights passed remote pull but failed an assertion that assumed 50 characters before abort; neither executed the site task. The corrected **`nexusflow-3d-ui-gpu-first-token-20261004`** passed actual remote pull, cancellation after one visible character and an exact connectivity reply. It then created a placeholder HTML scaffold and incomplete manifest, installed dependencies, and repeated interactive webpack-cli installation failures. It terminated **failed** at `2026-10-04T11:08:59.875Z`, with owned process cleanup passing. No working production build, rendered 3D scene or full browser acceptance was obtained. Earlier minimal follow-up was not a fresh full build or controlled same-model comparison. Remaining broad production acceptance is unchanged.

## Authoritative installed verification-only repair

Latest artifact `localforge-vscode-0.2.25-verification-only.vsix`, VSIX hash `E2FA339D41988031D3E417E7162A2E0EAFB594F31CA05F19458F126392D75C9B`, built/installed bundle `211463C216D0CCF0DDF13200B44440B21FAAA3C0FC79D7DD43934E77924D20F1`. Build, package verification and install passed; full suite **369 passed**, no failures/cancellations/skips. Initial focused negated-conjunction regression was repaired before this passing suite. Existing creation/source/evidence requirements were retained, not removed to certify failed builds. Older latest/pending statements are historical.

### Real focused verification comparison

Both runs used this exact installed bundle and corrected verification-only prompt against the same model-created/model-repaired index.html, with source edits prohibited. The second run deliberately changed model; this is **not** a clean creation repeat or controlled same-model benchmark.

| Check | torii-micro-gpu-verify-fixed-20261004 | torii-micro-gpu-verify-qwen3-20261004 |
|---|---|---|
| Actual selected SSH model | Qwen2.5 Coder 14B | Qwen3 4B Instruct, explicit change |
| Native streaming/SSH/model execution | Passed | Passed |
| Effective remote context / GPU proof | 8192 / actual GPU loading | 8192 / size_vram = size = 3,873,366,343 bytes |
| Actual server and opaque process status | Passed | Passed |
| Real button visible change | Missing | Passed, Demo started |
| Actual mobile and desktop tool verification | Mobile only | Both passed; mobile completed after evidence correction |
| Tool failures | No unknown-ID dispatch error; omitted required actions | One Invalid URL from malformed model input, then successful recovery |
| Independent browser acceptance | Not accepted because native focused gate failed | All nine minimal checks passed; 375/768/1440 no overflow, no console/network failures |
| Final agent status / duration | FAILED / 21224 ms | COMPLETED / 25677 ms |
| Website source changes | None | None; unchanged SHA-256 2B8526C4F137B59116A206E5C66F9EFF984977D710DAFE93B41E0D5E49B8F7BC |
| Owned server lifecycle | Awaited cleanup passed | Intentionally retained verified preview, maximum two hours from 09:45:17.617Z |
| Fresh/full production website acceptance | Not tested | Not tested |

The current preview is **http://127.0.0.1:8080/**. In-app browser inspection and an actual Try demo click independently confirmed the status change. Qwen3 corrected its malformed URL and missing mobile evidence, but did not follow the exact requested check order. This is a useful existing-site execution/recovery success, not evidence that every model can autonomously build any project. Failed clean runs and model behavior remain below. Registered inventory remains 41 names with aliases/overlap, not 100 independent tools. Full-site, ML/Office, subagent, normal sidebar and GPT-model acceptance remain outstanding. Complete records and screenshots are under `C:\Users\ganes\Documents\Codex\NexusFlow-agent-tests\torii-micro-gpu-verify-qwen3-20261004`.

## Latest installed cleanup follow-up

Third clean same-prompt GPU run: real website startup/rendering recovered, zero dispatch errors, only index.html, and actual 8192-context GPU inference. The model repaired main; independent post-edit runtime/browser/button/responsive/metadata/favicon/navigation checks all passed. Autonomous status still **FAILED** (66942 ms) because fresh post-edit verification was not performed. Native awaited cleanup passed and OS listener absence was checked after exit. This is not successful autonomous or full-site acceptance.

Focused existing-site follow-up: **FAILED** (30779 ms), no source edits, mobile rendering/startup performed, unknown opaque process ID and missing actual button/desktop results. Harness assertions rejected acceptance. It additionally exposed a false source-write requirement triggered by the negated phrase "not a new website build". That completion classification and the ambiguous process-ID schema are being repaired/tested separately. Existing-site verification is not counted as a clean website creation repeat. The latest installed cleanup artifact does not contain these subsequent source changes yet.

Artifact `localforge-vscode-0.2.25-owned-cleanup.vsix`, SHA-256 `A43038648893F935756B6764D717728BB539DC375040B66DF0D7A13BFCB758F3`; built/installed bundle `C51162D8E19F798A0993850CE0BA089081CED7630CE66AEAA9F664186B40BBEC`. Build, package checks and local installation passed. **367 tests passed**, no failures/cancellations/skips (`owned-cleanup-full-retry.log`). The preceding full-suite attempt exposed stale-snapshot polling in the new fixture; that test defect was corrected without weakening owned-tree/unrelated-listener assertions. Third clean same-prompt GPU run `torii-micro-gpu-cleanup-20261004` is pending. Earlier package/source-pending statements below are historical. First/second prompt hashes match `EE0B8D0753C8DC8A78867621C567311DF8BDDC87F98A433ABA2B1DC19C07E8BE`; no operator-written website source or manual webpage repairs are used.

## Authoritative GPU comparison, 2026-10-04

Second-run actual result supersedes its Pending cells below: exact latest installed bundle, native remote stream and GPU context **8192** passed; only index.html was created, one Python command was started, and its process was inspected. Final agent status **FAILED**, 58485 ms, due to repeated rendered ERR_EMPTY_RESPONSE; no actual browser interaction acceptance. The same micro prompt/model was used. Real OS inspection found leaked old/new owned Python descendants sharing port 8080; PID, recorded parent, command and creation times were verified before targeted cleanup. The earlier harness shutdown did not await process-tree completion. Source now awaits bounded owned-tree cleanup and records its outcome. A real descendant-listener regression passed without killing a separate unrelated fixture listener. Packaging/full regression and the third clean GPU repeat of this subsequent cleanup repair are pending. No full-site or production acceptance is inferred from the source files or configuration success.

Newest artifact: `localforge-vscode-0.2.25-remote-context.vsix`, VSIX SHA-256 `3869588AB58672CAED9A1024F96216EA6CA2FE4FB7076475A1E6BCE31B703823`, built/installed bundle `5B09AE8A7E2E3F74B29315CEA04CD704D8DB8EE23F45E5CD455894EF638214AA`. Full regression **366 passed**, no failures/cancellations/skips; package payload and local installation passed. Older latest/running/pending statements below are historical snapshots.

| Check | First clean GPU micro run | Second clean GPU micro run |
|---|---|---|
| Run label | torii-micro-gpu-20261004 | torii-micro-gpu-context-20261004 |
| Model | Exact canonical SSH Qwen2.5 Coder 14B | Same explicit remote model requested |
| Installed bundle | 6A599F46… | 5B09AE8A… |
| Real extension SSH/discovery/stream | Passed | Pending |
| Actual GPU offload | Confirmed, 4096 effective context | Pending configured 8192 verification |
| Independent runtime/browser | All reduced checks passed | Pending |
| Responsive/button/favicon/navigation | Passed independently | Pending |
| Console/network failures | None in independent page verification | Pending |
| Agent recovery/task result | Failed, 512190 ms | Pending |
| Constraint violations | Extra package files, more than 25 lines, extra server, npm drift | Pending |
| Full production-site acceptance | Not tested by this reduced prompt | Not tested by this reduced prompt |

The first model-authored page genuinely worked, but the agent did not complete its own verification and failed after tool/recovery errors. An initial isolated HTTP fixture regression failed due to a missing HTML MIME header; it was corrected before the full passing suite. Fixes address actual remote generation-option omission, mismatched context/tool budgets, render readiness/URL/dimension handling and misleading refusal wording. They do not assume that prompt guidance or GPU speed guarantees recovery. The second run uses a new empty workspace and identical micro prompt, not manually repaired website source. Tool count remains 41 names with aliases/overlap, not 100 independent operations. Original full-site clean repeat, ML, Office and subagent acceptance remain unfinished.

## Latest reduced-site comparison

GPU follow-up is now user-authorized. Actual pinned SSH authentication and Tesla T4 inference succeeded; no key contents were logged. A separate controlled real SSH test verified the asynchronous host-trust source repair. GPU availability/direct API response and a controlled tunnel fixture are not a full extension/website acceptance. Native GPU runs must load the new packaged source and select the SSH provider's exact canonical model identity, not silently reuse the local model with the same name.

Latest locally installed interaction-evidence package SHA-256 `AF2158BCA92BC29269692958A20B088D050E936A39F3B3665BCE5A8DE427D7A2`; built/installed runtime `1E45C4804E26CF1136B9B78BD3D362144F96404F23401B79B4F571A96F12248F`. Payload verification/installation passed. The reloaded owned-project micro-repair run is separately recorded as `torii-micro-repair-20261004`; it is not a clean workspace run.

Latest source build/regression: **362 passed**, zero failed/cancelled/skipped, `interaction-evidence-full.log`. New regressions verify no-op click evidence, ignored inspect dimensions, actual viewport checks, fresh interaction requirements and tracked-server recognition.

The 1.5B clean experiment failed without starting a server. The subsequent stricter micro prompt produced a genuinely served page with loadable favicon, valid Features anchor, responsive layout and no observed console/network errors, but omitted the button handler and main landmark. Independent checks correctly failed; own inspect calls with dimensions did not resize. That owned run was explicitly stopped for the runtime fixes; it is not success. New targeted repair uses that existing model-authored page, so it is not a second clean run or same-prompt controlled comparison. The operator did not write or fix website source.

Fresh native-readable 4B run: actual file/server/process/browser/button/mobile execution passed, but independent favicon/navigation/main checks failed; responsive desktop/tablet/mobile, metadata and console/network checks passed. Completion rejected those real defects. Slow model recovery did not save a fix before the 90-minute safeguard cancelled it. Full acceptance **FAIL/incomplete**, not success from harness exit 0. Evidence: `torii-minimal-readable-20261004/independent-live-check`.

Next clean reduced test `torii-minimal-cpu-small-20261004` intentionally selects installed `qwen2.5-coder:1.5b` for CPU suitability and uses the same prompt with a 240-minute safeguard. A different model means this is not a controlled same-model second full website benchmark. Its acceptance is pending.

Rebuilt/installed native-readable VSIX SHA-256: `43DDDC57A28D33D352078B6D22D12376A82CEBC816D97947E9F79315AF4C2F47`; built/installed bundle SHA-256: `7FED68C7E0B8692199D954F0AA475DE0D3002AE65E44BB709D3C55994CB7CFFF`. Package payload and installation checks passed. `torii-minimal-readable-20261004` starts with an empty project and repeats the reduced minimal-site prompt through the actual local model. Its real website outcome is pending, not inferred from packaging.

The native-readable source build and full regression passed **361 tests with no failures, cancellation or skips** (`native-readable-full.log`). Actual subsequent local-model behavior remains a separate acceptance criterion.

| Check | Repair C | Repair D |
|---|---|---|
| Clean workspace | No, explicit owned-project resume | No, same owned-project resume |
| Local model | qwen3:4b-instruct | Same exact installed model; connectivity passed |
| Actual server | Loopback Python, HTTP 200 | Loopback Python, HTTP 200 independently confirmed |
| Actual website acceptance | Failed favicon, route, semantic main and mobile width | No successful repair or fresh full acceptance |
| Editing recovery | Wrong relative Features route produced 404 | Only favicon indentation saved; repeated escaped exact-block edits failed |
| Terminal outcome | Explicitly cancelled, 05:28:34.246Z | Explicitly cancelled, 05:59:41.795Z |

D loaded the browser-evidence bundle `9F02B39C53A7C59270E27B5485CAC442A5BB1A7C8D1B8BACFEFC913BFBF0B75F`, with 357 packaged regression tests passed. New source changes expose readable native file evidence without double-decoding intentional escapes and require actual HTTP-successful route verification. These improvements need their own rebuilt/installable artifact and real subsequent model run. No second clean website success, ML/office acceptance, 100 independent tools or universal coding parity is claimed. Historical sections below describe their own snapshots, not current live hosts.

## Local Instruct continuation

These results supplement the historical tiny-model comparison below. Full acceptance is still **NOT PASSED**.

| Check | Instruct run 1 | Instruct run 2 | Prompt-driven follow-up |
|---|---|---|---|
| Directory | `torii-instruct-run-1-20261003` | `torii-instruct-run-2-20261003` | `torii-autonomous-run-3-20261003` |
| Model | Real local `qwen3:4b-instruct` | Same | Same |
| Initial project | Empty | Empty | Empty |
| Prompt | Full Torii requirements | Identical | Identical website requirements |
| Registered names | 40 | 40 | 41 |
| Manifest | Invalid JSON written | Two rejected writes, then valid JSON actually saved | Repeated invalid JSON rejected; no file saved |
| Connection | Generic fetch failure | Confirmed `UND_ERR_HEADERS_TIMEOUT` | Dedicated transport did not time out |
| Website source/build/server/browser | Not produced/verified | Not produced/verified | Not produced/verified |
| Recovery | Failed | Manifest syntax recovery passed; whole task failed | Repetition guard stopped unchanged failures |
| Independent acceptance | FAIL | FAIL | FAIL |

The initial dispatcher-only timeout repair failed inside the real editor and is not hidden. After switching generation to explicitly imported bundled Undici fetch, `native-delayed-headers-20261003` passed inside the actual installed extension after **310,048 ms with no headers**. This verifies transport resilience, not website quality. A separate real local command benchmark passed with one approved execution and a verified model summary. Installed-artifact full suite: **345 passed**; package identity/content verification and installation passed.

The subsequent `typed-json-agent-20261004` run genuinely saved exact JSON but failed whole-turn completion because a negative application reference activated the website gate. The first restricted-file repair also failed in `typed-json-scope-20261004`: the production engine validated the composed access/context envelope rather than the original task. Both failures are retained. The installed `localforge-vscode-0.2.25-original-task.vsix` now keeps task identity separate from inference context. Its 349-test suite and 26 focused checks passed. The real identical-prompt regression `typed-json-original-task-20261004` **passed in 348,222 ms**: exact native saved file, no other changes or commands, no pending proposal, normal final response, no errors. A fresh full website attempt `torii-typed-json-run-4-20261004` is now running. No successful second website or ML/office run is inferred from the narrower regression.

Public task plans are now chosen by the model for the prompt, not a hard-coded domain pipeline. Actual command/edit/browser results remain separate evidence. Status reports real elapsed generation wait and the public plan/latest tool result, rather than fabricating alternating stages. Python projects are no longer forced through npm validation.

The updated goal also requires a trained ML project and representative office/conversion tasks. Their benchmark support/acceptance is separate; no completion of those tasks, new subagent-network proof, SSH GPU proof, automatic administrator access, universal Claude/Codex parity or 100 independent tools is claimed. All older failures remain retained.

## User reduced website scope

`torii-typed-json-run-4-20261004` was cancelled at the user's request after approximately 77 minutes. The actual model had saved the valid manifest, branding, navigation, hero and feature-grid components, but no full build/server/browser proof existed. Files and native recovery evidence were preserved; this is neither a completed website nor an infrastructure timeout failure.

The reduced `torii-minimal-local-20261004` run used the installed original-task runtime and actual local model in a fresh empty workspace. It saved real HTML, launched a tracked Python localhost server, rendered the site and verified the demo button changed its status. It did not finish successfully: browser results revealed malformed favicon quoting, a broken features anchor and no main landmark; it restarted the same command and later ended with a native storage `Canceled` RPC error. No independent acceptance pass is claimed.

The installed follow-up fixes concurrent/identical owned-server reuse and rejects broken navigation/network evidence at completion. All 352 regression tests passed. `torii-minimal-repair-20261004` could not execute because Ollama had stopped: real HTTP connection refused, no daemon and no registered model. This is retained as NOT RUN, not a success. After restarting the existing installed daemon with its existing model store on loopback, `torii-minimal-repair-b-20261004` prompts LOMVREN itself to repair the generated file and re-verify a real server. It explicitly reuses the previous owned project and is **not a second clean run**. The verifier checks an actual loadable favicon, metadata/navigation/basic accessibility, responsive screenshots, demo interaction and console/network behavior. Original full-site pricing/FAQ/forms requirements remain unfulfilled; no broad pass is inferred. Repair outcome pending.

Repair B subsequently **failed in 724,897 ms**: real file changes duplicated the page content and still did not fix the favicon/anchor; three unchanged Python server calls omitted the bind argument and were stopped by repetition protection. The follow-up installed loopback-repair package normalizes only the exact plain Python built-in server command before explicit approval, without rewriting arbitrary shell syntax/public binds. **354 tests passed**, plus actual installed native tool checks including normalized Python server startup, approval command identity and duplicate reuse. Repair C is a real local-model compact-page repair attempt in the existing owned project; it is not a second clean test. Outcome pending.

Repair C has genuinely launched a server, inspected it, rendered the generated page, clicked the button and checked mobile. Independent in-chat interaction and loopback QA passed HTTP runtime, button state change and absence of console/network errors. It failed loadable favicon, navigation targets, main landmark and mobile overflow; actual source is 153 lines. The old loaded runtime displayed a false candidate success update, then correctly rejected completion and continued working. The latest installed evidence-boundary package fixes that provisional-success leak and untrusted tool-excerpt promotion into the system prompt. **355 tests and 27 focused checks passed**, built/installed bundle hashes match, but the older running model test does not constitute a new native acceptance of those changes. Full goal and website acceptance remain unproven.

The next model edit changed #features to a relative /features URL, **not a correct target**. The fragment-only verifier produced a false positive; an actual in-chat click returned 404. The verifier was repaired to visit same-origin routes and check real status, so the earlier true navigation flag is not acceptance evidence. Favicon, semantic main and mobile overflow still fail. Runtime/button behavior works, but the navigation route introduces a real network failure. This is unsuccessful navigation recovery, not whole-site success.

---

**Overall result: acceptance NOT PASSED.** Reports and fixtures are evidence, not substitutes for a working agent-built website.

Evidence root: `C:\Users\ganes\Documents\Codex\NexusFlow-agent-tests`.

| Check | First clean run | Second clean run |
|---|---|---|
| Directory | `torii-run-1-20261003/project` | `torii-run-2-20261003/project` |
| Initial files | Empty | Empty |
| Model | Actual Ollama qwen2.5-coder:1.5b | Same actual model |
| GPT 6.1 SOL | Unavailable / not tested | Unavailable / not tested |
| Prompt | Same full Torii requirements | Exact same SHA-256 as first |
| Installed bundle hash | `3BC428F0BD5C872F2EE6BBAF0A603DD3BFC617679D2AC03B92C2375D2B9499AB` | `0ECE721183B452B9020AAE0F32BAC87374898784FD91FDA8B1B8A8245AD90C47` |
| Registry count | 29 executable names | 39 executable names; NOT 100 independent tools |
| Actual behavior | Read inspiration, echoed follow-up | Read inspiration, repeatedly read missing package.json |
| File edits | None | None |
| Executed build/runtime commands | None | None |
| Website browser / console / network checks | Not performed | Not performed |
| Navigation / calculator / FAQ / mobile menu | Not verified | Not verified |
| Form validation / responsive / accessibility | Not verified | Not verified |
| Reported task outcome | Incorrectly completed | Watchdog cancellation; AbortError recorded |
| Independent acceptance | FAIL | FAIL |
| Recovery | False completion exposed | Creation recovery failed; 35 failed read activities |

## Fixes verified independently

The false completion path is guarded. Native controlled-tool tests verify real installed-runtime edits, saved files, directory creation, declared package inspection, dependency install, build/lint, a tracked localhost server, actual browser JavaScript/click/fill/responsive inspection, stale script approval rejection and owned process stop. Unit tests verify three-attempt unchanged failure protection. A missing browser-driver package was rejected before installation and dependency-aware packaging repaired it.

The controlled fixture has no model-produced Torii website. Its success **must not be counted as success of either website run**. Likewise, zero exit codes of the evidence harness do not mean the model completed the task.

## Final recovery follow-up

Final runtime hash: `A1C1D6FAA477177E5C7EDC4562822C92071BB1C02FDCFFF96523A22358A60D1C`.

An additional preflight, `torii-run-3-recovery-20261003`, encountered an empty initial model snapshot and did not execute the task. After an explicit model refresh, the identical prompt was submitted in a separate completely clean workspace, `torii-run-3-recovery-refreshed-20261003`.

That final installed-runtime run also **FAILED**: the actual model repeatedly requested the inspiration page; cached read results were reused, then repetition protection stopped the run after 371,462 ms. It created no files and executed no project commands. The runtime explicitly reported `failed`, instead of the original false `completed`. Recovery protection improved; website-generation success did not. All owned test harnesses have exited.

## Remaining problems

No production-quality Torii website has been executed or passed browser QA. GPT 6.1 SOL still needs a real supported model configuration; the 100-independent-tools requirement remains unmet. The currently tested small model needs stronger task execution capability, not a larger fictional tool count. Sidebar manual UX, complete accessibility and initial model-refresh concurrency are also not certified by these programmatic tests.
