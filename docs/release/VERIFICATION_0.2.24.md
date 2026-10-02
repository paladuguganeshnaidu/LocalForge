# LOMVREN 0.2.24 verification record

Date: 2026-10-02. This is a tested development build, not certification of parity with Copilot, Codex or Claude Code. The published technical identity remains `paladuguganeshnaidu.localforge-vscode`; the display name remains LOMVREN.

## Changes delivered

- Directory argument aliases resolve the requested directory. Supplying a file path produces an actionable error instead of silently listing the workspace root. Failed inspection can recover through a correct file read, including in Ask mode.
- Replies render escaped Markdown headings, grouped lists, code, quotes and safe links. Plain section labels can be normalized without changing fenced code. Live tool actions appear chronologically within chat, with exact command text, settled exit codes and expandable input/output.
- Inspection requests require successful evidence before rendering a final answer. Partial findings retain specific unresolved errors rather than replacing the answer with a generic warning. Repository identity can be inserted explicitly from successfully inspected manifest metadata; requested exact script values are checked with bounded correction attempts. This validates selected facts, not every semantic claim in an answer.
- Greetings and simple summary-only requests expose read-only tools even in Agent mode. Multi-action requests retain Agent capabilities.
- Project workspace, File and Full Machine profiles are enforced at built-in tool dispatch. File scope excludes other files, broad context, previous wider conversation, terminal, Git and delegation. Full Machine adds individually approved outside-workspace reads and listings, not unrestricted diff editing.
- Approved HTTPS page reading is bounded, does not follow redirects, and treats returned content as untrusted. Recognized network commands require approval, including in automatic permission modes. Credentials and outside-workspace files are excluded from automatic context.
- Task rounds, history and local model generation/context settings are configurable. Repeated identical actions cannot run indefinitely. An uncapped task/output setting removes an extension cap, not model, memory or hardware constraints.

## Verified on this machine

| Check | Result and scope |
| --- | --- |
| TypeScript and unit/regression suite | `npm test`: 245 passed; zero failed, cancelled or skipped. Includes tool parsing, intent, Markdown safety, approvals, scope restrictions, context boundaries, summary grounding and reviewed edits. |
| Real VS Code extension host | All 16 integration stages passed. Includes activation, real filesystem operations, native edit review, webview lifecycle/IPC, command execution, directory/File-scope regressions and Models view activation. |
| Live local Ollama | Model discovery succeeded against `127.0.0.1:11434` with nine installed models. `qwen2.5-coder:1.5b` produced an approved file proposal, an approved command with real output, and a read-only manifest summary grounded in an actual file read. Exact build/test script values were asserted. |
| Recovery across restart | The separate two-process VS Code recovery test passed for reviewed edits and file creation/move/deletion, including exact original binary bytes and editor synchronization. |
| Portfolio mechanics | A scripted provider fixture exercised a three-file portfolio proposal, review/application and program validation. This is a deterministic workflow regression, not proof that a local model can autonomously build a complete portfolio. |
| Chat UI | The actual generated webview HTML was checked in a browser with a sample conversation: chronological command rows, headings/lists/code, expanded command details, settings, no settled active indicators, no observed JavaScript errors and no horizontal overflow at the tested widths. This preview uses a simulated message bridge; native webview lifecycle/IPC is checked separately above. |
| Package and install | `npm run package` passed the build and VSIX identity/content checks. VS Code reported successful installation, and its extension inventory confirmed `paladuguganeshnaidu.localforge-vscode@0.2.24`. Existing editor windows were not forcibly reloaded. |

The live model ran on CPU with an 8192-token context on this laptop. Its first summary response was ungrounded and was rejected; a later response read the manifest and included the actual script values. The project-identity heading was anchored by runtime inspection metadata when the model omitted it. This result does not establish reliable whole-repository understanding for every model or prompt.

## Operational limits

- Review mode proposes files. Accept the proposal and continue the task to inspect and verify accepted changes; acceptance does not automatically resume the original run.
- Approved shell commands run as the existing OS account. The scope selector and network approvals are tool policies, not an OS filesystem sandbox or firewall. Arbitrary scripts may access the network or files with that account's privileges.
- Full Machine file/directory tools are approved reads only. Reviewed diff and Undo operations remain workspace-only. File scope currently selects a file in the first workspace folder.
- Local inference sends no prompts to the publisher. A remote/API provider sends prompts and context to the endpoint chosen by the user. Approved web requests contact their destination. Backups may contain original local file contents; protect local VS Code storage.
- Small local models can choose wrong tools, omit facts or fail long tasks. Recovery and evidence checks reduce false completion but do not guarantee correctness. RAM/VRAM, model context and speed remain finite.
- No automatic internet search engine is included. SSH/GPU and cloud-provider live verification remain deferred; this record does not claim they were tested during this change.
- This work does not implement or certify every feature in the larger product roadmap.

## Reproduce

Artifact: `localforge-vscode-0.2.24.vsix`. SHA-256: `1D69D9952CF84EA7BB755AF4ACBB0CAF8B0633E0CD16E08DF866F8CCFCD4D09D`. The verification report is excluded from the installed payload. No Marketplace upload is claimed by this record.

Run sequentially to avoid competing local inference loads:

```text
npm test
npm run test:extension-host
npm run test:recovery-restart
npm run test:ollama-summary
npm run package
```

The live checks require running Ollama and an installed test model. The package command builds the runtime and checks VSIX identity, version, icon and payload. Install the resulting `localforge-vscode-0.2.24.vsix`, save editor work, reload VS Code, and select an installed model. Start with Ask, then a small Agent task with explicit review before using automatic permission modes.
