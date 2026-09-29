# LocalForge v0.2.3 Release Notes

**Release Date:** September 29, 2026  
**Version:** 0.2.3  
**Target:** Visual Studio Code `^1.106.0`  

---

## Highlights of LocalForge v0.2.3

LocalForge v0.2.3 resolves prompt dispatch responsiveness, eliminates cold-start I/O indexing stalls, guarantees immediate model route resolution across providers, and delivers instant optimistic UI feedback in the chat view.

---

## Key Improvements & Bug Fixes

### 1. Instant Optimistic UI Feedback
- **Immediate User Message Rendering:** Submitting a prompt immediately renders the user message card and an animated "LocalForge is thinking..." spinner in the conversation stream without waiting for background orchestration roundtrips.
- **Dynamic Status Updates:** The thinking spinner dynamically reflects turn progress, tool execution status, and token streaming in real-time.
- **Deduplication Safeguards:** Extension inbound message handlers guarantee user messages are not duplicated upon backend acknowledgment.

### 2. Non-Blocking Context Retrieval
- **Asynchronous Background Indexing:** `ContextEngine.assembleContext()` no longer synchronously blocks on full workspace indexing across hundreds of files on cold start.
- **Fast Cold-Start Latency:** Context assembly resolves in milliseconds by leveraging active file, editor selection, workspace diagnostics, git context, and open tabs, while comprehensive workspace indexing runs smoothly in the background.

### 3. Immediate Model Route Resolution
- **Direct Prefix Routing in `CompositeProvider`:** `resolveRoute` now dynamically parses provider prefixes (e.g. `ollama:<model>`) and single-provider topologies without requiring a prior `listModels()` cache population.
- **Zero "Model No Longer Available" Errors:** Eliminates timing race conditions between model selection, registry discovery, and agent loop tool calls.
