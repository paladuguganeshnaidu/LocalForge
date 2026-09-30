const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = process.cwd();
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const vsix = path.join(root, manifest.name + '-' + manifest.version + '.vsix');
if (!fs.existsSync(vsix)) throw new Error('VSIX not found: ' + vsix);

const maxBytes = 8 * 1024 * 1024;
const size = fs.statSync(vsix).size;
if (size > maxBytes) throw new Error('VSIX exceeds 8 MiB package-size gate: ' + size);

const listing = execFileSync(process.platform === 'win32' ? 'npx.cmd' : 'npx',
  ['--no-install', 'vsce', 'ls', '--tree'], { cwd: root, encoding: 'utf8' });

const forbidden = [
  /(^|\/)\.env(?:\.|$)/i,
  /(^|\/)(?:id_rsa|id_ed25519)(?:$|\.)/i,
  /(^|\/)\.git(?:\/|$)/i,
  /(^|\/)(?:scratch|\.agents|\.vscode-test)(?:\/|$)/i,
  /(^|\/)(?:tests?)(?:\/|$)/i,
  /(^|\/).*\.vsix$/i
];

for (const line of listing.split(/\r?\n/)) {
  const candidate = line.trim();
  if (!candidate) continue;
  if (forbidden.some((pattern) => pattern.test(candidate))) {
    throw new Error('Forbidden package payload entry: ' + candidate);
  }
}

console.log(JSON.stringify({
  file: path.basename(vsix),
  sizeBytes: size,
  sizeMiB: Number((size / 1024 / 1024).toFixed(3)),
  maxBytes,
  gate: 'PASS'
}, null, 2));
