# LocalForge Roadmap & Architecture

## Product Vision

LocalForge is a local-first AI software engineer for VS Code. It discovers models already available on your workstation or user-owned GPU server, routes chat, code edits, autonomous agent loops, and inline completions through provider-agnostic interfaces, and operates with zero proprietary cloud dependencies.

---

## Status & Milestones

### Completed in v0.1.6
- [x] **Antigravity IDE Agent Side Panel Experience**:
  - Implemented Secondary Sidebar view (`contributes.viewsContainers.secondarySidebar`).
  - Zero-emoji design standard with native VS Code theme tokens and Codicon SVGs.
  - Interactive deliverable cards (`Implementation Plan`, `Walkthrough`, `Code Diff`) with review and proceed actions.
  - Collapsible operational activity timeline without private chain-of-thought exposure.
  - Dedicated Review Changes drawer with diff inspection and atomic multi-file apply.
  - Composer with `@` context reference chips and `/` slash command autocomplete.
- [x] **Canonical Model Identity (ModelRef.id)**:
  - Unified single source of truth across ModelRegistry, CompositeProvider, ModelRouter, and sessions.
  - Deterministic execution of UI-selected models.
- [x] **Synchronized Remote GPU Lifecycle**:
  - Synchronous registration and unregistration across ModelRegistry and CompositeProvider.
  - Surfaced NVIDIA GPU telemetry in the unified model picker.
- [x] **Atomic Two-Phase Multi-File Patching**:
  - Safe 2-phase atomic commit verifying original hashes and missing-file state before writing.
  - All-or-nothing apply prevents partially applied or corrupted states.
- [x] **Layered Command Policy & Chaining Safety**:
  - Command categorization and strict rejection of shell chaining operators (`&&`, `||`, `;`, `|`, `2>`, `$()`, backticks) in auto-safe execution.
- [x] **Terminal & Local Browser Tool Abstractions**:
  - Managed terminal sub-process execution and local browser verification without cloud dependencies.
- [x] **Deliverable Artifact System & Turn Management**:
  - Comprehensive ArtifactManager and TurnManager with status lifecycles and milestone tracking.
- [x] **Expanded Automated Test Suite**:
  - 56 passing automated tests covering all core components and end-to-end integration fixtures.

### Completed in v0.1.5
- [x] Modular architecture refactoring (`core/`, `providers/`, `context/`, `agent/`, `editing/`, `remote/`, `ui/`).
- [x] Model capabilities detection and unified ModelRegistry.
- [x] ContextEngine with token budgeting and persistent WorkspaceIndexer.
- [x] Patch-first editing with SHA-256 snapshots and StaleEditError.
- [x] Automated project detection and test validation loop with auto-repair.
- [x] SSH Remote GPU tunnel with SecretStorage and host key pinning.

---

## Future Roadmap (v0.2.0+)

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

1. **Local-First Always**: No required cloud dependencies, accounts, or telemetry.
2. **Never Overwrite Silently**: Every write is staged as an EditProposal and checked against original file hashes.
3. **Deterministic Identity**: Canonical model IDs ensure the user gets exactly what they selected.
4. **Native VS Code Look & Feel**: The agent panel feels like an integral part of VS Code, matching the editor aesthetic.
