const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ToolCallParser } = require('../dist/agent/toolCallParser');
const { VisibleTextStream } = require('../dist/agent/visibleTextStream');

test('package manifests and named JSON data in answers are not mistaken for tool calls', () => {
  const text = 'Example:\n```json\n{"name":"my-node-app","scripts":{"test":"node test.js"}}\n```\n{"name":"Alice","age":30}';
  const parsed = ToolCallParser.parse(text, undefined, new Set(['read_file']));
  assert.deepEqual(parsed.toolCalls, []);
  assert.match(parsed.userVisibleText, /my-node-app/);
  assert.match(parsed.userVisibleText, /Alice/);
});

test('directory aliases retain the exact requested path rather than becoming workspace root', () => {
  const parsed = ToolCallParser.parse('', [{ id: 'directory', function: { name: 'list_directory', arguments: { directory: 'premium-genai/books/html/phase_03.html' } } }], new Set(['list_directory']));
  assert.deepEqual(JSON.parse(parsed.toolCalls[0].function.arguments), { path: 'premium-genai/books/html/phase_03.html' });
});

test('ToolCallParser parses native tool calls and strips hidden reasoning', () => {
  const rawText = '<think>I need to read the file first</think>I will read the file.';
  const nativeCalls = [
    {
      id: 'call-1',
      type: 'function',
      function: {
        name: 'read_workspace_file',
        arguments: JSON.stringify({ path: 'src/app.ts' })
      }
    }
  ];

  const parsed = ToolCallParser.parse(rawText, nativeCalls, new Set(['read_workspace_file']));

  assert.equal(parsed.hadToolCallSyntax, true);
  assert.equal(parsed.toolCalls.length, 1);
  assert.equal(parsed.toolCalls[0].function.name, 'read_workspace_file');
  assert.deepEqual(JSON.parse(parsed.toolCalls[0].function.arguments), { path: 'src/app.ts' });
  assert.equal(parsed.userVisibleText, 'I will read the file.');
  assert.ok(!parsed.userVisibleText.includes('<think>'));
});

test('ToolCallParser normalizes file_path in native workspace write calls', () => {
  const parsed = ToolCallParser.parse('', [{
    id: 'call-file-path',
    type: 'function',
    function: {
      name: 'write_workspace_file',
      arguments: JSON.stringify({ file_path: 'src/app.ts', content: 'updated' })
    }
  }], new Set(['write_workspace_file']));

  assert.deepEqual(JSON.parse(parsed.toolCalls[0].function.arguments), {
    file_path: 'src/app.ts',
    path: 'src/app.ts',
    content: 'updated'
  });
});

test('ToolCallParser normalizes target_path and target_content in native workspace write calls', () => {
  const parsed = ToolCallParser.parse('', [{
    id: 'call-target-aliases',
    type: 'function',
    function: {
      name: 'write_workspace_file',
      arguments: JSON.stringify({ target_path: 'src/result.ts', target_content: 'generated content' })
    }
  }], new Set(['write_workspace_file']));

  assert.deepEqual(JSON.parse(parsed.toolCalls[0].function.arguments), {
    target_path: 'src/result.ts',
    target_content: 'generated content',
    path: 'src/result.ts',
    content: 'generated content'
  });
});

test('ToolCallParser normalizes relative_path in native workspace write calls', () => {
  const parsed = ToolCallParser.parse('', [{
    id: 'call-relative-path',
    type: 'function',
    function: {
      name: 'write_workspace_file',
      arguments: JSON.stringify({ workspace: '.', relative_path: 'src/result.ts', content: 'generated content' })
    }
  }], new Set(['write_workspace_file']));

  assert.equal(JSON.parse(parsed.toolCalls[0].function.arguments).path, 'src/result.ts');
});

test('VisibleTextStream withholds hidden reasoning, tool protocols, and raw tool JSON', () => {
  const updates = [];
  const stream = new VisibleTextStream((text) => updates.push(text));
  stream.push('Checking files. ');
  stream.push('<think>private reasoning');
  assert.deepEqual(updates, ['Checking files.']);
  stream.push('</think> continuing ');
  stream.push('LOCALFORGE_TOOL_CALL: {"tool":"run_command","arguments":{"command":"SECRET_COMMAND"}}');
  stream.push(' finished');
  stream.finish(ToolCallParser.parse(
    'Checking files. <think>private reasoning</think> continuing LOCALFORGE_TOOL_CALL: {"tool":"run_command","arguments":{"command":"SECRET_COMMAND"}} finished',
    undefined,
    new Set(['run_command'])
  ).userVisibleText);

  const output = updates.join('');
  assert.match(output, /Checking files\./);
  assert.match(output, /continuing/);
  assert.match(output, /finished/);
  assert.doesNotMatch(output, /private reasoning|LOCALFORGE_TOOL_CALL|SECRET_COMMAND/);
});

test('ToolCallParser extracts <tool_call> XML blocks and strips them from userVisibleText', () => {
  const content = 'Checking workspace.\n<tool_call>{"name": "search_workspace", "arguments": {"query": "auth"}}</tool_call>\nPlease wait.';
  const parsed = ToolCallParser.parse(content, undefined, new Set(['search_workspace']));

  assert.equal(parsed.hadToolCallSyntax, true);
  assert.equal(parsed.toolCalls.length, 1);
  assert.equal(parsed.toolCalls[0].function.name, 'search_workspace');
  assert.deepEqual(JSON.parse(parsed.toolCalls[0].function.arguments), { query: 'auth' });
  assert.ok(!parsed.userVisibleText.includes('search_workspace'));
  assert.ok(!parsed.userVisibleText.includes('<tool_call>'));
  assert.ok(parsed.userVisibleText.includes('Checking workspace.'));
});

test('ToolCallParser parses plain JSON tool call objects without tags', () => {
  const content = 'I will inspect the file.\n{"name": "read_workspace_file", "arguments": {"path": "src/app.js"}}';
  const parsed = ToolCallParser.parse(content, undefined, new Set(['read_workspace_file']));

  assert.equal(parsed.hadToolCallSyntax, true);
  assert.equal(parsed.toolCalls.length, 1);
  assert.equal(parsed.toolCalls[0].function.name, 'read_workspace_file');
  assert.deepEqual(JSON.parse(parsed.toolCalls[0].function.arguments), { path: 'src/app.js' });
  assert.equal(parsed.userVisibleText, 'I will inspect the file.');
  assert.ok(!parsed.userVisibleText.includes('{"name"'));
});

test('ToolCallParser parses {"tool": "...", "args": {...}} format', () => {
  const content = '{"tool": "edit_workspace_file", "args": {"path": "index.js", "target_content": "a", "replacement_content": "b"}}';
  const parsed = ToolCallParser.parse(content, undefined, new Set(['edit_workspace_file']));

  assert.equal(parsed.hadToolCallSyntax, true);
  assert.equal(parsed.toolCalls.length, 1);
  assert.equal(parsed.toolCalls[0].function.name, 'edit_workspace_file');
  assert.deepEqual(JSON.parse(parsed.toolCalls[0].function.arguments), {
    path: 'index.js',
    target_content: 'a',
    replacement_content: 'b'
  });
  assert.equal(parsed.userVisibleText, '');
});

test('ToolCallParser parses fenced JSON code blocks', () => {
  const content = '```json\n{\n  "name": "run_command",\n  "arguments": {\n    "command": "npm test"\n  }\n}\n```';
  const parsed = ToolCallParser.parse(content, undefined, new Set(['run_command']));

  assert.equal(parsed.hadToolCallSyntax, true);
  assert.equal(parsed.toolCalls.length, 1);
  assert.equal(parsed.toolCalls[0].function.name, 'run_command');
  assert.deepEqual(JSON.parse(parsed.toolCalls[0].function.arguments), { command: 'npm test' });
  assert.equal(parsed.userVisibleText, '');
});

test('ToolCallParser parses LOCALFORGE_TOOL_CALL protocol', () => {
  const content = 'LOCALFORGE_TOOL_CALL: {"tool": "run_command", "arguments": {"command": "npm run build"}}';
  const parsed = ToolCallParser.parse(content, undefined, new Set(['run_command']));

  assert.equal(parsed.hadToolCallSyntax, true);
  assert.equal(parsed.toolCalls.length, 1);
  assert.equal(parsed.toolCalls[0].function.name, 'run_command');
  assert.deepEqual(JSON.parse(parsed.toolCalls[0].function.arguments), { command: 'npm run build' });
  assert.equal(parsed.userVisibleText, '');
});

test('ToolCallParser parses TUXNEST_TOOL_CALL protocol', () => {
  const content = 'TUXNEST_TOOL_CALL: {"tool": "run_command", "arguments": {"command": "npm run build"}}';
  const parsed = ToolCallParser.parse(content, undefined, new Set(['run_command']));

  assert.equal(parsed.hadToolCallSyntax, true);
  assert.equal(parsed.toolCalls.length, 1);
  assert.equal(parsed.toolCalls[0].function.name, 'run_command');
  assert.deepEqual(JSON.parse(parsed.toolCalls[0].function.arguments), { command: 'npm run build' });
  assert.equal(parsed.userVisibleText, '');
});

test('ToolCallParser parses arrays of tool calls', () => {
  const content = `[
    {"name": "write_workspace_file", "arguments": {"path": "a.txt", "content": "hello"}},
    {"name": "write_workspace_file", "arguments": {"path": "b.txt", "content": "world"}}
  ]`;
  const parsed = ToolCallParser.parse(content, undefined, new Set(['write_workspace_file']));

  assert.equal(parsed.hadToolCallSyntax, true);
  assert.equal(parsed.toolCalls.length, 2);
  assert.equal(parsed.toolCalls[0].function.name, 'write_workspace_file');
  assert.equal(parsed.toolCalls[1].function.name, 'write_workspace_file');
  assert.equal(parsed.userVisibleText, '');
});

test('ToolCallParser handles reproduction bug with create-node-program alias and nested content value', () => {
  const content = `\`\`\`json
{
  "name": "create-node-program",
  "arguments": {
    "path": "node.js-program.js",
    "content": {
      "type": "string",
      "value": "console.log('LocalForge working');"
    }
  }
}
\`\`\``;
  const parsed = ToolCallParser.parse(content, undefined, new Set(['write_workspace_file']));

  assert.equal(parsed.hadToolCallSyntax, true);
  assert.equal(parsed.toolCalls.length, 1);
  assert.equal(parsed.toolCalls[0].function.name, 'write_workspace_file');
  const args = JSON.parse(parsed.toolCalls[0].function.arguments);
  assert.equal(args.path, 'node.js-program.js');
  assert.equal(args.content, "console.log('LocalForge working');");
  assert.equal(parsed.userVisibleText, '');
});

test('ToolCallParser handles normal text response without tool calls', () => {
  const content = 'Here is the explanation of how LocalForge works. It connects to Ollama locally.';
  const parsed = ToolCallParser.parse(content, undefined, new Set(['write_workspace_file']));

  assert.equal(parsed.hadToolCallSyntax, false);
  assert.equal(parsed.toolCalls.length, 0);
  assert.equal(parsed.userVisibleText, content);
});

test('registered creation and move tools retain their exact semantics instead of becoming overwrite aliases', () => {
  const calls = [
    { function: { name: 'create_file', arguments: { path: 'new.txt', content: '' } } },
    { function: { name: 'move_file', arguments: { source_path: 'old.txt', destination_path: 'new.txt' } } }
  ];
  const parsed = ToolCallParser.parse('', calls, new Set(['create_file', 'move_file', 'write_workspace_file']));
  assert.deepEqual(parsed.toolCalls.map((call) => call.function.name), ['create_file', 'move_file']);
  assert.equal(JSON.parse(parsed.toolCalls[0].function.arguments).content, '');
});

test('ToolCallParser removes standalone raw tool error JSON from visible text', () => {
  const parsed = ToolCallParser.parse('The action ran.\n{"error":"target_content must be non-empty"}\nPlease review.', undefined, new Set());

  assert.equal(parsed.userVisibleText, 'The action ran.\nPlease review.');
  assert.doesNotMatch(parsed.userVisibleText, /\{"error"/i);
});

test('ToolCallParser strips <think> reasoning even when no tools are called', () => {
  const content = '<think>The user is asking about architecture. I should be concise.</think>LocalForge is a local AI coding agent.';
  const parsed = ToolCallParser.parse(content, undefined, new Set(['write_workspace_file']));

  assert.equal(parsed.hadToolCallSyntax, false);
  assert.equal(parsed.toolCalls.length, 0);
  assert.equal(parsed.userVisibleText, 'LocalForge is a local AI coding agent.');
  assert.ok(!parsed.userVisibleText.includes('<think>'));
});

test('ToolCallParser unwraps nested query objects and schema echoes', () => {
  const content = '```json\n{"name": "search_workspace", "arguments": {"query": {"query": "package.json"}}}\n```';
  const parsed = ToolCallParser.parse(content, undefined, new Set(['search_workspace']));

  assert.equal(parsed.hadToolCallSyntax, true);
  assert.equal(parsed.toolCalls.length, 1);
  assert.equal(parsed.toolCalls[0].function.name, 'search_workspace');
  const args = JSON.parse(parsed.toolCalls[0].function.arguments);
  assert.equal(args.query, 'package.json');
});
