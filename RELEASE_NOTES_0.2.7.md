# LOMVREN 0.2.7

This bug-fix release addresses misleading completion messages and raw tool errors in Agent chat.

- Failed or invalid tool calls are recorded consistently and prevent the agent from implying verified success.
- Standalone JSON tool-error payloads echoed by compact local models are removed from user-visible responses.
- Edit targets outside the trusted workspace are rejected before edit-content validation.
- Agent instructions now emphasize exact file excerpts, workspace-relative paths, and honest failure reporting.

The changes do not claim feature parity with Copilot or Claude Code. This release focuses on the reported Agent reliability issue; remote GPU testing still requires a real SSH GPU host.
