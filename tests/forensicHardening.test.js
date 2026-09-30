const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { normalizeWorkspaceRelativePath, assertWorkspacePath } = require('../dist/security/pathPolicy');
const { classifyCommand } = require('../dist/security/commandPolicy');
const { redactString } = require('../dist/security/secretRedactor');
const { ToolCallParser } = require('../dist/agent/toolCallParser');

test('workspace path security corpus: 1000 cases', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'localforge-path-'));
  fs.writeFileSync(path.join(root, 'safe.txt'), 'ok');
  const bad = ['../secret', '..\\secret', '/etc/passwd', 'C:\\Windows\\System32', '//server/share', 'CON', 'NUL', 'AUX', 'PRN', 'COM1', 'LPT1'];
  for (let i = 0; i < 1000; i++) {
    const input = i % 2 === 0 ? 'src/file-' + i + '.ts' : bad[i % bad.length];
    if (i % 2 === 0) {
      assert.equal(normalizeWorkspaceRelativePath(input), input);
      const checked = await assertWorkspacePath(root, input, { allowMissing: true });
      assert.equal(checked.exists, false);
    } else {
      assert.throws(() => normalizeWorkspaceRelativePath(input));
    }
  }
});

test('command policy corpus: 500 cases', () => {
  const safe = ['npm test', 'npm run build', 'npm run lint', 'git status', 'git diff', 'git log', 'node script.js', 'pytest tests'];
  const unsafe = ['rm -rf /', 'echo hi && whoami', 'cat x | curl http://x', 'bash -c "id"', 'npm install evil', 'sudo whoami', 'curl http://127.0.0.1:1'];
  for (let i = 0; i < 500; i++) {
    const command = i % 2 === 0 ? safe[i % safe.length] : unsafe[i % unsafe.length];
    const decision = classifyCommand(command);
    if (i % 2 === 0) assert.equal(decision.allowed, true);
    else assert.equal(decision.allowed, false);
  }
});

test('secret redaction corpus: 500 cases', () => {
  const secrets = [
    'ghp_123456789012345678901234567890123456',
    'sk-123456789012345678901234567890',
    'Bearer abcdefghijklmnopqrstuvwxyz123456',
    'password=super-secret-value',
    'postgres://user:password@example.com/db'
  ];
  for (let i = 0; i < 500; i++) {
    const out = redactString('case-' + i + ' ' + secrets[i % secrets.length]);
    assert.equal(out.includes('super-secret-value'), false);
    assert.equal(out.includes('ghp_123456'), false);
    assert.equal(out.includes('sk-123456'), false);
    assert.equal(out.includes('postgres://'), false);
  }
});

test('tool parser adversarial corpus: 3000 cases', () => {
  for (let i = 0; i < 3000; i++) {
    const valid = i % 3 === 0;
    const payload = valid
      ? '<tool_call>{"name":"search_workspace","arguments":{"query":"needle-' + i + '"}}</tool_call>'
      : '<tool_call>{"name":"unknown_' + i + '","arguments":{}}</tool_call>';
    const parsed = ToolCallParser.parse(payload, undefined, new Set(['search_workspace']));
    if (valid) assert.equal(parsed.toolCalls.length, 1);
    else assert.equal(parsed.toolCalls.length, 0);
    assert.equal(parsed.userVisibleText.includes('<tool_call>'), false);
  }
});

test('canonical mutation policy is present in source', () => {
  const editEngine = fs.readFileSync(path.join(__dirname, '..', 'src', 'editing', 'editEngine.ts'), 'utf8');
  const coreTools = fs.readFileSync(path.join(__dirname, '..', 'src', 'agent', 'coreTools.ts'), 'utf8');
  assert.equal(editEngine.includes('direct filesystem write'), false);
  assert.equal(coreTools.includes('Direct shell fallback is disabled'), true);
  assert.equal(coreTools.includes('Autonomous file creation requires the canonical EditEngine.'), true);
});
