# TuxNest — 1.0.1 User Guide

The extension identity is `tuxnest.tuxnest-vscode` (publisher: `tuxnest`). Version 1.0.0 delivers the complete rebrand to **TuxNest**, introducing **TuxNest Chat** and the autonomous **TuxNest SI Agent**.

## Install and open

TuxNest automatically starts an already installed local Ollama server on activation and model refresh. It reuses a running server, waits for real readiness and discovers installed models. If the configured model directory is unavailable but existing home-directory models are present, only the server process uses those models; persistent environment settings are unchanged. Disable **Tuxnest › Ollama: Auto Start** to keep startup manual. Only supported absolute installation paths and unprivileged loopback HTTP endpoints are eligible; no arbitrary programs, models, remote services or downloads are started. SSH GPU studios and their servers still need to be available before connecting.

1. Use VS Code 1.106 or later. Open a disposable, trusted project folder for your first agent task.
2. Run **Extensions: Install from VSIX** and select the validated `tuxnest-vscode-1.0.1.vsix` package artifact. Reload the window. **TuxNest: Diagnose Installation** reports the actual active version and extension path.
3. Run **TuxNest: Open TuxNest SI Agent** or open **TuxNest Chat** in the Secondary Sidebar. Model and mode selectors are in the bottom composer. Use the file picker to attach exact files; advanced controls are in Settings.
4. **TuxNest: Doctor**, **Run Self-Test** and **Refresh Models** help diagnose connectivity. A packaged version does not prove that a particular model can complete your task.

## Local, GPU and API models

- Local: install and run Ollama yourself, then open Models and refresh. Installed models are discovered through Ollama, not invented by the extension. Select an installed model explicitly.
- Downloads: choose an actual discovered download target in Models before installing a supported Ollama model. A remote target downloads on that remote Ollama host, not on this laptop. Review the model's license, disk size and RAM/VRAM requirements first. Downloads can take time or fail; check the actual target and status.
- SSH GPU: use **TuxNest: Configure Remote GPU Host**, configure your own host/user/key or password and remote Ollama port, then **TuxNest: Connect to Remote GPU Host**. Verify the host fingerprint independently before trusting it. Ollama must be running on the remote host. The extension tunnels its API and discovers that host's installed models; local file changes and commands still run on your laptop/workspace, not automatically on the GPU server.
- If the studio or SSH connection closes, the remote models are removed and the chat reports disconnection. The selected model is not silently replaced. Restart the studio/Ollama if needed, reconnect and retry explicitly. Partial generated text is not completion, and prior saved edits are not automatically rolled back or re-executed.
- Connected local GPU: Ollama controls acceleration on its own machine. The extension does not install GPU drivers or guarantee all layers fit in VRAM.
- API: Settings accepts explicit OpenAI-compatible API base URLs. Select that endpoint's discovered model. Context is sent to the selected endpoint; there is no publisher-hosted inference service.

Qwen3.5 9B is a downloaded candidate tested on an authorized 16 GB T4, not a guarantee of best performance. Start with 8192 context tokens and non-thinking mode; model context, VRAM and generation time are finite. The output limit `-1` removes the extension's generation cap, not the model's context or hardware limits. Increasing limits blindly can cause slowdowns or failures.

## Modes, context and approval

The effort dropdown next to the model provides **Low / Medium / High / Ultra**, saved independently in each chat. Low/Medium/High request at most 4096/8192/16384 context tokens and 2048/4096/8192 output tokens per Ollama response. Your smaller configured/model context or positive output ceiling still wins. Ultra uses the configured maximum and `-1` output when configured, removes the agent-round cap and compacts old exchanges while continuing multi-file work. A configured `maxRounds: 0` also removes the round cap for other efforts. Repeated-action protection, cancellation, approval and verification remain active. These are execution budgets, not a guarantee of model reasoning quality or infinite context. API models retain their provider-side output policy.

At the default 8192 context, High/Ultra do not silently allocate a larger KV cache. Increase the advanced context-window setting only after measuring the selected model's actual RAM/VRAM consumption. An advertised maximum can be far larger than this machine can run. Long projects are produced across saved files, multiple bounded responses and verified steps—not as one infinite response or a claim of unlimited hardware.

- **Ask** inspects and answers without edit/process tools. **Plan** produces an inspection/plan without executing code changes. **Agent** can propose or apply edits, run approved commands and verify results.
- **Project workspace** is the default file-tool scope. **File** limits inspection/edit proposals to the selected file and blocks terminal/project/delegation work. **Full Machine** requires confirmation and enables separately approved bounded outside-workspace reads; it is not administrator access or unrestricted file editing.
- **Allow** approves the displayed action. **Deny** refuses it without executing the action. **Allow commands & edits for this chat** grants ordinary existing built-in workspace operations for this chat. Protected internet/sensitive/destructive/privileged/custom actions still ask separately; policy-blocked catastrophic commands remain blocked.
- A session grant ends on chat/scope/approval-mode changes or reload. Newly registered/replaced handlers cannot inherit it. The card stays until the host acknowledges your choice. Changing settings is not a substitute for responding to a pending approval.
- Approved shell/package scripts run as your OS account and are **not OS-sandboxed**. They can read other files or access the network. Recognized internet operations request approval, but this is not an OS firewall. Use a disposable project and inspect commands before granting broad permission.

## Edits and real verification

With diff review, accept/reject proposals through Changes; files are not considered saved merely because a proposal exists. Stale snapshots or save errors must be resolved before continuing. **TuxNest: Undo Recorded Changes** uses available recorded recovery, not arbitrary Git history.

Activity rows show actual reads/writes, the command while running, exit status and output after settlement. Expand details for errors. A process marked started still needs a readiness check. Website verification uses an isolated installed Chrome/Edge and loopback URLs; external assets, service workers, downloads and WebSockets are blocked there. A production preview with local assets is more reliable than HMR.

For explicit requested verification, the agent can schedule registered read/process/browser tools through the same approval path. A real previously failed command may be rerun after a saved repair. Denied/pending-review actions are not silently applied. Missing or failing tests remain a failure, not a green status derived from confident prose.

## Read-only specialists and temporary workflow registration

In Agent mode, request discovery of `delegate_task` for a **planner**, **repository_analyst**, **reviewer** or **researcher**. Delegation requires approval and uses the selected model, current workspace and read-only parent permission intersection. One worker runs at a time; it cannot recurse, write, run commands or expand access. Non-planner roles require actual inspection. Returned findings are not a certified build or security review. Stop propagates cancellation; the worker remains owned until it settles.

`register_workflow_tool` can, with approval, register a fixed recipe of 2–10 steps combining at least two different existing built-in operations. Names start with `workflow_`. No generated JavaScript is evaluated inside the extension. Recursive workflows, delegation steps, aliases and built-in replacement are rejected. Discover the exact new name on a later round, then invoke it with no arguments. Each invocation and protected child retain approval checks; failed/pending-review steps stop later work. Changed handlers invalidate the recipe. Registrations last only for this extension host; reload removes them. Recipes do not count as additional independent tools.

## First tasks

1. Ask: “Read README.md and package.json. Summarize the actual project and commands; distinguish inspected facts from assumptions.”
2. Agent: “Create agent-edit-test.md with exactly two lines: # Agent Edit Test and TuxNest SI Agent created this file. If it exists, stop. Do not change other files. Propose the change for approval.” Accept, then request a saved-file read.
3. In an empty disposable folder: “Create a tiny original responsive index.html with a main landmark, a button and visible status. Start an owned localhost server. Verify render, button click, mobile and desktop widths. Report failures honestly.”
4. Increase scope only after real saved-file, command, browser and cleanup checks pass with your selected model.

## Recovery and release limits

For source builds: `npm ci`, `npm test`, then `npm run package`. Packaging refuses to overwrite an existing artifact. For a development revision of the same version, use `npm run package -- tuxnest-vscode-1.0.0-<unique-label>.vsix`. The preserved 1.0.0 checkpoint is not silently replaced; a fresh CI checkout can package normally. Verify/install the exact artifact you tested, not whichever VSIX filename looks newest.

If an action hangs, use Stop and wait for cancellation acknowledgement; do not start overlapping tasks. Inspect the failed row, saved file and real command output. Refresh disconnected models or reconnect the verified SSH host. A weak model can repeatedly produce invalid code or tools; retry with a more capable model rather than hiding the errors.

See `AGENT-TEST-REPORT.md` and `AGENT-TEST-COMPARISON.md` for evidence and outstanding acceptance failures. Full production NexusFlow/3D, a second clean complete run and all requested ML/document workflows remain release gates. There is no claim of 100 independent executable tools, unlimited capabilities, commercial-agent parity, 1.0.0 publication or Marketplace indexing based on packaging alone.
