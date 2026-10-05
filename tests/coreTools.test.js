const assert = require('node:assert/strict');
const { test } = require('node:test');

// Mock 'vscode' module
const Module = require('node:module');
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'vscode') {
    return {
      workspace: { isTrusted: true, workspaceFolders: [] },
      languages: { getDiagnostics: () => [] }
    };
  }
  return originalLoad.apply(this, arguments);
};

const { ToolRegistry } = require('../dist/agent/toolRegistry.js');
const { registerAllCoreTools, validateRelativeWorkspacePath } = require('../dist/agent/coreTools.js');

test('process schemas and recovery errors distinguish opaque owned IDs from OS process IDs', async () => {
  const { registerProjectTools } = require('../dist/agent/projectTools');
  const { PermissionManager } = require('../dist/agent/permissionManager');
  const registry = new ToolRegistry();
  let stops = 0;
  const record = { id: 'proc-fixture-owned', processId: 12345, stdout: '', stderr: '', status: 'running' };
  registerProjectTools(registry, { getAllProcesses: () => [record], stopProcess: () => { stops += 1; return true; } });
  const permissions = new PermissionManager('always_proceed', async () => true);
  assert.match(registry.getTool('process_status').definition.function.parameters.properties.process_id.description, /opaque.*NOT.*numeric/s);
  await assert.rejects(registry.executeTool('process_status', { process_id: '12345' }, permissions), /Available owned IDs: proc-fixture-owned/);
  assert.equal((await registry.executeTool('process_status', { process_id: record.id }, permissions))[0].id, record.id);
  assert.equal((await registry.executeTool('process_status', {}, permissions))[0].id, record.id);
  await assert.rejects(registry.executeTool('stop_process', { process_id: '12345' }, permissions), /no external process was stopped/);
  assert.equal(stops, 0);
});

test('ToolRegistry registers and categorizes core tools with rich metadata', () => {
  const registry = new ToolRegistry();
  registerAllCoreTools(registry, {});

  const allTools = registry.getAllTools();
  assert.ok(allTools.length >= 15, `Expected >= 15 core tools, got ${allTools.length}`);

  const toolNames = allTools.map((t) => t.name);
  assert.ok(toolNames.includes('read_file'));
  assert.ok(toolNames.includes('read_files'));
  assert.ok(toolNames.includes('write_file'));
  assert.ok(toolNames.includes('create_file'));
  assert.ok(toolNames.includes('replace_range'));
  assert.ok(toolNames.includes('delete_file'));
  assert.ok(toolNames.includes('move_file'));
  assert.ok(toolNames.includes('list_directory'));
  assert.ok(toolNames.includes('search_text'));
  assert.ok(toolNames.includes('search_files'));
  assert.ok(toolNames.includes('git_status'));
  assert.ok(toolNames.includes('git_diff'));
  assert.ok(toolNames.includes('git_log'));
  assert.ok(toolNames.includes('git_commit'));
  assert.ok(toolNames.includes('run_command'));
  assert.ok(toolNames.includes('run_test'));
  assert.ok(toolNames.includes('get_diagnostics'));
  assert.ok(toolNames.includes('get_editor_context'));
  assert.ok(toolNames.includes('inspect_project'));
  assert.ok(toolNames.includes('create_artifact'));

  const deleteTool = registry.getTool('delete_file');
  assert.ok(deleteTool);
  assert.equal(deleteTool.riskLevel, 'destructive');
  assert.equal(deleteTool.requiresApproval, true);

  const readFileTool = registry.getTool('read_file');
  assert.ok(readFileTool);
  assert.equal(readFileTool.riskLevel, 'read_only');
  assert.equal(readFileTool.category, 'read');
});

test('validateRelativeWorkspacePath blocks UNC paths, device names, and traversal', () => {
  // Valid relative paths
  assert.deepEqual(validateRelativeWorkspacePath('src/index.ts'), ['src', 'index.ts']);
  assert.deepEqual(validateRelativeWorkspacePath('docs/guide.md'), ['docs', 'guide.md']);

  // Traversal
  assert.throws(() => validateRelativeWorkspacePath('../outside.txt'), /normalized relative path/);
  assert.throws(() => validateRelativeWorkspacePath('src/../../etc/passwd'), /normalized relative path/);

  // UNC paths
  assert.throws(() => validateRelativeWorkspacePath('//server/share/file.txt'), /normalized relative path/);
  assert.throws(() => validateRelativeWorkspacePath('\\\\server\\share\\file.txt'), /normalized relative path/);

  // Windows device names
  assert.throws(() => validateRelativeWorkspacePath('CON'), /Windows reserved device name/);
  assert.throws(() => validateRelativeWorkspacePath('src/NUL'), /Windows reserved device name/);
  assert.throws(() => validateRelativeWorkspacePath('COM1.txt'), /Windows reserved device name/);
  assert.throws(() => validateRelativeWorkspacePath('sub/LPT2'), /Windows reserved device name/);
});
