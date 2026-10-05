# TuxNest v1.0.0 Release Notes

**Release Date:** October 5, 2026  
**Version:** `1.0.0`  
**Publisher:** `tuxnest`  
**Package:** `tuxnest-vscode-1.0.0.vsix`  

---

## Executive Summary

Welcome to **TuxNest v1.0.0**, the flagship release introducing our complete, unified brand identity. TuxNest is a local-first autonomous engineering environment designed for AI-assisted software development in Visual Studio Code. 

This release formalizes the transition from earlier development checkpoints to a production-ready ecosystem consisting of **TuxNest Chat** and the autonomous **TuxNest SI Agent**.

---

## Key Highlights

### 1. Unified TuxNest Brand Identity
- **Product Name:** **TuxNest**
- **Chat Interface:** **TuxNest Chat**
- **Autonomous Engineering Loop:** **TuxNest SI Agent**
- **Extension Identifier:** `tuxnest.tuxnest-vscode`
- **Commands & Configuration Namespace:** Fully unified under `tuxnest.*`
- **Proposed Diff Scheme:** `tuxnest-proposed:`
- **Official Brand Mark:** Integrated the official high-resolution penguin SVG (`media/tuxnest.svg` and `media/tuxnest-icon.png`).

### 2. Seamless In-Chat Visual Branding
- **Native Transparent SVG Integration:** The TuxNest penguin is seamlessly rendered in the chat header and the welcome card without background artifacts or opaque bounding boxes.
- **Theme-Adaptive Rendering:** Adapts to all VS Code color themes (Dark, Light, High Contrast) using transparent vector rendering and subtle drop shadows.

### 3. TuxNest Chat: The Modern Secondary Sidebar Experience
- **Multi-Mode Composer:** Toggle effortlessly between:
  - **Ask Mode:** Read-only repository understanding, contextual explanations, and architectural Q&A.
  - **Plan Mode:** Deep codebase inspection producing structured, machine-readable Implementation Plan artifacts without mutating code.
  - **Agent Mode:** Full autonomous development powered by TuxNest SI Agent.
- **Context Attachers:** Direct `@file`, `@selection`, `@terminal`, `@diagnostics`, and `@git` attachments.
- **Slash Commands:** Integrated autocomplete for `/plan`, `/diff`, `/search`, `/terminal`, `/model`, `/context`, `/diagnose`, `/remote`, and `/clear`.
- **Effort Budgets:** Configurable `Low`, `Medium`, `High`, and `Ultra` compute budgets per conversation.

### 4. TuxNest SI Agent: Autonomous Engineering Capabilities
- **Atomic Two-Phase Multi-File Patching:** Proposes structured `EditProposal` sets with SHA-256 pre- and post-condition hashes. If any target file has drifted, the entire batch is rejected cleanly to protect your codebase.
- **Unified Diff Review & Undo:** Review every single proposed change in the dedicated Changes drawer. One-click Undo restores original disk bytes even across VS Code restarts.
- **Automated Validation & Self-Repair:** Automatically discovers test suites (Node, Python, Go, Rust, Java, C/C++) and executes up to 3 bounded self-repair cycles upon test failures.
- **Bounded Tool Policy & Permission Control:** Fine-grained execution controls:
  - *Ask before every edit or command* (Default & Recommended)
  - *Auto-run reviewed safe commands*
  - *Ask once per session*
  - *Always proceed*

### 5. Flexible Model Runtime & Remote GPU Offloading
- **Local Ollama Integration:** Connects to local Ollama on loopback with zero telemetry or data retention.
- **Encrypted Remote GPU SSH Tunnels:** Offload heavy model inference (14B, 32B, 70B) to an external workstation or cloud GPU instance over an encrypted SSH tunnel with host key verification and live NVIDIA GPU telemetry.
- **OpenAI-Compatible Endpoints:** Connect to vLLM, LM Studio, or llama.cpp endpoints.

---

## Technical Specifications

| Attribute | Specification |
| :--- | :--- |
| **VS Code Engine Compatibility** | `^1.106.0` |
| **Runtime Architecture** | Standalone CommonJS bundle (`dist/extension.bundle.js`, Node 20) |
| **External Drivers** | `playwright-core` (isolated local browser verification) |
| **Automated Test Coverage** | 439 regression tests across 26 test suites (100% passing) |
| **License** | MIT License (Copyright © 2026 Paladugu Ganesh Naidu and TuxNest Contributors) |

---

## Installation

### From VSIX Package

1. Download the release package `releases/v1.0.0/tuxnest-vscode-1.0.0.vsix` or from GitHub Releases.
2. In VS Code, open the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`) and execute:
   ```text
   Extensions: Install from VSIX...
   ```
3. Select `tuxnest-vscode-1.0.0.vsix` and reload when prompted.

### From Command Line

```bash
code --install-extension tuxnest-vscode-1.0.0.vsix
```

---

## Verification & Health Check

After installation, run the diagnostic suite from the Command Palette:
- `TuxNest: Doctor` — Validates local Ollama / endpoint connectivity and models.
- `TuxNest: Run Self-Test` — Executes all internal engine health checks.
- `TuxNest: Open TuxNest SI Agent` — Launches TuxNest Chat in the Secondary Sidebar.
