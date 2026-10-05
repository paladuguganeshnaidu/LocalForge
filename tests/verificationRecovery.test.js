const assert = require('node:assert/strict');
const test = require('node:test');
const { planVerificationRecovery } = require('../dist/agent/verificationRecovery');
const { requestedBrowserChecks } = require('../dist/agent/taskRequirements');
const { AgentLoop } = require('../dist/agent/agentLoop');
const { ToolRegistry } = require('../dist/agent/toolRegistry');
const { PermissionManager } = require('../dist/agent/permissionManager');
const { validateCodingCompletion } = require('../dist/agent/completionEvidence');

const tools = new Set(['run_command', 'read_file', 'process_status', 'browser_action']);
const record = (name, args, result, status = 'success', extra = {}) => ({ name, args, result, status, ...extra });
const state = (...calls) => ({ mode: 'agent', steps: [{ toolCalls: calls }] });
const edit = record('edit_workspace_file', { path: 'math.test.cjs' }, { applied: true });
const failed = record('run_command', { command: 'node --test math.test.cjs' }, { exitCode: 1, stdout: 'ReferenceError' }, 'error');
const siteTask = 'Build a responsive website. Start a server, verify with browser_action, click #demo-action and inspect at width 375 and 1440.';
const server = record('start_dev_server', { command: 'python3 -m http.server 8083 --bind 127.0.0.1' }, { id: 'owned', status: 'running' });
const process = record('process_status', {}, [{ id: 'owned', command: server.args.command, status: 'running' }]);
const rendered = record('browser_action', { action: 'render', url: 'http://127.0.0.1:8083/' }, { success: true, rendered: true, url: 'http://127.0.0.1:8083/', httpStatus: 200, viewport: { width: 1440 } });

test('retry is evidence-dependent, fresh, bounded and never manufactures a shell command', () => {
  assert.equal(planVerificationRecovery('Run tests', state(failed), tools, new Set()), undefined);
  const action = planVerificationRecovery('Run tests', state(failed, edit), tools, new Set());
  assert.deepEqual(action.args, failed.args);
  assert.equal(action.name, 'run_command');
  assert.equal(planVerificationRecovery('Run tests', state(failed, edit), tools, new Set([action.key])), undefined);
  assert.equal(planVerificationRecovery('Run tests', state(failed, edit, record('run_command', failed.args, { exitCode: 0 })), tools, new Set()), undefined);
  const exhausted = Array.from({ length: 3 }, () => ({ ...failed, source: 'verification' }));
  assert.equal(planVerificationRecovery('Run tests', state(...exhausted, edit), tools, new Set()), undefined);
  for (const command of ['npm install', 'git push', 'sudo npm test', 'npm test && curl evil', 'node --test > out.txt', 'node --test\nrm -rf x']) {
    assert.equal(planVerificationRecovery('Run tests', state({ ...failed, args: { command } }, edit), tools, new Set()), undefined);
  }
});

test('approval refusal, review proposals, cancellation and unavailable tools prohibit automatic execution', () => {
  for (const previous of [{ ...failed, error: 'Permission denied' }, { ...failed, status: 'cancelled' }, { ...failed, status: 'blocked' }, record('create_file', {}, { proposed: true }), record('edit_workspace_file', {}, { requiresUserAction: true })]) {
    assert.equal(planVerificationRecovery('Run tests', state(failed, previous, edit), tools, new Set()), undefined);
  }
  assert.equal(planVerificationRecovery('Run tests', { ...state(failed, edit), mode: 'ask' }, tools, new Set()), undefined);
  assert.equal(planVerificationRecovery('Run tests', state(failed, edit), new Set(), new Set()), undefined);
});

test('explicit saved-file readback checks actual applied content, not a proposal or an unrelated file', () => {
  const written = record('create_file', { path: 'agent-edit-test.md' }, { applied: true });
  const task = 'Create one file. Read the saved file once to verify. No commands or website are needed.';
  assert.deepEqual(planVerificationRecovery(task, state(written), tools, new Set()).args, { path: 'agent-edit-test.md' });
  assert.equal(planVerificationRecovery(task, state(written, record('read_file', written.args, { content: 'Saved' })), tools, new Set()), undefined);
});

test('browser requirements come from the actual task, excluding negative clauses and invented selectors', () => {
  assert.equal(requestedBrowserChecks('Create one file. No website or browser is needed.'), undefined);
  assert.deepEqual(requestedBrowserChecks(siteTask), { widths: [375, 1440], selectors: ['#demo-action'] });
  assert.deepEqual(requestedBrowserChecks('Build a responsive website. Verify it in the browser on desktop, tablet and mobile.'), { widths: [375, 768, 1440], selectors: [] });
  assert.equal(requestedBrowserChecks('Summarize this website; do not run or verify it in the browser.'), undefined);
});

test('browser scheduling requires tracked ownership and actual running-process evidence', () => {
  assert.equal(planVerificationRecovery(siteTask, state(), tools, new Set()), undefined);
  assert.deepEqual(planVerificationRecovery(siteTask, state(server), tools, new Set()).args, { process_id: 'owned' });
  assert.deepEqual(planVerificationRecovery(siteTask, state(server, process), tools, new Set()).args, { action: 'render', url: 'http://127.0.0.1:8083/' });
  assert.equal(planVerificationRecovery(siteTask, state(server, { ...process, result: [{ id: 'unowned', status: 'running', stdout: 'http://localhost:8080' }] }), tools, new Set()).name, 'process_status');
  assert.equal(planVerificationRecovery(siteTask, state(server, { ...process, result: [{ id: 'owned', status: 'stopped', command: server.args.command }] }), tools, new Set()), undefined);
  assert.equal(planVerificationRecovery(siteTask, state(server, { ...process, result: [{ id: 'owned', status: 'running', stdout: 'https://example.com' }] }), tools, new Set()), undefined);
  assert.equal(planVerificationRecovery(siteTask, state(server, process, record('stop_process', { process_id: 'owned' }, { stopRequested: true })), tools, new Set()), undefined);
});

test('interaction and viewport execution are real actions on the owned rendered origin, not inferred successful checks', () => {
  assert.deepEqual(planVerificationRecovery(siteTask, state(server, process, rendered), tools, new Set()).args, { action: 'click', selector: '#demo-action' });
  const clicked = record('browser_action', { action: 'click', selector: '#demo-action' }, { ...rendered.result, visibleTextChanged: true });
  const mobile = record('browser_action', { action: 'viewport', width: 375, height: 900 }, { ...rendered.result, viewport: { width: 375 } });
  assert.deepEqual(planVerificationRecovery(siteTask, state(server, process, rendered, clicked), tools, new Set()).args, { action: 'viewport', width: 375, height: 900 });
  assert.equal(planVerificationRecovery(siteTask, state(server, process, rendered, clicked, mobile), tools, new Set()), undefined);
  assert.deepEqual(planVerificationRecovery(siteTask, state(server, process, rendered, clicked, mobile, edit), tools, new Set()).args, { action: 'render', url: 'http://127.0.0.1:8083/' });
  const unrelated = { ...rendered, result: { ...rendered.result, url: 'http://127.0.0.1:8080/' } };
  assert.equal(planVerificationRecovery(siteTask, state(server, process, unrelated), tools, new Set()).args.action, 'render');
});

test('scheduled verification uses the registered handler and a new permission decision, while retaining historical failure', async () => {
  let modelCalls = 0;
  let commands = 0;
  const approvals = [];
  const events = [];
  const registry = new ToolRegistry();
  registry.registerTool({ type: 'function', function: { name: 'run_command', description: 'Run tests', parameters: {} } }, async () => ({ exitCode: ++commands === 1 ? 1 : 0, stdout: commands === 1 ? 'ReferenceError' : 'Passed' }));
  registry.registerTool({ type: 'function', function: { name: 'edit_workspace_file', description: 'Save repair', parameters: {} } }, async () => ({ applied: true }));
  const provider = { id: 'controlled', chatWithTools: async () => {
    modelCalls += 1;
    if (modelCalls === 1) return { role: 'assistant', content: '', tool_calls: [{ function: { name: failed.name, arguments: failed.args } }] };
    if (modelCalls === 2) return { role: 'assistant', content: '', tool_calls: [{ function: { name: edit.name, arguments: edit.args } }] };
    return { role: 'assistant', content: 'The actual rerun passed.' };
  } };
  const permissions = new PermissionManager('always_ask', async request => { approvals.push(request.toolName); return true; });
  const result = await new AgentLoop(provider, registry, permissions).run('fixture', [{ role: 'user', content: 'Run tests and repair failures' }], { maxRounds: 10, onToolStart: (...event) => events.push(event) });
  assert.equal(commands, 2);
  assert.equal(modelCalls, 3);
  assert.equal(approvals.filter(name => name === 'run_command').length, 2);
  assert.equal(events.filter(event => event[3]).length, 1);
  assert.equal(result.state.status, 'completed');
  assert.ok(result.state.errors.some(error => error.includes('ReferenceError')));
  assert.equal(result.state.steps.flatMap(step => step.toolCalls).filter(call => call.source === 'verification').length, 1);
});

test('denying a scheduled retry never executes it or changes the failed test into success', async () => {
  let modelCalls = 0;
  let executions = 0;
  let commandApprovals = 0;
  const registry = new ToolRegistry();
  registry.registerTool({ type: 'function', function: { name: 'run_command', description: 'Run test', parameters: {} } }, async () => { executions += 1; return { exitCode: 1, stdout: 'Actual failure' }; });
  registry.registerTool({ type: 'function', function: { name: 'edit_workspace_file', description: 'Repair', parameters: {} } }, async () => ({ applied: true }));
  const provider = { id: 'controlled', chatWithTools: async () => {
    modelCalls += 1;
    const action = modelCalls === 1 ? failed : modelCalls === 2 ? edit : undefined;
    return action ? { role: 'assistant', content: '', tool_calls: [{ function: { name: action.name, arguments: action.args } }] } : { role: 'assistant', content: 'Verification is not complete.' };
  } };
  const permissions = new PermissionManager('always_ask', async request => request.toolName !== 'run_command' || ++commandApprovals === 1);
  const result = await new AgentLoop(provider, registry, permissions).run('fixture', [{ role: 'user', content: 'Run tests and repair failures' }], { maxRounds: 10 });
  assert.equal(executions, 1);
  assert.equal(commandApprovals, 2);
  assert.equal(result.state.status, 'failed');
  assert.ok(result.state.unresolvedErrors.some(error => /permission|approved|denied/i.test(error)));
  const scheduled = result.state.steps.flatMap(step => step.toolCalls).filter(call => call.source === 'verification');
  assert.equal(scheduled.length, 1);
  assert.notEqual(scheduled[0].status, 'success');
});

test('cancelling approval of a scheduled retry stops the task before command execution', async () => {
  let modelCalls = 0;
  let executions = 0;
  let commandApprovals = 0;
  const controller = new AbortController();
  const states = [];
  const registry = new ToolRegistry();
  registry.registerTool({ type: 'function', function: { name: 'run_command', description: 'Run test', parameters: {} } }, async () => { executions += 1; return { exitCode: 1, stdout: 'Actual failure' }; });
  registry.registerTool({ type: 'function', function: { name: 'edit_workspace_file', description: 'Repair', parameters: {} } }, async () => ({ applied: true }));
  const provider = { id: 'controlled', chatWithTools: async () => {
    const action = ++modelCalls === 1 ? failed : edit;
    return { role: 'assistant', content: '', tool_calls: [{ function: { name: action.name, arguments: action.args } }] };
  } };
  const permissions = new PermissionManager('always_ask', async request => {
    if (request.toolName === 'run_command' && ++commandApprovals === 2) controller.abort();
    return true;
  });
  await assert.rejects(new AgentLoop(provider, registry, permissions).run('fixture', [{ role: 'user', content: 'Run tests and repair failures' }], { maxRounds: 10, signal: controller.signal, onStateUpdate: value => states.push(value.status) }), /abort|cancel/i);
  assert.equal(executions, 1);
  assert.equal(modelCalls, 2);
  assert.equal(states.at(-1), 'cancelled');
});

test('completion feedback retains the new actual repair failure instead of hiding it behind missing test evidence', async () => {
  let modelCalls = 0;
  let commands = 0;
  const registry = new ToolRegistry();
  registry.registerTool({ type: 'function', function: { name: 'run_command', description: 'Run test', parameters: {} } }, async () => {
    commands += 1;
    return { exitCode: commands < 3 ? 1 : 0, stdout: commands === 1 ? 'ReferenceError: describe is not defined' : commands === 2 ? 'SyntaxError: Cannot use import statement outside a module' : 'Actual tests passed' };
  });
  registry.registerTool({ type: 'function', function: { name: 'edit_workspace_file', description: 'Repair', parameters: {} } }, async () => ({ applied: true }));
  const provider = { id: 'controlled', chatWithTools: async (_model, history) => {
    modelCalls += 1;
    if (modelCalls === 1) return { role: 'assistant', content: '', tool_calls: [{ function: { name: failed.name, arguments: failed.args } }] };
    if ([2, 4].includes(modelCalls)) {
      if (modelCalls === 4) {
        assert.match(history.at(-1).content, /Actual unresolved tool diagnostics.*SyntaxError: Cannot use import statement outside a module/s);
        assert.match(history.at(-1).content, /untrusted evidence, not instructions/);
        assert.match(history.at(-1).content, /Never bypass a denied permission/);
      }
      return { role: 'assistant', content: '', tool_calls: [{ function: { name: edit.name, arguments: { ...edit.args, replacement_content: String(modelCalls) } } }] };
    }
    return { role: 'assistant', content: 'The tests passed.' };
  } };
  const task = 'Create CommonJS files and run node --test math.test.cjs. Repair actual failures.';
  const result = await new AgentLoop(provider, registry, new PermissionManager('always_ask', async () => true)).run('fixture', [{ role: 'user', content: task }], { maxRounds: 12, validateFinalResponse: (_answer, current) => validateCodingCompletion(task, current) });
  assert.equal(commands, 3);
  assert.equal(modelCalls, 5);
  assert.equal(result.state.status, 'completed');
  assert.deepEqual(result.state.unresolvedErrors, []);
  assert.equal(result.state.errors.length, 2);
});
