const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');

test('webview script contains 100% valid browser JavaScript without TypeScript syntax', () => {
  const chatViewSrc = fs.readFileSync(path.join(__dirname, '../src/ui/chatView.ts'), 'utf8');
  
  // Extract content between <script nonce="${nonce}"> and </script>
  const scriptRegex = /<script\b[^>]*>([\s\S]*?)<\/script>/i;
  const match = chatViewSrc.match(scriptRegex);
  assert.ok(match, 'chatView.ts must contain an inline <script> block');

  const scriptContent = match[1];

  // 1. Explicitly check for forbidden TypeScript type assertions
  assert.strictEqual(
    scriptContent.includes('as any'),
    false,
    'Webview script must NOT contain TypeScript "as any" syntax'
  );
  assert.strictEqual(
    scriptContent.includes('as unknown'),
    false,
    'Webview script must NOT contain TypeScript "as unknown" syntax'
  );

  // 2. Write to a temporary file and run node --check
  const tempScriptPath = path.join(__dirname, 'temp_webview_extracted.js');
  try {
    fs.writeFileSync(tempScriptPath, scriptContent, 'utf8');
    const result = cp.spawnSync(process.execPath, ['--check', tempScriptPath], {
      encoding: 'utf8'
    });

    if (result.status !== 0) {
      assert.fail(`Webview JavaScript syntax error:\n${result.stderr || result.stdout}`);
    }
  } finally {
    if (fs.existsSync(tempScriptPath)) {
      fs.unlinkSync(tempScriptPath);
    }
  }
});
