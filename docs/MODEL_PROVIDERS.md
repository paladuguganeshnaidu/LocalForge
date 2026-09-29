# LocalForge Model Providers & Routing Architecture

**Version:** LocalForge v0.2.0 Autonomous Engineering Operating System  
**Classification:** Provider & Protocol Architecture  
**Date:** September 2026  

---

## 1. Provider Abstraction Architecture

LocalForge decouples the agent runtime from specific model vendors. The runtime treats inference providers as pluggable adapters implementing `ModelProvider`:

```
                    +-----------------------+
                    |    AGENT RUNTIME      |
                    +-----------------------+
                                |
                                v
                    +-----------------------+
                    |   COMPOSITE PROVIDER  |
                    +-----------------------+
                                |
        +-----------------------+-----------------------+
        |                       |                       |
        v                       v                       v
+---------------+       +---------------+       +---------------+
| OllamaProvider|       | OpenAiProvider|       |RemoteSSHProvider|
| (Local HTTP)  |       | (LM Studio /  |       | (Encrypted    |
| 127.0.0.1:    |       |  llama.cpp /  |       |  Port Forward |
|  11434        |       |  vLLM)        |       |  to GPU Host) |
+---------------+       +---------------+       +---------------+
```

---

## 2. Canonical Model Identity (`ModelRef`)

All models across all providers share a unified, canonical identifier:
```
{providerId}:{encodedModelName}
```
Examples:
- `ollama:qwen2.5-coder:7b`
- `ollama:llama3.1:8b`
- `openai:qwen2.5-coder-32b-instruct`
- `ssh-lambda-labs:deepseek-coder:33b`

No component or UI element is permitted to invent its own ad-hoc model identity format.

---

## 3. Capability Discovery & Evaluation

Model capabilities are dynamically queried or inferred via `inferModelCapabilities` and `evaluateRuntimeCapabilities`:
- **Tool Calling:** Detected via model name (`qwen2.5`, `llama3.1`, `mistral`) or runtime inspection of model templates (`.Tools`, `[AVAILABLE_TOOLS]`).
- **Code Completion:** Detected via coding family heuristics (`coder`, `starcoder`, `deepseek-coder`).
- **Reasoning:** Detected for thinking models (`r1`, `qwq`, `deepseek-r1`).
- **Context Window:** Mapped according to model family architecture (e.g. 32K for `qwen2.5`, 128K for `llama3.1`).

---

## 4. Intelligent Task-Based Model Routing

`ModelRouter` automatically selects the best candidate model based on task requirements:
1. **Agent Tasks:** Requires `toolCalling: true`. Prioritizes local coder models or large remote models.
2. **Inline Completion:** Prefers fast, small models (0.5B to 3B parameters) with low first-token latency.
3. **Architecture Planning:** Prefers large reasoning or high-context models.
4. **User Override:** Users can explicitly pin specific models in settings (`localforge.routing.*`) or via the UI picker.

---

## 5. Universal Output Normalization

Local models output tool calls in diverse, non-standard formats. `ToolCallParser` transparently parses and normalizes:
- Native OpenAI/Ollama function calling JSON.
- XML tags: `<tool_call>{"name": "...", "arguments": {...}}</tool_call>`.
- Fenced Markdown JSON code blocks.
- Bare JSON objects with `tool` or `action` keys.
- Stripping `<think>...</think>` internal reasoning traces from user-visible outputs.
