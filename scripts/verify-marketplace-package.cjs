/**
 * scripts/verify-marketplace-package.cjs
 *
 * Automated Quality Gate & Marketplace Packaging Assertion Script for LOMVREN.
 * Enforces identity preservation, version alignment, and manifest consistency.
 */

const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const assert = require('assert');

const EXPECTED_IDENTITY = {
  name: 'localforge-vscode',
  publisher: 'paladuguganeshnaidu',
  displayName: 'LOMVREN',
  version: '0.2.4',
  icon: 'media/lomvren-icon.png'
};

function main() {
  console.log('=====================================================');
  console.log('  LOMVREN VS Code Marketplace Release Verification');
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
  assert.strictEqual(
    pkgJson.version,
    EXPECTED_IDENTITY.version,
    `FATAL: package.json version must be '${EXPECTED_IDENTITY.version}', got '${pkgJson.version}'`
  );
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

  console.log('\n[Step 3/6] Inspecting generated VSIX artifact in workspace...');
  const expectedVsixName = `${EXPECTED_IDENTITY.name}-${EXPECTED_IDENTITY.version}.vsix`;
  const vsixPath = path.join(rootDir, expectedVsixName);
  assert.ok(
    fs.existsSync(vsixPath),
    `FATAL: Expected VSIX bundle '${expectedVsixName}' was not found at ${vsixPath}. Run packaging first.`
  );
  const vsixStat = fs.statSync(vsixPath);
  console.log(`  ✓ VSIX file: ${expectedVsixName} (${(vsixStat.size / (1024 * 1024)).toFixed(2)} MB)`);

  console.log('\n[Step 4/6] Extracting internal manifest from VSIX...');
  let vsixPkgRaw = '';
  try {
    vsixPkgRaw = cp.execSync(`tar -O -xf "${vsixPath}" extension/package.json`, {
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
  const filesListing = cp.execSync(`tar -tf "${vsixPath}"`, { encoding: 'utf8' }).split(/\r?\n/);
  assert.ok(
    filesListing.some((f) => f.includes('extension/dist/extension.js')),
    'FATAL: VSIX is missing extension/dist/extension.js'
  );
  assert.ok(
    filesListing.some((f) => f.includes('extension/package.json')),
    'FATAL: VSIX is missing extension/package.json'
  );
  assert.ok(
    filesListing.some((f) => f.includes(`extension/${iconRelPath}`)),
    `FATAL: VSIX is missing bundled icon: extension/${iconRelPath}`
  );
  console.log('  ✓ extension/dist/extension.js is present');
  console.log('  ✓ extension/package.json is present');
  console.log(`  ✓ extension/${iconRelPath} is present`);

  console.log('\n=====================================================');
  console.log('  ALL RELEASE GATE ASSERTIONS PASSED (100% GREEN)');
  console.log('  Package is ready for VS Code Marketplace upload.');
  console.log('=====================================================\n');
}

try {
  main();
} catch (err) {
  console.error('\n❌ RELEASE VERIFICATION FAILED:');
  console.error(err.message || err);
  process.exit(1);
}
