# Brand Migration: LocalForge to LOMVREN

**Document Version:** 1.0  
**Effective Release:** v0.2.4  
**Date:** September 30, 2026  

---

## Executive Summary

The project **LocalForge** is officially rebranded publicly as **LOMVREN**.

To protect existing users, preserve Marketplace review ratings, and avoid breaking installations or requiring manual re-installation, this brand migration separates **public presentation** from **technical identity** in accordance with official VS Code extension manifest guidelines.

---

## Identity Mapping

| Domain | Prior State | Rebranded State (v0.2.4+) | Rationale |
| :--- | :--- | :--- | :--- |
| **Public Product Brand** | LocalForge | **LOMVREN** | New product brand identity |
| **Marketplace Display Name** | `LocalForge: Local Copilot Agent` | **`LOMVREN`** | Primary heading in VS Code Marketplace |
| **Technical Extension Name** | `localforge-vscode` | **`localforge-vscode`** | **Preserved**. Defines technical identity `<publisher>.<name>` |
| **Publisher ID** | `paladuguganeshnaidu` | **`paladuguganeshnaidu`** | **Preserved**. Verified Marketplace publisher |
| **Full Technical Extension ID** | `paladuguganeshnaidu.localforge-vscode` | **`paladuguganeshnaidu.localforge-vscode`** | Guarantees automatic in-place update for installed users |
| **VSIX Package Name** | `localforge-vscode-0.2.3.vsix` | **`localforge-vscode-0.2.4.vsix`** | Matches technical name + version |
| **Official Marketplace Icon** | `media/localforge-marketplace-icon.png` | **`media/lomvren-icon.png`** | New high-resolution brand logo |
| **Visual Palette** | Slate / Blue | **Deep Forest Green, Sage Green, Warm Off-White** | ClinchWorks-inspired design palette |
| **Command Palette Prefix** | `LocalForge: <Command>` | **`LOMVREN: <Command>`** | All command labels updated to LOMVREN |
| **Secondary Sidebar Title** | `LocalForge` | **`LOMVREN`** | Title displayed in secondary sidebar icon |
| **View Name** | `LocalForge Agent` | **`LOMVREN Agent`** | Title in view header |
| **Settings Title** | `LocalForge` | **`LOMVREN`** | Section header in VS Code Settings UI |

---

## Backward Compatibility Guarantees

1. **Settings Preservation:**
   - Configuration properties remain under the `localforge.*` namespace (e.g., `localforge.ollama.baseUrl`, `localforge.autocomplete.enabled`).
   - Existing users retain all configured model routes and endpoints without migration scripts or loss of settings.

2. **Storage and Session Preservation:**
   - Workspace state and secret storage keys remain under their existing namespace.
   - Ongoing conversations and checkpoints remain intact across the upgrade.

3. **Keybinding and Script Compatibility:**
   - Command IDs remain `localforge.openAgent`, `localforge.diagnose`, `localforge.doctor`, etc., ensuring that user custom keybindings and shell scripts continue to function without disruption.

4. **Historical Continuity:**
   - Historical release notes (`RELEASE_NOTES_0.1.7.md` through `RELEASE_NOTES_0.2.3.md`) are preserved for auditability and historical tracking.
   - Public documentation prominently notes: *"LOMVREN was previously published as LocalForge."*
