# LocalForge Roadmap & Architecture

## Product Vision

LocalForge is a local-first AI software engineer for VS Code. It discovers models already available on your workstation or user-owned GPU server, routes chat, code edits, autonomous agent loops, and inline completions through provider-agnostic interfaces, and operates with zero proprietary cloud dependencies.

---

## 📌 Status & Milestones

### Completed in v0.1.5 ✅
- [x] **Modular Architecture Refactoring**:
  - Independent domains: `core/`, `providers/`, `context/`, `agent/`, `editing/`, `remote/`, `completion/`, and `ui/`.
- [x] **Model Capabilities & Unified Registry**:
  - Auto-detection of tool calling, streaming, code completion, reasoning, vision, and context windows.
  - Unified registry aggregating local Ollama, OpenAI-compatible servers, and SSH remote GPU endpoints.
  - Intelligent, capability-aware task router (`chat`, `edit`, `agent`, `completion`).
- [x] **Context Engine & Workspace Indexing**:
  - Bounded hierarchical context (selection, active file, open tabs, diagnostics, lexical retrieval).
  - Persistent, incremental `WorkspaceIndexer` ignoring `.git`, `node_modules`, `dist`, binaries, and large files.
- [x] **Agent Engine & Permission Framework**:
  - Autonomous `AgentLoop` with round limits, cancellation, and error capture.
  - Granular `PermissionManager` (`read`, `edit`, `execute`) and command safety policies.
- [x] **Patch-First & Composer Editing**:
  - Atomic SHA-256 hash checks and `StaleEditError` protection before writing.
  - Multi-file Composer workflow with unified diff inspection and selective approval.
- [x] **Project Validation & Auto-Repair Loop**:
  - Project detection (Node, Python, Rust, Go, Java, C/C++).
  - Post-edit test validation and up to 3 automatic repair iterations.
- [x] **SSH Remote GPU System**:
  - Forwarded loopback tunnels with host key fingerprint pinning and VS Code `SecretStorage`.
  - Structured `nvidia-smi` status parser and memory fit estimation.
- [x] **Minimal Antigravity-Style Chat UI**:
  - Segmented mode bar (`⚡ Agent`, `📋 Plan`, `💬 Ask`).
  - Native VS Code theme styling, live agent activity chips, and rich settings drawer.
- [x] **Continuity & Diagnostics**:
  - Workspace-scoped `SessionManager` and `TaskManager` with "Continue Previous Task".
  - One-click `LocalForge: Diagnose Installation` health check.
- [x] **Testing**:
  - 42 automated tests with 100% pass rate.

---

## 🔭 Future Roadmap (v0.2.0+)

### 1. Hybrid & Embedding Retrieval Engines
- [ ] Implement `EmbeddingRetrievalEngine` utilizing local embedding models (e.g. `nomic-embed-text`) via Ollama.
- [ ] Add `HybridRetrievalEngine` fusing lexical BM25/keyword scoring with vector similarity.

### 2. Model Context Protocol (MCP) Expansion
- [ ] Dynamic client connector allowing user-configured MCP servers to register custom tools into `ToolRegistry`.
- [ ] Support external database, browser, and issue tracker MCP tools.

### 3. Multi-Model Team Routing
- [ ] Allow configuring different models for planner vs executor (e.g., DeepSeek-R1 for planning, Qwen2.5-Coder for execution).
- [ ] Sub-agent task delegation.

---

## Quality Principles

1. **Zero Secret Leakage**: Passwords and keys must never touch settings files or disk logs.
2. **Review Before Write**: No silent file overwriting. Always validate hashes and offer diffs.
3. **Command Safety**: Policy blocks dangerous system calls; execution requires explicit permission mode.
4. **Local Sovereignty**: Never depend on LocalForge cloud infrastructure.
