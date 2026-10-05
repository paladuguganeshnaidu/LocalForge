const assert = require('node:assert/strict');
const { test } = require('node:test');
const { materializeFileContent } = require('../dist/agent/fileContent');

test('wrapped edit arguments retain indentation, exact replacement whitespace and final newlines', () => {
  const target = '    return value;\n';
  const replacement = '    return updated;\n\n';
  const turn = ToolCallParser.parse('', [{ function: { name: 'edit_workspace_file', arguments: { path: { value: ' test.py ' }, target_content: { value: target }, replacement_content: { value: replacement } } } }]);
  const raw = turn.toolCalls[0].function.arguments;
  const args = typeof raw === 'string' ? JSON.parse(raw) : raw;
  assert.equal(args.path, 'test.py');
  assert.equal(args.target_content, target);
  assert.equal(args.replacement_content, replacement);
});
const { ToolCallParser } = require('../dist/agent/toolCallParser');
const { validateGeneratedFile } = require('../dist/agent/generatedFileValidation');
const { formatToolOutput } = require('../dist/core/activityDetails');

test('typed JSON file arguments preserve nested strings/data without escaping or parser unwrapping corruption', () => {
  const json = { name: 'typed-project', content: 'literal \\n and "quotes"', path: 'data-not-a-tool-path', scripts: { build: 'node -e "console.log(1)"' }, nested: { values: [1, true, null] } };
  const parsed = ToolCallParser.parse('', [{ function: { name: 'create_file', arguments: { path: 'package.json', json } } }], new Set(['create_file']));
  const raw = parsed.toolCalls[0].function.arguments;
  const args = typeof raw === 'string' ? JSON.parse(raw) : raw;
  assert.deepEqual(args.json, json);
  const content = materializeFileContent(args);
  assert.deepEqual(JSON.parse(content), json);
  assert.equal(validateGeneratedFile('Build a website.', 'create_file', args), undefined);
  assert.equal(materializeFileContent({ path: 'source.js', content: 'const pattern="\\n";' }), 'const pattern="\\n";');
});

test('file writers reject missing, ambiguous, oversized or non-JSON typed data before edits', () => {
  assert.throws(() => materializeFileContent({ path: 'file.txt' }), /Provide complete file text/);
  assert.throws(() => materializeFileContent({ path: 'file.json', json: {}, content: '' }), /not both/);
  assert.throws(() => materializeFileContent({ path: 'file.py', json: {} }), /only available for .json/);
  assert.throws(() => materializeFileContent({ path: 'file.json', json: 'escaped string' }), /must be a JSON object/);
  assert.throws(() => materializeFileContent({ path: 'file.json', json: { text: 'x'.repeat(100) } }, 20), /limit/);
  assert.equal(materializeFileContent({ path: 'empty.txt', content: '' }), '');
  assert.match(validateGeneratedFile('Create a project.', 'create_file', { path: 'package.json', json: { scripts: { build: false } } }), /scripts must map/);
});

test('activity formatting preserves empty/normal arrays rather than rewriting them as object indices', () => {
  assert.equal(formatToolOutput([]), 'Result\n[]');
  assert.match(formatToolOutput([{ name: 'src', type: 'dir' }]), /^Result\n\[/);
  assert.match(formatToolOutput(Array.from({ length: 51 }, () => ({ name: 'file' }))), /showing 50 of 51/);
});
