const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

function planPackage(root, requestedOutput) {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  if (!/^[a-z0-9-]+$/.test(manifest.name) || !/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(manifest.version)) throw new Error('Package identity/version must be a valid filename-safe extension identity.');
  const output = path.resolve(root, requestedOutput || `${manifest.name}-${manifest.version}.vsix`);
  const relative = path.relative(path.resolve(root), output);
  if (relative.startsWith('..') || path.isAbsolute(relative) || !output.endsWith('.vsix')) throw new Error('Choose a .vsix output inside the project.');
  if (fs.existsSync(output)) throw new Error(`Refusing to overwrite preserved artifact: ${output}. Use npm run package -- <new-development-filename.vsix>.`);
  return output;
}

function main() {
  const root = path.resolve(__dirname, '..');
  const output = planPackage(root, process.argv[2]);
  execFileSync(process.execPath, [path.join(root, 'node_modules/@vscode/vsce/vsce'), 'package', '--out', output], { cwd: root, stdio: 'inherit', windowsHide: true });
  execFileSync(process.execPath, [path.join(root, 'scripts/verify-marketplace-package.cjs'), output], { cwd: root, stdio: 'inherit', windowsHide: true });
}

module.exports = { planPackage };
if (require.main === module) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
