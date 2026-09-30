# VS Code Marketplace Publishing Checklist: LOMVREN

**Target Package:** `localforge-vscode-0.2.4.vsix`  
**Brand Name:** LOMVREN  
**Technical Extension ID:** `paladuguganeshnaidu.localforge-vscode`  

---

## Pre-Publish Verification Gate

Every check below must be verified before uploading to VS Code Marketplace:

- [ ] **1. Extension Technical Identity Integrity**
  - `package.json` contains `"name": "localforge-vscode"` (matches existing Marketplace listing).
  - `package.json` contains `"publisher": "paladuguganeshnaidu"`.
  - `package.json` contains `"displayName": "LOMVREN"`.
  - `package.json` contains `"version": "0.2.4"`.
  - `package.json` contains `"icon": "media/lomvren-icon.png"`.

- [ ] **2. Asset Validation**
  - `media/lomvren-icon.png` exists, is a valid square PNG (>= 128x128), and is bundled.
  - Icon visual features approved LOMVREN palette (forest green, sage green, cream).

- [ ] **3. Quality & Test Pipeline**
  - `npm run compile` succeeds with zero TypeScript errors.
  - `npm test` executes cleanly: 96/96 passing tests.
  - `npm run test:extension-host` passes all integration suites in real VS Code Electron runtime.

- [ ] **4. Packaging Standards**
  - Packaged via official tool: `npx @vscode/vsce package --no-git-tag-version` (or `npm run package`).
  - Output filename is exactly `localforge-vscode-0.2.4.vsix`.
  - No stale or manually renamed `.vsix` packages exist in the release directory.

- [ ] **5. Automated Manifest Assertion**
  - Run verification script: `node scripts/verify-marketplace-package.cjs`.
  - Confirms matching publisher, extension name, version, display name, icon path, and compiled bundle presence inside the generated VSIX.

- [ ] **6. Local Installation & Live Test**
  - Installed via `code --install-extension localforge-vscode-0.2.4.vsix --force`.
  - Verified via `code --list-extensions --show-versions` showing `paladuguganeshnaidu.localforge-vscode@0.2.4`.
  - Verified window reload, webview UI displays LOMVREN branding and custom logo.
  - Verified prompt submission and tool execution run smoothly.
