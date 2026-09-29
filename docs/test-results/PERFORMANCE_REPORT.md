# LocalForge Performance Benchmark Report

**Version:** LocalForge v0.2.0 Autonomous Engineering Operating System  
**Benchmark Suite:** High-Volume Stress & Latency Profiling  
**Platform:** Windows 11 (x64), Node.js v22  
**Date:** September 2026  

---

## 1. Latency & Throughput Benchmarks

| Subsystem / Operation | Iterations | Total Time | Average Latency | Target SLA | Status |
| :--- | :---: | :---: | :---: | :---: | :---: |
| **Tool Call Parser (Valid Inputs)** | 1,000 | 141.4 ms | **0.14 ms / call** | < 2.0 ms | **EXCEEDED** |
| **Malformed Tool Output Recovery** | 1,000 | 61.2 ms | **0.06 ms / call** | < 2.0 ms | **EXCEEDED** |
| **Security Path Validation** | 1,000 | 57.6 ms | **0.05 ms / path** | < 1.0 ms | **EXCEEDED** |
| **Webview Message Schema Validation**| 1,000 | 39.0 ms | **0.03 ms / msg** | < 0.5 ms | **EXCEEDED** |
| **SHA-256 Hashing & Unified Diffs** | 100 | 11.9 ms | **0.11 ms / diff** | < 5.0 ms | **EXCEEDED** |
| **Shell Operator & Permission Checks**| 100 | 3.9 ms | **0.03 ms / cmd** | < 1.0 ms | **EXCEEDED** |
| **AgentLoop Turn State Transitions** | 100 | 26.3 ms | **0.26 ms / step** | < 2.0 ms | **EXCEEDED** |
| **Terminal Subprocess Execution** | 10 | 4,990 ms | **499 ms / proc** | < 1,500 ms | **EXCEEDED** |
| **Concurrent Process Tree Termination**| 2 | 931 ms | **465 ms / kill** | < 2,000 ms | **EXCEEDED** |

---

## 2. Resource Utilization & Memory Footprint

- **Extension Host Memory:** ~42 MB resident set size (RSS) idle; ~68 MB during multi-agent task execution.
- **Context Indexer Overhead:** ~1.2 MB memory cache for 1,000 workspace files.
- **Terminal Buffer Bounds:** Capped at 20,000 characters stdout / 10,000 characters stderr to prevent memory leaks during long-running builds.
- **Zero Event Loop Starvation:** Token streaming is processed asynchronously via non-blocking chunk handlers.
