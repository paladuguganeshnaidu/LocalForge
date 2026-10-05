# TuxNest Releases

All packaged VSIX extension artifacts for TuxNest are structured here by release version.

## Directory Structure

```
releases/
├── v1.0.0/                             # Canonical v1.0.0 Production Release
│   ├── tuxnest-vscode-1.0.0.vsix      # Packaged VS Code extension
│   ├── checksums.sha256               # Cryptographic SHA-256 verification hash
│   ├── metadata.json                  # Release metadata & Marketplace validation record
│   └── README.md                      # Installation & verification instructions
├── archive/                           # Legacy and pre-1.0.0 development builds
│   └── localforge-vscode-*.vsix       # Archived historical builds (v0.1.x - v0.3.x)
└── README.md                          # This release directory index
```

## Current Release: TuxNest v1.0.0

| Attribute | Details |
| :--- | :--- |
| **Package** | [tuxnest-vscode-1.0.0.vsix](v1.0.0/tuxnest-vscode-1.0.0.vsix) |
| **Version** | `1.0.0` |
| **Publisher** | `tuxnest` |
| **Extension ID** | `tuxnest.tuxnest-vscode` |
| **Display Name** | `TuxNest` |
| **SHA-256** | `a8192463ffdb3d9e04b377181553f4c43ce0fed71ca946ac8cd309dd80ad8d65` |
| **Documentation** | [Release Notes](../release-notes/RELEASE_NOTES_v1.0.0.md) |

### Installation

```bash
code --install-extension releases/v1.0.0/tuxnest-vscode-1.0.0.vsix
```

### Verification

```bash
# Windows PowerShell
Get-FileHash releases/v1.0.0/tuxnest-vscode-1.0.0.vsix -Algorithm SHA256

# Linux / macOS
sha256sum releases/v1.0.0/tuxnest-vscode-1.0.0.vsix
```
Expected hash:
```
a8192463ffdb3d9e04b377181553f4c43ce0fed71ca946ac8cd309dd80ad8d65
```
