# LocalForge v0.2.0 Release Notes

**Release Date:** September 29, 2026  
**Version:** 0.2.0  
**Target:** Visual Studio Code `^1.106.0`  

---

## Highlights of LocalForge v0.2.0

LocalForge v0.2.0 marks the evolution of LocalForge into a **production-grade, local-first autonomous software engineering operating system**. Rather than acting as a conversational assistant, LocalForge provides autonomous task decomposition, multi-agent coordination, deterministic diff reviews, and automated test-repair loops.

---

## What's New

### 1. Multi-Agent Orchestration & DAG Task Scheduling
- **Dynamic Task Decomposition (`TaskGraph`):** Breaks engineering goals into a Directed Acyclic Graph (DAG) with topological sorting, dependency checks, and cycle detection.
- **12 Built-in Specialized Agent Roles:** Orchestrator, Planner, Repository Analyst, Researcher, Coder, Test Engineer, Debugger, Reviewer, Security Reviewer, Documentation Agent, Git Agent, Performance Agent.
- **Context Isolation & Typed Handoffs:** Subagents receive scoped context preventing context explosion, exchanging structured machine-readable handoffs (`PlannerHandoff`, `CoderHandoff`, `TesterHandoff`, `ReviewerHandoff`).
- **Parallel File Conflict Locks:** Prevents concurrent subagents from corrupting overlapping files.
- **Persistent Checkpoints (`CheckpointManager`):** In-flight tasks survive VS Code restarts and extension reloads.

### 2. Expanded 35+ Tool Registry
- Real schema validation, timeouts, secret redaction, and risk classification (`read_only`, `low_risk`, `high_risk`, `destructive`, `network`, `privileged`).
- Core filesystem tools: `read_file`, `read_files`, `write_file`, `create_file`, `replace_range`, `delete_file`, `move_file`, `list_directory`.
- Core Git tools: `git_status`, `git_diff`, `git_log`, `git_commit`.
- Core diagnostics & project tools: `get_diagnostics`, `get_editor_context`, `inspect_project`, `create_artifact`.

### 3. LocalForge Doctor & Automated Self-Test
- **`LocalForge: Doctor` (`localforge.doctor`):** Inspects host platform, VS Code, Git CLI, local Ollama runtime, model capabilities, GPU acceleration, and workspace indexer.
- **`LocalForge: Run Self-Test` (`localforge.selfTest`):** 13-point programmatic verification verifying all core runtime subsystems.

### 4. Hardened Security Layer
- Path validator rejects traversal (`../`), UNC shares (`//`, `\\\\`), and Windows reserved device names (`CON`, `PRN`, `AUX`, `NUL`, `COM1-9`, `LPT1-9`).
- Immutable Trust Hierarchy: `SYSTEM > SECURITY POLICY > USER > TOOL POLICY > WORKSPACE DATA > MODEL OUTPUT`.
- Delimited `<untrusted_workspace_data>` tags defend against repository-level prompt injection.

---

## Installation & Upgrade
```powershell
code --install-extension localforge-vscode-0.2.0.vsix
```
