/**
 * scripts/verify-marketplace-package.cjs
 *
 * Automated Quality Gate & Marketplace Packaging Assertion Script for TuxNest.
 * Enforces identity preservation, version alignment, and manifest consistency.
 */

const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const assert = require('assert');
const { createHash } = require('node:crypto');

const EXPECTED_IDENTITY = {
  name: 'tuxnest-vscode',
  publisher: 'tuxnest',
  displayName: 'TuxNest',
  icon: 'media/tuxnest-icon.png'
};

function verifyCurrentBuildPayload(pkgJson, vsixPkg, filesListing, rootDir, readEntry) {
  assert.deepStrictEqual(vsixPkg.contributes, pkgJson.contributes, 'FATAL: Packaged contributions differ from the current manifest');
  const browserPayload = pkgJson.dependencies?.['playwright-core'] ? ['node_modules/playwright-core/package.json', 'node_modules/playwright-core/index.js', 'node_modules/playwright-core/lib/bootstrap.js', 'node_modules/playwright-core/lib/coreBundle.js'] : [];
  for (const relativePath of [pkgJson.main.replace(/^\.\//, ''), pkgJson.icon, ...browserPayload]) {
    const entry = `extension/${relativePath}`;
    assert.strictEqual(filesListing.filter((file) => file === entry).length, 1, `FATAL: Duplicate or missing payload entry: ${entry}`);
    const packaged = readEntry(entry);
    const disk = fs.readFileSync(path.join(rootDir, relativePath));
    const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
    assert.strictEqual(digest(packaged), digest(disk), `FATAL: Packaged ${relativePath} does not match the current build`);
  }
}

function main() {
  console.log('=====================================================');
  console.log('  TuxNest VS Code Marketplace Release Verification');
  console.log('=====================================================\n');

  const rootDir = path.resolve(__dirname, '..');
  const pkgJsonPath = path.join(rootDir, 'package.json');

  if (!fs.existsSync(pkgJsonPath)) {
    throw new Error(`package.json not found at ${pkgJsonPath}`);
  }

  const pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'));

  console.log('[Step 1/6] Auditing workspace package.json metadata...');
  assert.strictEqual(
    pkgJson.name,
    EXPECTED_IDENTITY.name,
    `FATAL: package.json name must be '${EXPECTED_IDENTITY.name}', got '${pkgJson.name}'`
  );
  assert.strictEqual(
    pkgJson.publisher,
    EXPECTED_IDENTITY.publisher,
    `FATAL: package.json publisher must be '${EXPECTED_IDENTITY.publisher}', got '${pkgJson.publisher}'`
  );
  assert.strictEqual(
    pkgJson.displayName,
    EXPECTED_IDENTITY.displayName,
    `FATAL: package.json displayName must be '${EXPECTED_IDENTITY.displayName}', got '${pkgJson.displayName}'`
  );
  const lockJson = JSON.parse(fs.readFileSync(path.join(rootDir, 'package-lock.json'), 'utf8'));
  assert.strictEqual(lockJson.version, pkgJson.version, 'FATAL: package-lock.json version must match package.json');
  assert.strictEqual(lockJson.packages?.['']?.version, pkgJson.version, 'FATAL: package-lock root version must match package.json');
  console.log(`  ✓ Technical Name: ${pkgJson.name}`);
  console.log(`  ✓ Publisher:      ${pkgJson.publisher}`);
  console.log(`  ✓ Display Name:   ${pkgJson.displayName}`);
  console.log(`  ✓ Version:        ${pkgJson.version}`);

  console.log('\n[Step 2/6] Verifying icon asset on disk...');
  const iconRelPath = pkgJson.icon || EXPECTED_IDENTITY.icon;
  const iconDiskPath = path.join(rootDir, iconRelPath);
  assert.ok(fs.existsSync(iconDiskPath), `FATAL: Icon file does not exist at ${iconDiskPath}`);
  const iconStat = fs.statSync(iconDiskPath);
  assert.ok(iconStat.size > 1000, `FATAL: Icon file size is suspicious: ${iconStat.size} bytes`);
  const iconBuf = fs.readFileSync(iconDiskPath);
  const isPng = iconBuf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  assert.ok(isPng, `FATAL: Icon at ${iconRelPath} is not a valid PNG file!`);
  const width = iconBuf.readUInt32BE(16);
  const height = iconBuf.readUInt32BE(20);
  assert.ok(width >= 128 && height >= 128, `FATAL: Icon dimensions (${width}x${height}) must be at least 128x128`);
  console.log(`  ✓ Icon path:       ${iconRelPath} (${iconStat.size} bytes)`);
  console.log(`  ✓ Icon dimensions: ${width}x${height} (PNG format verified)`);

  console.log('\n[Step 3/6] Inspecting the selected VSIX artifact...');
  const expectedVsixName = `${EXPECTED_IDENTITY.name}-${pkgJson.version}.vsix`;
  const vsixPath = process.argv[2] ? path.resolve(process.argv[2]) : path.join(rootDir, expectedVsixName);
  assert.ok(
    fs.existsSync(vsixPath),
    `FATAL: Expected VSIX bundle '${expectedVsixName}' was not found at ${vsixPath}. Run packaging first.`
  );
  const vsixStat = fs.statSync(vsixPath);
  console.log(`  ✓ VSIX file: ${vsixPath} (${(vsixStat.size / (1024 * 1024)).toFixed(2)} MB)`);

  console.log('\n[Step 4/6] Extracting internal manifest from VSIX...');
  let vsixPkgRaw = '';
  try {
    vsixPkgRaw = cp.execFileSync('tar', ['-O', '-xf', vsixPath, 'extension/package.json'], {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe']
    });
  } catch (err) {
    throw new Error(`Failed to extract extension/package.json from ${expectedVsixName}: ${err.message}`);
  }

  const vsixPkg = JSON.parse(vsixPkgRaw);
  console.log(`  ✓ VSIX internal name:        ${vsixPkg.name}`);
  console.log(`  ✓ VSIX internal publisher:   ${vsixPkg.publisher}`);
  console.log(`  ✓ VSIX internal displayName: ${vsixPkg.displayName}`);
  console.log(`  ✓ VSIX internal version:     ${vsixPkg.version}`);

  console.log('\n[Step 5/6] Enforcing Release Invariant Assertions...');
  assert.strictEqual(
    vsixPkg.name,
    EXPECTED_IDENTITY.name,
    `Marketplace Invariant Violation: VSIX extension name must be '${EXPECTED_IDENTITY.name}'`
  );
  assert.strictEqual(
    vsixPkg.publisher,
    EXPECTED_IDENTITY.publisher,
    `Marketplace Invariant Violation: VSIX publisher must be '${EXPECTED_IDENTITY.publisher}'`
  );
  assert.strictEqual(
    vsixPkg.displayName,
    EXPECTED_IDENTITY.displayName,
    `Marketplace Invariant Violation: VSIX displayName must be '${EXPECTED_IDENTITY.displayName}'`
  );
  assert.strictEqual(
    vsixPkg.version,
    pkgJson.version,
    `Marketplace Invariant Violation: VSIX version (${vsixPkg.version}) must match package.json (${pkgJson.version})`
  );

  console.log('\n[Step 6/6] Verifying VSIX payload completeness...');
  const filesListing = cp.execFileSync('tar', ['-tf', vsixPath], { encoding: 'utf8' }).split(/\r?\n/);
  const bundledEntry = `extension/${pkgJson.main.replace(/^\.\//, '')}`;
  assert.ok(
    filesListing.includes(bundledEntry),
    `FATAL: VSIX is missing its bundled runtime entry: ${bundledEntry}`
  );
  assert.ok(
    filesListing.some((f) => f.includes('extension/package.json')),
    'FATAL: VSIX is missing extension/package.json'
  );
  assert.ok(
    filesListing.some((f) => f.includes(`extension/${iconRelPath}`)),
    `FATAL: VSIX is missing bundled icon: extension/${iconRelPath}`
  );
  assert.ok(
    !filesListing.some((file) => file.startsWith('extension/node_modules/') && !file.startsWith('extension/node_modules/playwright-core/')),
    'FATAL: VSIX contains runtime dependencies outside the explicitly required Playwright driver'
  );
  const packagedJavaScript = filesListing.filter((file) => /^extension\/dist\/.*\.js$/i.test(file));
  assert.deepStrictEqual(
    packagedJavaScript,
    [bundledEntry],
    `FATAL: VSIX must contain only its declared bundled runtime JavaScript file, got: ${packagedJavaScript.join(', ')}`
  );
  const forbiddenPayload = filesListing.filter((file) =>
    !file.startsWith('extension/node_modules/playwright-core/') && /(?:^|\/)(?:artifacts|coverage|docs|scripts|tests)\//i.test(file) ||
    /(?:test\.log|package-lock\.json|\.patch|\.zip)$/i.test(file)
  );
  assert.deepStrictEqual(
    forbiddenPayload,
    [],
    `FATAL: Development-only files leaked into VSIX: ${forbiddenPayload.join(', ')}`
  );
  verifyCurrentBuildPayload(pkgJson, vsixPkg, filesListing, rootDir, (entry) => cp.execFileSync('tar', ['-O', '-xf', vsixPath, entry], { maxBuffer: 16 * 1024 * 1024 }));
  console.log(`  ✓ Bundled runtime entry ${bundledEntry} is present`);
  if (pkgJson.dependencies?.['playwright-core']) {
    for (const entry of ['extension/node_modules/playwright-core/package.json', 'extension/node_modules/playwright-core/index.js', 'extension/node_modules/playwright-core/lib/bootstrap.js', 'extension/node_modules/playwright-core/lib/coreBundle.js']) assert.ok(filesListing.includes(entry), `FATAL: Browser driver is missing: ${entry}`);
    const driver = JSON.parse(cp.execFileSync('tar', ['-O', '-xf', vsixPath, 'extension/node_modules/playwright-core/package.json'], { encoding: 'utf8' }));
    assert.strictEqual(driver.version, pkgJson.dependencies['playwright-core'], 'FATAL: Browser driver version does not match the exact runtime dependency');
  }
  console.log('  ✓ Only the declared browser driver is allowed outside the bundle');
  console.log('  ✓ extension/package.json is present');
  console.log(`  ✓ extension/${iconRelPath} is present`);
  console.log('  ✓ Development reports, test artifacts, logs, and lockfile are excluded');
  console.log('  ✓ Packaged runtime, icon and contributions match the current build');

  console.log('\n=====================================================');
  console.log('  PACKAGE IDENTITY AND CONTENT CHECKS PASSED');
  console.log('  This check does not certify Marketplace or production approval.');
  console.log('=====================================================\n');
}

module.exports = { verifyCurrentBuildPayload };

if (require.main === module) {
  try { main(); }
  catch (err) {
    console.error('\n❌ RELEASE VERIFICATION FAILED:');
    console.error(err.message || err);
    process.exitCode = 1;
  }
}
