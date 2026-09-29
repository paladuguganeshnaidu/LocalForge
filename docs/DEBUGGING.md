# LocalForge Debugging & Diagnostic Guide

**Version:** LocalForge v0.2.0 Autonomous Engineering Operating System  
**Classification:** Engineering Diagnostics & Troubleshooting  
**Date:** September 2026  

---

## 1. Primary Diagnostic Tools

### 1.1 LocalForge: Doctor (`localforge.doctor`)
Open the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`) and execute:
```text
LocalForge: Doctor
```
Generates a markdown report inspecting:
- Host Environment: VS Code version, Node.js runtime, OS architecture.
- Workspace Trust: Validates whether file operations and shell execution are enabled.
- Git Integration: Verifies Git CLI availability and repository root.
- Local Ollama Runtime: Checks HTTP reachability on `http://127.0.0.1:11434`.
- Model Discovery & Tool Capabilities: Catalogs discovered models and identifies tool-calling support.
- Local/Remote GPU Status: Probes `nvidia-smi` and active SSH tunnels.
- Tool Registry: Verifies all 35+ core tools are registered and available.
- Workspace Context Indexer: Confirms indexed file counts and cached bytes.

### 1.2 LocalForge: Run Self-Test (`localforge.selfTest`)
Runs a 13-point automated integration check verifying activation, config, models, tools, filesystem, terminal, workspace trust, context engine, multi-agent task graph, events, diff engine, and session storage.

---

## 2. Common Issues & Remediations

### 2.1 Model Not Calling Tools
- **Symptom:** In Agent Mode, the model outputs raw text like "I will edit the file" instead of executing tools.
- **Cause:** The selected model lacks native tool calling or reasoning templates.
- **Fix:** Pull a model with verified tool support, such as:
  ```bash
  ollama pull qwen2.5-coder:7b
  ollama pull llama3.1:8b
  ```
  `ToolCallParser` will also automatically extract XML `<tool_call>` and fenced JSON if native tools are missing.

### 2.2 Ollama Connection Refused (`ECONNREFUSED 127.0.0.1:11434`)
- **Symptom:** Doctor reports yellow or red for Local Ollama Runtime.
- **Fix:** Start the local Ollama server:
  ```bash
  ollama serve
  ```
  Verify by navigating to `http://127.0.0.1:11434` in your browser.

### 2.3 Command Blocked by Safety Policy
- **Symptom:** Terminal command fails with `Command blocked by safety policy`.
- **Cause:** The command contains shell chaining (`&&`, `;`, `|`) while in `allow_safe_auto` mode, or is on the catastrophic blacklist (`rm -rf`, `format`).
- **Fix:** Run commands without compound chaining or switch permission mode to `request_review` in settings.

### 2.4 Stale Edit Error (`StaleEditError`)
- **Symptom:** An edit proposal fails with `File modified outside proposal`.
- **Cause:** The file changed on disk between the time the agent read the content and when the diff was applied.
- **Fix:** LocalForge automatically detects this condition and rejects the apply to prevent overwriting user changes. Simply re-prompt the agent to re-read the file and regenerate the patch.
