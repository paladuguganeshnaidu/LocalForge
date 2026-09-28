# LocalForge

> **A local-first AI software engineer for VS Code.**

LocalForge is an autonomous, privacy-respecting AI coding assistant that runs 100% locally or on your own remote GPU via encrypted SSH tunneling. Zero LocalForge-hosted cloud inference. Zero proprietary telemetry. Complete control over your code and writes.

---

## 🚀 Key Differentiators

- **Local-First & Private**: Models run on your local machine (Ollama, LM Studio, vLLM, llama.cpp) or your private GPU server. Prompts and source code are never uploaded to any LocalForge backend.
- **Unified Model Registry & Capability Detection**: Discovers local and remote models automatically, inferring capabilities (tool calling, code completion, reasoning, context window) so the right model is chosen for the right task.
- **Ask · Plan · Agent Modes**:
  - **💬 Ask**: Context-aware Q&A across active files, selections, open tabs, and indexed workspace code.
  - **📋 Plan**: Expert software architecture inspection producing structured implementation checklists without modifying code.
  - **⚡ Agent**: Autonomous copilot software engineer capable of inspecting code, proposing surgical multi-file edits, running test commands, and performing automatic repairs.
- **Patch-First & Diff-Reviewed Editing**: File changes are never blindly overwritten. Edits generate unified diffs with SHA-256 hash checks and stale edit detection.
- **Validation & Auto-Repair Loop**: Automatically detects your project type (Node, Python, Rust, Go, Java, C/C++) and test runner, runs validation after edits, and attempts up to 3 automatic repairs if tests fail.
- **Secure SSH Remote GPU Offloading**: Tunnel heavy inference to a remote machine equipped with NVIDIA GPUs over loopback-only forwarded SSH, with host fingerprint pinning and VS Code SecretStorage credentials.
- **Minimal Antigravity-Style UX**: Clean, native VS Code theme tokens, live agent activity chips, segmented mode toggle, and rich settings drawer.

---

## 🛠️ Modes of Operation

| Mode | Purpose | Tools Allowed | Safety Behavior |
| :--- | :--- | :--- | :--- |
| **Ask** | Understand & explain code | Read-only (`read_file`, `search_workspace`, `list_dir`) | Non-destructive; answers questions with code references. |
| **Plan** | Architectural analysis | Read-only inspection tools | Generates structured markdown checklists; no writes. |
| **Agent** | Full-stack software engineering | Read, surgical edit, patch, and safe commands | Patch-first diff review; runs test validation & auto-repairs. |

---

## 📦 Getting Started

### 1. Requirements

- **VS Code**: `^1.90.0`
- **Model Runtime**:
  - [Ollama](https://ollama.ai) running locally on `http://127.0.0.1:11434` (default), or
  - Any OpenAI-compatible server (LM Studio, vLLM, llama.cpp) on `http://127.0.0.1:1234/v1`, or
  - A remote Linux host with Ollama and an NVIDIA GPU accessible via SSH.

Recommended coding models:
```bash
ollama pull qwen2.5-coder:7b
# or for fast inline completions:
ollama pull qwen2.5-coder:1.5b
```

### 2. First Run

1. Open VS Code and click the **LocalForge** activity bar icon.
2. LocalForge will detect running Ollama runtimes and populate the model selector.
3. Choose your preferred mode (`⚡ Agent`, `📋 Plan`, or `💬 Ask`).
4. Type a prompt (e.g., *"Explain this project"* or *"Add JWT authentication middleware"*).

---

## 🖥️ Remote GPU Inference over SSH

Offload heavy models to a dedicated desktop or cloud GPU machine (RunPod, Lambda Labs, home server):

1. Click the **⚙️ Settings** icon in the LocalForge header or run `LocalForge: Configure Remote GPU Host`.
2. Enter your SSH host, username, port, and authentication method (SSH private key or password).
3. Secret credentials (passwords, key passphrases) are securely saved in **VS Code SecretStorage**—never in settings or disk logs.
4. Run `LocalForge: Connect to Remote GPU Host`.
5. LocalForge establishes a loopback-only SSH tunnel (`127.0.0.1 -> remote Ollama`) and pins the server's SSH fingerprint.
6. The top header will display your active GPU telemetry (e.g. `NVIDIA RTX 4090 · VRAM 6.1 / 24 GB · Util 45%`).

---

## ⚡ Inline Code Autocomplete

Inline completion is opt-in for maximum efficiency:

1. Open the **LocalForge Settings** drawer (or VS Code settings).
2. Toggle **Inline Code Autocomplete** (`localforge.autocomplete.enabled: true`).
3. Set your preferred completion model (e.g. `qwen2.5-coder:1.5b`).
4. As you type, LocalForge provides low-latency, context-aware suggestions with debounce and cancellation protection.

---

## 🛡️ Security & Privacy Architecture

- **Zero Cloud Inference**: LocalForge does not operate an external proxy or telemetry server. All model calls go directly to `127.0.0.1` (local or SSH tunnel).
- **Workspace Trust Enforced**: Untrusted workspaces cannot execute workspace tools, read files, or run terminal commands.
- **Bounded Hierarchical Context**: Context engine caps token budgets, tracks sources, deduplicates, and limits snippet windows.
- **Stale Edit Prevention**: Every file edit compares SHA-256 hashes against original content. If a file was modified while a diff was open, LocalForge halts and marks the proposal stale.
- **Command Policy Layer**: Dangerous shell patterns (`rm -rf /`, `del /s /q c:\`, `mkfs`, fork bombs) are blocked at the policy layer.
- **Host Key Pinning**: Remote SSH connections verify and pin host key fingerprints to protect against MITM attacks.

---

## 🔍 Diagnostics & Health Check

Run `LocalForge: Diagnose Installation` from the Command Palette or click **🛠️** in the chat header to verify:

- Workspace trust status
- Ollama endpoint reachability & model inventory
- Model capability detection (tool calling, context window)
- SSH remote tunnel and GPU status
- Workspace context index status

---

## 🧪 Building & Running Tests

```bash
# Install dependencies
npm ci

# Compile TypeScript and run the test suite
npm test

# Build packaged VSIX extension
npm run package
```

---

## 📄 License

MIT License. See [LICENSE](LICENSE) for details.
