const fs = require('fs');
const path = require('path');
const cp = require('child_process');

const targetDir = path.join(process.env.USERPROFILE, '.vscode', 'extensions', 'paladuguganeshnaidu.localforge-vscode-0.2.4');
console.log('Target directory:', targetDir);

if (fs.existsSync(targetDir)) {
  fs.rmSync(targetDir, { recursive: true, force: true });
}
fs.mkdirSync(targetDir, { recursive: true });

cp.execSync(`tar -xf localforge-vscode-0.2.4.vsix --strip-components=1 -C "${targetDir}" extension`, {
  stdio: 'inherit'
});

// Also remove stale lomvern-vscode folder if present
const staleDir = path.join(process.env.USERPROFILE, '.vscode', 'extensions', 'paladuguganeshnaidu.lomvern-vscode-0.2.4');
if (fs.existsSync(staleDir)) {
  fs.rmSync(staleDir, { recursive: true, force: true });
}

console.log('Successfully installed paladuguganeshnaidu.localforge-vscode-0.2.4 locally.');
