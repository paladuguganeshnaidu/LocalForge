const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function verifyReleasePipeline() {
  const root = path.resolve(__dirname, '..');
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf-8'));

  const errors = [];

  // 1. Check required icons and manifests
  const requiredFiles = [
    'package.json',
    'README.md',
    'LICENSE',
    'media/tuxnest-icon.png',
    'media/tuxnest.svg'
  ];

  for (const rel of requiredFiles) {
    if (!fs.existsSync(path.join(root, rel))) {
      errors.push(`Missing mandatory release file: "${rel}"`);
    }
  }

  // 2. Generate CycloneDX-compatible SBOM
  const distDir = path.join(root, 'dist');
  if (!fs.existsSync(distDir)) {
    fs.mkdirSync(distDir, { recursive: true });
  }

  const sbom = {
    bomFormat: 'CycloneDX',
    specVersion: '1.5',
    serialNumber: `urn:uuid:${crypto.randomUUID()}`,
    version: 1,
    metadata: {
      timestamp: new Date().toISOString(),
      component: {
        name: pkg.name,
        version: pkg.version,
        type: 'application',
        licenses: [{ license: { id: pkg.license } }]
      }
    },
    components: Object.entries(pkg.dependencies || {}).map(([dep, ver]) => ({
      name: dep,
      version: ver,
      type: 'library'
    }))
  };

  const sbomPath = path.join(distDir, 'sbom.json');
  fs.writeFileSync(sbomPath, JSON.stringify(sbom, null, 2), 'utf-8');

  // 3. Compute bundle checksum if dist/extension.bundle.js exists
  let bundleHash = null;
  const bundlePath = path.join(distDir, 'extension.bundle.js');
  if (fs.existsSync(bundlePath)) {
    const bundleContent = fs.readFileSync(bundlePath);
    bundleHash = crypto.createHash('sha256').update(bundleContent).digest('hex');
  }

  return {
    passed: errors.length === 0,
    errors,
    sbomGenerated: true,
    bundleHash
  };
}

if (require.main === module) {
  const res = verifyReleasePipeline();
  if (!res.passed) {
    console.error('Release pipeline verification failed:');
    for (const e of res.errors) console.error(`- ${e}`);
    process.exit(1);
  } else {
    console.log(`Release pipeline verification passed. SBOM generated. Bundle SHA256: ${res.bundleHash ?? 'N/A'}`);
    process.exit(0);
  }
}

module.exports = { verifyReleasePipeline };
