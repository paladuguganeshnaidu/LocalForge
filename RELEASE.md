# Release and update LOMVREN

Run commands in `C:\Users\ganes\OneDrive\Desktop\LocalForge` with Node/npm installed.

## One release command

`npm run release` asks for a new stable version. It updates both manifests, runs the complete regression suite, builds/packages the extension, verifies its identity and exact payload, and prints the VSIX path and SHA256. A failed step stops the release; inspect and fix the failure before retrying. Version changes remain available for that repair. Existing packages are never overwritten.

Examples:

```powershell
npm run release -- --version 0.3.3 --install
npm run release -- --version 0.3.2 --output localforge-vscode-0.3.2-release.vsix --install
npm run release -- --version 0.3.4 --install --publish
```

`--install` installs locally; reload an already-open VS Code window. Windows automatic installation supports the standard per-user VS Code installation; other installations can use Extensions: Install from VSIX. `--publish` requires an interactive exact-version confirmation and your own authenticated VSCE publisher account. Never paste a publisher token into a chat or commit it. No Git commit/push is performed automatically.

## Required real acceptance before publication

Version 1.0.0 is a local candidate, requested on 2026-10-05, not production certification. Keep the preserved 0.3.0 and tested 0.3.2 packages. Do not upload, commit, push or tag this candidate until the user confirms the release after reviewing AGENT-TEST-REPORT.md.

Packaging and regression passes do not prove autonomous model quality. Test a clean saved-file task, a runnable CLI/test project, data processing, and a website/server with actual browser interactions and responsive checks. Verify the selected model, GPU inference, permissions, command execution and recovery. Keep failed evidence. Do not call unfinished generation or proposed edits success.

The original full NexusFlow/3D mission and two successful clean full-site runs are not yet certified. There are 44 registered executable tool names, not 100 independent meaningful tools. 20B/40B model behavior has not been independently reproduced or corrected; larger weights alone do not guarantee reliable tools. The 0.3.0 checkpoint is preserved. Current 0.3.2 is a development release, not a production 1.0.0 certification.

## Reasoning and flexible tasks

Agent mode can create non-web projects using workspace file tools and approved commands. Its initial tool budget now prioritizes general execution/testing for non-web prompts rather than browser/npm operations. Missing registered tools can be discovered; discovery does not grant approval. Enable **Localforge › Ollama: Agent Thinking** for a runtime-advertised reasoning model. Private reasoning is not shown as chat. Use High/Ultra effort and a context size that actually fits your hardware; no finite model supports infinite single-request context/output. Ultra does not bypass approvals or progress guards.

## GPU test readiness

When requested, start your Lightning studio and its Ollama server, then connect through your independently verified SSH host fingerprint. SSH success without a running Ollama server is not model readiness. The extension never disables host verification to make a connection succeed. Remote GPU inference does not move local filesystem/commands onto the GPU machine automatically.
