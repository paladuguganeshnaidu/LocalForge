const assert = require('node:assert/strict');
const { test } = require('node:test');
const Module = require('node:module');

const files = new Map();
const buffers = new Map();
const failedSaves = new Set();
let readOnlyProvider = false;
let submissions = 0;
let directWrites = 0;
const makeUri = (target) => ({ scheme: 'memfs', path: target, fsPath: target, toString: () => `memfs:${target}` });
const root = makeUri('/workspace');
const missing = () => Object.assign(new Error('Missing file'), { code: 'FileNotFound' });
class WorkspaceEdit {
  constructor() { this.operations = []; }
  createFile(uri, options) { this.operations.push({ uri, content: options.contents, create: true }); }
  replace(uri, _range, content) { this.operations.push({ uri, content }); }
}
const vscode = {
  FileSystemError: class extends Error {},
  FilePermission: { Readonly: 1 },
  FileType: { File: 1, Directory: 2 }, WorkspaceEdit,
  Position: class {}, Range: class {},
  Uri: { joinPath: (base, ...segments) => makeUri([base.path, ...segments].join('/')) },
  workspace: {
    isTrusted: true, workspaceFolders: [{ uri: root }], textDocuments: [],
    asRelativePath: (uri) => uri.path.slice('/workspace/'.length),
    getWorkspaceFolder: () => ({ uri: root }),
    fs: {
      isWritableFileSystem: () => !readOnlyProvider,
      stat: async (uri) => { if (!files.has(uri.path)) throw missing(); return { type: 1, size: files.get(uri.path).length }; },
      readFile: async (uri) => { if (!files.has(uri.path)) throw missing(); return files.get(uri.path); },
      writeFile: async (uri, bytes) => { directWrites += 1; files.set(uri.path, Buffer.from(bytes)); }
    },
    applyEdit: async (edit) => {
      submissions += 1;
      for (const operation of edit.operations) {
        if (operation.create && files.has(operation.uri.path)) return false;
        const content = Buffer.from(operation.content);
        if (failedSaves.has(operation.uri.path)) buffers.set(operation.uri.path, content);
        else files.set(operation.uri.path, content);
      }
      return true;
    },
    openTextDocument: async (uri) => ({
      isDirty: buffers.has(uri.path),
      getText: () => (buffers.get(uri.path) ?? files.get(uri.path)).toString('utf8'),
      save: async () => false
    })
  }
};
const originalLoad = Module._load;
Module._load = function (request, ...rest) { return request === 'vscode' ? vscode : originalLoad.call(this, request, ...rest); };
const { EditEngine } = require('../dist/editing/editEngine');
const { getEditRequestPolicy } = require('../dist/editing/editRequestPolicy');
const { editToolResult } = require('../dist/editing/editToolResult');
const { AgentEngine } = require('../dist/agent/agentEngine');
const { AgentLoop } = require('../dist/agent/agentLoop');
const { ToolRegistry } = require('../dist/agent/toolRegistry');
const { PermissionManager } = require('../dist/agent/permissionManager');
const { registerWorkspaceTools } = require('../dist/agent/workspaceTools');
const { registerAllCoreTools } = require('../dist/agent/coreTools');

const prompt = 'Create a file named agent-edit-test.md in the workspace root containing: # Agent Edit Test LOMVREN successfully created this file. Do not modify any other files. If this file already exists, stop and tell me. Show the proposed change for my approval.';
const content = '# Agent Edit Test\nLOMVREN successfully created this file.\n';
function fixture() {
  files.clear(); buffers.clear(); failedSaves.clear(); readOnlyProvider = false; submissions = 0; directWrites = 0;
  const editEngine = new EditEngine();
  const registry = new ToolRegistry();
  registerWorkspaceTools(registry, () => ({ editEngine, autoApply: true }));
  registerAllCoreTools(registry, { editEngine, autoApply: true });
  const permissions = new PermissionManager('always_proceed');
  const agent = new AgentEngine(registry, permissions, editEngine);
  return { editEngine, registry, permissions, agent };
}
function scriptedProvider(name, args) {
  let requests = 0;
  return {
    id: 'fixture', get requests() { return requests; },
    chatWithTools: async () => {
      requests += 1;
      return requests === 1 ? { role: 'assistant', content: '', tool_calls: [{ id: 'edit', function: { name, arguments: JSON.stringify(args) } }] } : { role: 'assistant', content: '## Proposed change\nReview and approve the file in Changes. It has not been applied.' };
    }
  };
}

test('explicit review and creation-only instructions are recognized without changing an ordinary edit request', () => {
  assert.deepEqual(getEditRequestPolicy(prompt), { reviewOnly: true, creationOnly: true, onlyPath: 'agent-edit-test.md' });
  assert.deepEqual(getEditRequestPolicy('Update src/main.ts with the requested fix.'), { reviewOnly: false, creationOnly: false, onlyPath: undefined });
});

test('the reported request remains a proposal even in always-proceed mode; accepting later saves the exact file', async () => {
  const { editEngine, agent } = fixture();
  const provider = scriptedProvider('write_workspace_file', { path: 'agent-edit-test.md', content });
  const result = await agent.runTask(provider, 'fixture', [{ role: 'user', content: prompt }]);
  assert.equal(result.status, 'waiting_for_approval');
  assert.deepEqual(result.filesModified, []);
  assert.equal(submissions, 0);
  assert.equal(files.has('/workspace/agent-edit-test.md'), false);
  const proposal = editEngine.getPendingProposals()[0];
  assert.equal(proposal.files[0].operation, 'create');
  assert.equal(proposal.files[0].newContent, content);
  assert.equal(editEngine.requiresReview, false);
  const accepted = await editEngine.applyProposal(proposal.id);
  assert.equal(accepted.success, true);
  assert.deepEqual(accepted.savedFiles, ['agent-edit-test.md']);
  assert.equal(files.get('/workspace/agent-edit-test.md').toString(), content);
  assert.equal(submissions, 1);
  assert.equal(directWrites, 0);
});

test('an existing target stops immediately without overwrite, extra model calls or a proposal', async () => {
  const { editEngine, agent } = fixture();
  files.set('/workspace/agent-edit-test.md', Buffer.from('Keep my original.'));
  const provider = scriptedProvider('write_workspace_file', { path: 'agent-edit-test.md', content });
  const result = await agent.runTask(provider, 'fixture', [{ role: 'user', content: prompt }]);
  assert.equal(result.status, 'failed');
  assert.match(result.response, /already exists.*stopped without changing/s);
  assert.match(result.response, /Earlier successful changes/);
  assert.doesNotMatch(result.response, /## Stopped without changing files/);
  assert.equal(provider.requests, 1);
  assert.equal(files.get('/workspace/agent-edit-test.md').toString(), 'Keep my original.');
  assert.equal(editEngine.getPendingProposals().length, 0);
  assert.equal(submissions, 0);
});

test('core write_file cannot evade the single-file restriction or creation-only check', async () => {
  const { agent } = fixture();
  const provider = scriptedProvider('write_file', { path: 'other.md', content });
  const result = await agent.runTask(provider, 'fixture', [{ role: 'user', content: prompt }]);
  assert.equal(result.status, 'failed');
  assert.match(result.response, /Only agent-edit-test.md was requested/);
  assert.equal(files.size, 0);
  assert.equal(submissions, 0);
});

test('review policy blocks direct apply and rollback and is released on errors', async () => {
  const { editEngine } = fixture();
  const proposal = await editEngine.proposeEdits(root, [{ path: 'preview.txt', newContent: 'preview' }]);
  await assert.rejects(editEngine.withRequestPolicy(getEditRequestPolicy(prompt), async () => {
    await assert.rejects(editEngine.applyProposal(proposal.id), /requested a proposed change/);
    await assert.rejects(editEngine.rollbackChanges('anything'), /does not authorize/);
    throw new Error('Interrupted request');
  }), /Interrupted request/);
  assert.equal(editEngine.requiresReview, false);
  assert.equal(submissions, 0);
});

test('save failure preserves dirty editor and recovery evidence, does not report a saved edit, and halts the agent', async () => {
  const { editEngine, agent } = fixture();
  files.set('/workspace/existing.md', Buffer.from('Original disk content.'));
  failedSaves.add('/workspace/existing.md');
  const provider = scriptedProvider('write_workspace_file', { path: 'existing.md', content: 'Proposed editor content.' });
  let toolResult;
  const result = await agent.runTask(provider, 'fixture', [{ role: 'user', content: 'Update existing.md.' }], { onToolEnd: (_name, value) => { toolResult = value; } });
  assert.equal(result.status, 'failed');
  assert.equal(provider.requests, 1, 'No read loop or automatic write retry may follow a partial save failure');
  assert.deepEqual(result.filesModified, []);
  assert.equal(toolResult.applied, false);
  assert.equal(toolResult.editorChanged, true);
  assert.equal(toolResult.requiresUserAction, true);
  assert.deepEqual(toolResult.savedFiles, []);
  assert.match(result.response, /Edit needs attention/);
  assert.match(result.response, /try saving manually/);
  assert.doesNotMatch(result.response, /Proposed edits remain unapplied until approved/);
  assert.equal(files.get('/workspace/existing.md').toString(), 'Original disk content.');
  assert.equal(buffers.get('/workspace/existing.md').toString(), 'Proposed editor content.');
  assert.equal(editEngine.getRecoveryHistory()[0].status, 'failed');
  assert.equal(editEngine.getProposal(toolResult.proposalId).status, 'failed');
  assert.equal(submissions, 1);
  assert.equal(directWrites, 0);
});

test('partial multi-file save reports only the disk-verified files, never the whole batch as applied', async () => {
  const { editEngine } = fixture();
  files.set('/workspace/first.md', Buffer.from('First original.'));
  files.set('/workspace/second.md', Buffer.from('Second original.'));
  failedSaves.add('/workspace/second.md');
  const proposal = await editEngine.proposeEdits(root, [{ path: 'first.md', newContent: 'First update.' }, { path: 'second.md', newContent: 'Second update.' }]);
  const result = await editEngine.applyProposal(proposal.id);
  assert.equal(result.success, false);
  assert.equal(result.appliedCount, 1);
  assert.deepEqual(result.appliedFiles, ['first.md']);
  assert.deepEqual(result.savedFiles, ['first.md']);
  assert.equal(editToolResult(result, {}).applied, false);
  assert.equal(files.get('/workspace/second.md').toString(), 'Second original.');
});

test('a known read-only filesystem is rejected before an editor mutation', async () => {
  const { editEngine } = fixture();
  files.set('/workspace/existing.md', Buffer.from('Original.'));
  const proposal = await editEngine.proposeEdits(root, [{ path: 'existing.md', newContent: 'New text.' }]);
  readOnlyProvider = true;
  await assert.rejects(editEngine.applyProposal(proposal.id), /filesystem is read-only.*No edit was submitted/);
  assert.equal(submissions, 0);
  assert.equal(files.get('/workspace/existing.md').toString(), 'Original.');
  assert.equal(buffers.size, 0);
});

test('a file appearing between preview and acceptance is never overwritten', async () => {
  const { editEngine, agent } = fixture();
  const provider = scriptedProvider('write_workspace_file', { path: 'agent-edit-test.md', content });
  await agent.runTask(provider, 'fixture', [{ role: 'user', content: prompt }]);
  const proposal = editEngine.getPendingProposals()[0];
  files.set('/workspace/agent-edit-test.md', Buffer.from('Created by the user.'));
  const result = await editEngine.applyProposal(proposal.id);
  assert.equal(result.success, false);
  assert.equal(result.staleCount, 1);
  assert.equal(submissions, 0);
  assert.equal(files.get('/workspace/agent-edit-test.md').toString(), 'Created by the user.');
});

test('reused reads include a direct instruction to summarize instead of repeating', async () => {
  const { registry } = fixture();
  files.set('/workspace/read.md', Buffer.from('Known contents.'));
  let requests = 0;
  const provider = { id: 'fixture', chatWithTools: async (_model, messages) => {
    requests += 1;
    if (requests < 3) return { role: 'assistant', content: '', tool_calls: [{ id: `read-${requests}`, function: { name: 'read_workspace_file', arguments: '{"path":"read.md"}' } }] };
    assert.match(messages.at(-1).content, /Do not request the same action again/);
    return { role: 'assistant', content: '## File contents\nThe file contains Known contents.' };
  } };
  const result = await new AgentLoop(provider, registry).run('fixture', [{ role: 'user', content: 'Read read.md.' }]);
  assert.equal(result.state.status, 'completed');
  assert.equal(result.state.steps[1].toolCalls[0].result.duplicateSuppressed, true);
  assert.equal(requests, 3);
});
