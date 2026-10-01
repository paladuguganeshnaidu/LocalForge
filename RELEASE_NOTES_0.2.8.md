# LOMVREN 0.2.8

This release improves agent transparency and command approvals.

- Expand an activity row to inspect visible model narration, the exact tool input, bounded tool output, errors, and command results.
- Credential-like values are redacted from displayed trace data; output is bounded.
- Choose safe auto-run, ask once per session, or ask before each edit or command from Settings. The choice is retained across VS Code restarts.
- New installs default to asking before each edit or command; read-only inspection remains automatic.
- Terminal spawn failures, timeouts, and stopped processes are reported as failed tool actions even when the host cannot supply an exit code.
- Hidden chain-of-thought is not exposed. The activity view shows user-visible model updates and observable actions instead.

This is an incremental release in the larger agent goal, not a claim of full Copilot/Claude Code parity. Live SSH GPU and full extension-host UI verification remain outstanding.
