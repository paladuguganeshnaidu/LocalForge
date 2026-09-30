# Red Team Report

## Implemented controls

- Canonical workspace-relative path normalization with traversal, UNC, absolute-path, reserved-device, symlink/junction containment checks.
- Canonical command classification with shell metacharacter, nested-shell, network, privilege, package-install, and process-control detection.
- ToolRegistry allow-list plus validation, permission, policy, bounded execution, redaction, and audit trail.
- Secret redaction for common credential families, private keys, bearer tokens, database URLs, and env-style secrets.
- Workspace/git-diff data is explicitly marked as untrusted data in subagent prompts.
- Autonomous file mutations are routed through EditEngine; EditEngine fails closed rather than performing an alternate direct-write fallback.
- Terminal cancellation is propagated and POSIX child groups are created with detached process groups.

## Adversarial corpus

The branch adds deterministic corpora for:
- 1,000 workspace-path cases
- 500 command-policy cases
- 500 secret-redaction cases
- 3,000 tool-call parser cases

These are regression corpora, not a claim that every possible adversarial payload is covered.

## External verification still required

Browser SSRF, SSH fingerprint validation, live remote GPU acceptance, live Ollama/OpenAI-compatible provider acceptance, and manual malicious-workspace interaction require those real services/environments.
