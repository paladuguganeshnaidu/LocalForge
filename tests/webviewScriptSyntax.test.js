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

  // 2. Syntax validity is asserted in webviewRenderedScript.test.js against the
  // RENDERED html. The raw .ts text is a template literal, so running node --check
  // on it here validates the wrong string (escapes like \\n and \\' are consumed at
  // render time) and previously let a fatal webview syntax error ship.
});
