# LOMVREN 0.2.5

This update hardens local browser inspection and command approvals, clarifies where prompts and code context are sent, and strengthens release packaging checks.

## Changes

- Browser inspection is limited to localhost HTTP(S), rejects redirects and credentials in URLs, and bounds request duration and response size.
- `always_proceed` still asks for approval before commands outside the reviewed safe-command allow-list.
- Packaging verifies the Marketplace extension identity and confirms that development reports, tests, logs, and lockfiles are absent from the VSIX.
- Added an optional live Ollama smoke check for local model discovery and generation.
- Preserved the Marketplace technical identity `paladuguganeshnaidu.localforge-vscode`.

## Compatibility and data handling

- Existing extension settings, commands, and Marketplace identity remain unchanged.
- Local Ollama requests go to the configured local endpoint. Remote SSH mode sends prompts and selected context to the user's remote host. OpenAI-compatible endpoints may also be remote; configure only endpoints whose data handling you trust.
- Shell tools are not an operating-system sandbox and execute with the user's account privileges.
