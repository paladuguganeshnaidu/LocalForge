const fs = require('node:fs');
const path = require('node:path');
const yauzl = require('yauzl');

const root = process.cwd();
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const vsix = path.join(root, manifest.name + '-' + manifest.version + '.vsix');
if (!fs.existsSync(vsix)) throw new Error('VSIX not found: ' + vsix);

const maxBytes = 8 * 1024 * 1024;
const size = fs.statSync(vsix).size;
if (size > maxBytes) throw new Error('VSIX exceeds 8 MiB package-size gate: ' + size);

function readZipEntries(zipPath) {
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true }, (err, zip) => {
      if (err) return reject(err);
      const entries = [];
      zip.readEntry();
      zip.on('entry', (entry) => {
        entries.push(entry.fileName);
        zip.readEntry();
      });
      zip.on('end', () => zip.close(() => resolve(entries)));
      zip.on('error', reject);
    });
  });
}

(async () => {
  const listing = await readZipEntries(vsix);

  const forbidden = [
    /(^|[\\/])\.env(?:\.|$)/i,
    /(^|[\\/])(?:id_rsa|id_ed25519)(?:$|\.)/i,
    /(^|[\\/])\.git(?:[\\/]|$)/i,
    /(^|[\\/])(?:scratch|\.agents|\.vscode-test)(?:[\\/]|$)/i,
    /(^|[\\/])(?:tests?)(?:[\\/]|$)/i,
    /(^|[\\/]).*\.vsix$/i,
    /(^|[\\/])node_modules(?:[\\/]|$)/i
  ];

  for (const candidate of listing) {
    if (!candidate) continue;
    if (forbidden.some((pattern) => pattern.test(candidate))) {
      throw new Error('Forbidden package payload entry: ' + candidate);
    }
  }

  const hasManifest = listing.includes('extension/package.json');
  const hasExtension = listing.includes('extension/dist/extension.js');
  if (!hasManifest || !hasExtension) {
    throw new Error('VSIX is missing required runtime payload entries.');
  }

  console.log(JSON.stringify({
    file: path.basename(vsix),
    sizeBytes: size,
    sizeMiB: Number((size / 1024 / 1024).toFixed(3)),
    maxBytes,
    fileCount: listing.length,
    gate: 'PASS'
  }, null, 2));
})().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exit(1);
});
