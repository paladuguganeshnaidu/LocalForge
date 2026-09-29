# LocalForge Remote GPU Architecture & Operational Guide

**Version:** LocalForge v0.2.0 Autonomous Engineering Operating System  
**Classification:** Hardware Acceleration & Remote Inference Architecture  
**Date:** September 2026  

---

## 1. Remote GPU Paradigm

LocalForge allows developers to write code on lightweight laptops (e.g. MacBook Air, thin client) while offloading massive model inference (32B, 70B, or MoE coding models) to a remote GPU workstation:

```
+-------------------------------------------------------------+
|                      LOCAL LAPTOP                           |
|  - VS Code Extension Host & UI (Secondary Sidebar)          |
|  - Agent Runtime, TaskGraph, Tool Execution, Local Git      |
|  - Local Port Forwarder: localhost:11435                   |
+-------------------------------------------------------------+
                              |
                     Encrypted SSH Tunnel
                     (Pinned Host Fingerprint)
                              |
                              v
+-------------------------------------------------------------+
|                   REMOTE GPU WORKSTATION                    |
|  - SSH Server (Port 22)                                     |
|  - Ollama / vLLM / llama.cpp Server (127.0.0.1:11434)      |
|  - NVIDIA GPU (RTX 4090 / A100 / H100)                     |
|  - GPU Telemetry (`nvidia-smi`)                             |
+-------------------------------------------------------------+
```

---

## 2. Security Architecture & Credential Containment

1. **Zero Credential Exposure:** Private key passphrases and SSH passwords are stored strictly in VS Code `SecretStorage` (`context.secrets`). Plaintext credentials are never written to project files, settings, or git repositories.
2. **Pinned Host Key Verification:** On initial connection, the SSH host key fingerprint is recorded. On subsequent connections, the fingerprint is strictly verified; any mismatch immediately aborts the connection to prevent Man-in-the-Middle (MITM) attacks.
3. **Encrypted Port Forwarding:** Remote models communicate strictly over local loopback (`127.0.0.1:11435` forwarded through the encrypted SSH channel).

---

## 3. GPU Hardware Telemetry & Model Fit Estimation

1. **Hardware Polling:** `GpuMonitor` periodically executes `nvidia-smi` on the remote host via SSH, capturing:
   - GPU Name & Driver Version
   - Total VRAM & Free VRAM (MiB)
   - GPU Utilization (%)
2. **Model Fit Prediction (`estimateGpuModelFit`):**
   - Automatically calculates whether a given model (e.g. `qwen2.5-coder:32b`, ~20GB) will fit within available remote VRAM.
   - Warns the user if the model will spill over into system RAM or cause an out-of-memory error.

---

## 4. Lifecycle & Reconnection Management

1. **Connection (`localforge.connectRemote`):**
   - Establishes SSH connection using `ssh2`.
   - Binds local port (e.g. `11435`) to remote Ollama port (`11434`).
   - Discovers installed remote models and registers a `RemoteProvider` with canonical IDs (e.g. `ssh-profile:qwen2.5-coder:32b`).
2. **Execution:**
   - The user selects the remote model or `ModelRouter` delegates heavy agent tasks to the remote GPU model.
   - Tokens stream with sub-second latency through the local port forwarder.
3. **Disconnection (`localforge.disconnectRemote`):**
   - Closes SSH channel and local listener.
   - Automatically unregisters remote models from `ModelRegistry` and cleans up `CompositeProvider`.
