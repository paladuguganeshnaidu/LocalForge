# TuxNest v1.0.0 Release Package

**Artifact**: `tuxnest-vscode-1.0.0.vsix`  
**Publisher**: `tuxnest`  
**Extension ID**: `tuxnest.tuxnest-vscode`  
**Display Name**: `TuxNest`  
**SHA-256**: `a8192463ffdb3d9e04b377181553f4c43ce0fed71ca946ac8cd309dd80ad8d65`  

## Installation Instructions

### Via VS Code CLI:
```bash
code --install-extension releases/v1.0.0/tuxnest-vscode-1.0.0.vsix
```

### Via VS Code UI:
1. Open Visual Studio Code.
2. Go to the **Extensions** view (`Ctrl+Shift+X` or `Cmd+Shift+X`).
3. Click the `...` (Views and More Actions) menu in the top-right corner of the Extensions pane.
4. Select **Install from VSIX...**
5. Choose `releases/v1.0.0/tuxnest-vscode-1.0.0.vsix`.

## Integrity Verification
Verify the SHA-256 checksum prior to installation:
```bash
# Windows PowerShell
Get-FileHash ./tuxnest-vscode-1.0.0.vsix -Algorithm SHA256

# Linux / macOS
sha256sum tuxnest-vscode-1.0.0.vsix
```
Expected output:
`a8192463ffdb3d9e04b377181553f4c43ce0fed71ca946ac8cd309dd80ad8d65`
