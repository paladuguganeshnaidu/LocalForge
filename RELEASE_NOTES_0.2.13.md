# LOMVREN 0.2.13

## Safer agent tool execution

- Built-in tools receive automatic read-only permission only when their registered category and risk metadata explicitly declare them read-only. Custom tools still require permission.
- An identical consecutive successful tool call reuses the previous result instead of re-running a command or edit.
- The repository includes a local Ollama smoke test for real-model tool calls, command approval, execution, and returned output.
