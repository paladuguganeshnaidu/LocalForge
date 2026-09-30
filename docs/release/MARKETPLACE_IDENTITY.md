# VS Code Marketplace Extension Identity Audit

**Audit Date:** September 30, 2026  
**Auditor:** Release Engineer & Marketplace Publishing Specialist  
**Target Release:** v0.2.4  

---

## 1. Verified Marketplace Technical Identity

The official published VS Code Marketplace technical identity of this extension is established as:

| Attribute | Published Marketplace Value | Invariant Rule |
| :--- | :--- | :--- |
| **Publisher ID** | `paladuguganeshnaidu` | **MUST NEVER CHANGE** |
| **Technical Extension Name** | `localforge-vscode` | **MUST NEVER CHANGE** |
| **Full Extension Unique Identifier** | `paladuguganeshnaidu.localforge-vscode` | **MUST NEVER CHANGE** |
| **Marketplace URL** | `https://marketplace.visualstudio.com/items?itemName=paladuguganeshnaidu.localforge-vscode` | Canonical listing location |
| **Latest Published Version** | `0.2.3` | Source of truth |
| **Next Update Version** | `0.2.4` | Strictly monotonic increment |
| **Previous Display Name** | `LocalForge: Local Copilot Agent` | Public-facing only |
| **New Public Display Name** | `LOMVREN` | Public-facing brand |
| **Publisher Display Name** | `paladuguganeshnaidu` | Verified publisher account |

---

## 2. Root Cause Analysis of Marketplace Upload Error

### The Failure Symptom
During Marketplace upload, the upload rejected with the error:
```text
The extension name supplied in the path 'localforge-vscode' must match the name supplied in the extension data 'lomvern-vscode'.
```

### Technical Root Cause
1. VS Code Marketplace identifies an extension uniquely by `<publisher>.<name>`.
2. When uploading an update to an existing extension (`paladuguganeshnaidu.localforge-vscode`), the Marketplace API endpoint route specifies `.../publishers/paladuguganeshnaidu/extensions/localforge-vscode/...`.
3. In a previous commit, the manifest file `package.json` had its `"name"` field changed to `"lomvern-vscode"`.
4. As a result, the packaged VSIX manifest declared its internal extension name as `lomvern-vscode`, creating a fatal conflict with the target extension identity `localforge-vscode`.
5. Additionally, the spelling in the user-provided brand is **LOMVREN** (not lomvern).

---

## 3. Mandatory Invariant Rules for Packaging

1. **`package.json` Manifest:**
   - `"name"` MUST strictly remain `"localforge-vscode"`.
   - `"publisher"` MUST strictly remain `"paladuguganeshnaidu"`.
   - `"displayName"` MUST be `"LOMVREN"`.
   - `"version"` MUST be `"0.2.4"`.
   - `"icon"` MUST point to `"media/lomvren-icon.png"`.

2. **Generated VSIX Package:**
   - The generated VSIX bundle filename produced by `@vscode/vsce package` is deterministically:
     `localforge-vscode-0.2.4.vsix`
   - Manual renaming of VSIX files is strictly prohibited.

3. **User-Facing Compatibility:**
   - Installed users of `paladuguganeshnaidu.localforge-vscode` receive version `0.2.4` automatically as a standard, seamless extension update.
   - All internal command identifiers (`localforge.*`) and configuration namespaces (`localforge.*`) remain 100% backward compatible without losing user preferences or state.
