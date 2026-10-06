const fs = require('fs');
const path = require('path');

function scanIdentityDrift() {
  const root = path.resolve(__dirname, '..');
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf-8'));

  const findings = [];

  // 1. Check package manifest identity
  if (pkg.name !== 'tuxnest-vscode') {
    findings.push(`package.json name should be 'tuxnest-vscode', found '${pkg.name}'`);
  }
  if (pkg.displayName !== 'TuxNest') {
    findings.push(`package.json displayName should be 'TuxNest', found '${pkg.displayName}'`);
  }
  if (pkg.publisher !== 'tuxnest') {
    findings.push(`package.json publisher should be 'tuxnest', found '${pkg.publisher}'`);
  }

  // 2. Check activation commands all start with tuxnest.
  for (const cmd of pkg.contributes?.commands || []) {
    if (!cmd.command.startsWith('tuxnest.')) {
      findings.push(`Command "${cmd.command}" does not use canonical 'tuxnest.' namespace.`);
    }
  }

  return {
    passed: findings.length === 0,
    findings
  };
}

if (require.main === module) {
  const res = scanIdentityDrift();
  if (!res.passed) {
    console.error('Identity drift scanner detected issues:');
    for (const f of res.findings) console.error(`- ${f}`);
    process.exit(1);
  } else {
    console.log('Identity drift scan passed: Package and commands adhere to canonical TuxNest identity.');
    process.exit(0);
  }
}

module.exports = { scanIdentityDrift };
