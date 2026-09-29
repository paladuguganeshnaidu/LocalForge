# LocalForge v0.2.2 Release Notes

## Summary
LocalForge v0.2.2 resolves the critical issue where local models (such as `qwen2.5-coder:1.5b` and compact models under 7B) caused agent tool execution to fail with `Task execution failed`.

---

## Root Causes Identified & Resolved

1. **Ollama Native Tools Bypass for Compact Models (`ollamaProvider.ts`)**:
   - Compact models (< 7B) do not reliably parse Ollama's injected native function-calling template, causing 4x evaluation latency and hallucinated schema echoes (`{"query": {"type": "string", ...}}` or nested arguments).
   - In v0.2.2, `ollamaProvider` automatically skips passing native `tools` to Ollama for compact models, utilizing LocalForge's native prompt-based `LOCALFORGE_TOOL_CALL` protocol which executes in ~3 seconds with zero schema hallucinations.

2. **Recursive Argument Normalization & Unwrapping (`toolCallParser.ts`)**:
   - Small models sometimes nest arguments inside objects like `{"query": {"query": "term"}}` or `{"path": {"file": "..."}}`.
   - `ToolCallParser.normalizeArguments()` now recursively unwraps nested property objects, aliases, and schema echoes, extracting clean string values for `query`, `path`, `command`, `content`, etc.

3. **Tool Parameter Resiliency & Safe Empty Fallback (`workspaceTools.ts` & `coreTools.ts`)**:
   - `getString()` now inspects object structures before validating strings, preventing unexpected type errors.
   - `search_workspace` now safely handles empty or unresolvable search queries by discovering relevant files instead of throwing exceptions.

---

## Verification & Test Results
- **Unit Test Suite**: 95/95 test suites passing (100% pass rate).
- **New Regression Test**: `ToolCallParser unwraps nested query objects and schema echoes` verified.
- **Local Agent Execution**: Verified local inference in agent mode with `qwen2.5-coder:1.5b` with zero crashes and clean tool calling.
