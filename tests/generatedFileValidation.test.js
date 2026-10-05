const assert = require('node:assert/strict');
const { test } = require('node:test');
const { validateGeneratedFile } = require('../dist/agent/generatedFileValidation');

test('explicit trailing-newline requests are preserved rather than silently written with truncated content', () => {
  assert.match(validateGeneratedFile('Create one file. End with a newline.', 'create_file', { path: 'test.md', content: 'Hello' }), /trailing newline/);
  assert.equal(validateGeneratedFile('Create one file. End with a newline.', 'create_file', { path: 'test.md', content: 'Hello\n' }), undefined);
  assert.equal(validateGeneratedFile('Create an ordinary file.', 'create_file', { path: 'test.md', content: 'Hello' }), undefined);
});
const { AgentLoop } = require('../dist/agent/agentLoop');
const { ToolRegistry } = require('../dist/agent/toolRegistry');
const { PermissionManager } = require('../dist/agent/permissionManager');

test('generated project manifests reject malformed/double-escaped JSON without silently transforming content', () => {
  const args = { path: 'package.json', content: '{\\n "scripts":{"build":"echo "broken""}}' };
  const original = { ...args };
  assert.match(validateGeneratedFile('Build a landing website.', 'create_file', args), /invalid JSON.*No file was written/);
  assert.deepEqual(args, original);
  assert.match(validateGeneratedFile('Create a project.', 'write_file', { path: 'package.json', content: '{"scripts":{"build":null}}' }), /scripts must map/);
  const valid = { path: 'package.json', content: JSON.stringify({ scripts: { build: 'node build.cjs' } }) };
  assert.equal(validateGeneratedFile('Build a landing website.', 'create_file', valid), undefined);
});

test('ordinary edits and explicitly intentional malformed fixtures are not given project-generation validation', () => {
  const args = { path: 'package.json', content: 'invalid fixture' };
  assert.equal(validateGeneratedFile('Edit this fixture.', 'write_file', args), undefined);
  assert.equal(validateGeneratedFile('Create a project with an intentionally invalid manifest.', 'write_file', args), undefined);
  assert.equal(validateGeneratedFile('Create a project.', 'create_file', { path: 'fixture.txt', content: 'invalid fixture' }), undefined);
});

test('requested production builds reject message-only scripts without rejecting real builds or explicit fixtures', () => {
  const task = 'Build a production-quality landing website. Install dependencies and build the project.';
  for (const build of ["echo 'Build completed'", 'echo Build complete', 'true', 'exit 0']) {
    assert.match(validateGeneratedFile(task, 'create_file', { path: 'package.json', json: { scripts: { build } } }), /does not build or validate.*No file was written/);
  }
  for (const build of ['vite build', 'node build.cjs', 'echo starting && vite build']) {
    assert.equal(validateGeneratedFile(task, 'create_file', { path: 'package.json', json: { scripts: { build } } }), undefined);
  }
  const fixture = { path: 'package.json', json: { scripts: { build: 'echo fixture' } } };
  assert.equal(validateGeneratedFile('Create a project fixture.', 'create_file', fixture), undefined);
  assert.equal(validateGeneratedFile('Build a production-quality project with an intentionally broken manifest.', 'create_file', fixture), undefined);
});

test('requested production builds need a declared build, but no-build tasks retain their exclusions', () => {
  const args = { path: 'package.json', json: { name: 'site', scripts: { start: 'http-server' } } };
  assert.match(validateGeneratedFile('Build a production-quality landing website, build the project.', 'create_file', args), /missing the requested build script.*No file was written/);
  assert.equal(validateGeneratedFile('Build a production-quality landing website. No build step.', 'create_file', args), undefined);
  assert.equal(validateGeneratedFile('Create a production-quality website. Do not build it.', 'create_file', args), undefined);
  assert.equal(validateGeneratedFile('Create a project manifest.', 'create_file', args), undefined);
});

test('placeholder-build rejection is recoverable before any file dispatch', async () => {
  const registry = new ToolRegistry();
  let writes = 0;
  registry.registerTool({ type: 'function', function: { name: 'create_file', description: 'Write a file', parameters: { type: 'object', properties: { path: { type: 'string' }, json: { type: 'object' } } } } }, async args => { writes += 1; assert.equal(args.json.scripts.build, 'node build.cjs'); return { applied: true, path: args.path }; });
  let round = 0;
  const provider = { id: 'fixture', chatWithTools: async (_model, messages) => {
    round += 1;
    if (round === 2) assert.match(messages.at(-1).content, /only prints a message/);
    return round <= 2 ? { role: 'assistant', content: '', tool_calls: [{ function: { name: 'create_file', arguments: { path: 'package.json', json: { scripts: { build: round === 1 ? 'echo done' : 'node build.cjs' } } } } }] } : { role: 'assistant', content: 'Manifest saved; site execution still needs verification.' };
  } };
  const result = await new AgentLoop(provider, registry, new PermissionManager('always_proceed', async () => true)).run('fixture', [{ role: 'user', content: 'Build a production-quality website.' }]);
  assert.equal(writes, 1);
  assert.deepEqual(result.state.unresolvedErrors, []);
});

test('a local agent receives a manifest repair error before dispatch and can recover with a valid write', async () => {
  const registry = new ToolRegistry();
  const manifest = JSON.stringify({ name: 'valid-project', private: true, scripts: { build: 'node build.cjs' } });
  let writes = 0;
  for (const name of ['create_file', 'write_file']) registry.registerTool({ type: 'function', function: { name, description: 'Write a file', parameters: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } } } } }, async args => { writes += 1; assert.equal(args.content, manifest); return { applied: true, path: args.path }; });
  let round = 0;
  const provider = { id: 'fixture', chatWithTools: async (_model, messages) => {
    round += 1;
    if (round === 1) return { role: 'assistant', content: '', tool_calls: [{ function: { name: 'create_file', arguments: { path: 'package.json', content: '{\\n broken}' } } }] };
    if (round === 2) { assert.match(messages.at(-1).content, /No file was written/); return { role: 'assistant', content: '', tool_calls: [{ function: { name: 'write_file', arguments: { path: 'package.json', content: manifest } } }] }; }
    return { role: 'assistant', content: 'Manifest created. Further implementation is still needed.' };
  } };
  const result = await new AgentLoop(provider, registry, new PermissionManager('always_proceed', async () => true)).run('fixture', [{ role: 'user', content: 'Create a project.' }]);
  assert.equal(writes, 1);
  assert.deepEqual(result.state.unresolvedErrors, []);
});
