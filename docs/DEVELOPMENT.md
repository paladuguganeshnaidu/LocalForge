# LocalForge Developer & Contributor Guide

**Version:** LocalForge v0.2.0 Autonomous Engineering Operating System  
**Classification:** Development & Build Guide  
**Date:** September 2026  

---

## 1. Prerequisites

- **Node.js:** v22.0.0 or higher.
- **npm:** v10.0.0 or higher.
- **Visual Studio Code:** v1.106.0 or higher.
- **Git:** Installed and available in system PATH.
- **Ollama:** Installed locally (`https://ollama.ai`) or access to an OpenAI-compatible local server (LM Studio, llama.cpp, vLLM).

---

## 2. Setting Up the Development Workspace

1. **Clone the repository:**
   ```bash
   git clone https://github.com/paladuguganeshnaidu/LocalForge.git
   cd LocalForge
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Compile TypeScript:**
   ```bash
   npm run compile
   ```
   *For continuous compilation during development, use `npm run watch`.*

4. **Launch Extension in VS Code:**
   Press `F5` in VS Code to launch a new **Extension Development Host** window with LocalForge loaded.

---

## 3. Running Verification Suites

### Run All Unit and Stress Tests:
```powershell
npm test
```

### Run Extension Host Integration Tests:
```powershell
npm run test:extension-host
```

### Package into a Production VSIX:
```powershell
npm run package
```
*Generates `localforge-vscode-0.1.7.vsix` in the workspace root.*

---

## 4. Architectural Rules for Contributors

1. **The Model is NOT the System:** Do not delegate state management or validation to the model. The TypeScript runtime must validate all inputs and verify all mutations.
2. **Zero Mock Implementations:** Never introduce mock or simulation classes into production source paths (`src/`). Mocks belong strictly in test fixtures (`tests/`).
3. **No Decorative Animations:** UI badges and activity feeds must represent real backend process events.
4. **Offline First:** Never introduce external telemetry libraries or mandatory remote cloud dependencies.
