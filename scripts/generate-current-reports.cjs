const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');

const root = process.cwd();
const outDir = path.join(root, 'docs', 'test-results');
fs.mkdirSync(outDir, { recursive: true });

function sha() {
  try { return cp.execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(); }
  catch { return 'unknown'; }
}
function pkg() {
  try { return JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')); }
  catch { return {}; }
}
function parseCounts(text) {
  const passed = Number((text.match(/(?:tests? )?(\d+) pass(?:ed)?/i) || [])[1] || 0);
  const failed = Number((text.match(/(?:tests? )?(\d+) fail(?:ed)?/i) || [])[1] || 0);
  const skipped = Number((text.match(/(\d+) skipped/i) || [])[1] || 0);
  const cancelled = Number((text.match(/(\d+) cancelled/i) || [])[1] || 0);
  return { passed, failed, skipped, cancelled };
}
const logPath = process.argv[2] || process.env.LOCALFORGE_TEST_LOG;
const log = logPath && fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf8') : '';
const counts = parseCounts(log);
const packageJson = pkg();
const timestamp = new Date().toISOString();
const base = [
  '# Current Test Report',
  '',
  '- Timestamp: ' + timestamp,
  '- Commit SHA: ' + sha(),
  '- Package: ' + packageJson.name + '@' + packageJson.version,
  '- Environment: ' + process.platform + ' / Node ' + process.version,
  '- Source log: ' + (logPath || 'not supplied'),
  '',
  '## Counts',
  '',
  '- Passed: ' + counts.passed,
  '- Failed: ' + counts.failed,
  '- Skipped: ' + counts.skipped,
  '- Cancelled: ' + counts.cancelled,
  '',
  '## Evidence',
  '',
  log ? 'Test output was supplied by the execution environment.' : 'No execution log was supplied; no pass claim is made.',
  ''
].join('\n');

fs.writeFileSync(path.join(outDir, 'CURRENT_TEST_REPORT.md'), base);
fs.writeFileSync(path.join(outDir, 'CURRENT_SECURITY_REPORT.md'), [
  '# Current Security Report','',
  '- Timestamp: ' + timestamp,
  '- Commit SHA: ' + sha(),
  '',
  'Security report is evidence-driven. Automated command/path/redaction corpora are reported from the CI test run; live remote/SSH/browser acceptance must be recorded separately.',
  ''
].join('\n'));
fs.writeFileSync(path.join(outDir, 'CURRENT_PERFORMANCE_REPORT.md'), [
  '# Current Performance Report','',
  '- Timestamp: ' + timestamp,
  '- Commit SHA: ' + sha(),
  '',
  'No performance pass is asserted unless a measured soak run is supplied.',
  ''
].join('\n'));
fs.writeFileSync(path.join(outDir, 'CURRENT_PACKAGE_REPORT.md'), [
  '# Current Package Report','',
  '- Timestamp: ' + timestamp,
  '- Commit SHA: ' + sha(),
  '- VSIX: ' + (packageJson.name || 'unknown') + '-' + (packageJson.version || 'unknown') + '.vsix',
  '',
  'Run scripts/verify-package-size.cjs for package-size and payload evidence.',
  ''
].join('\n'));
