const assert = require('node:assert/strict');
const { test } = require('node:test');
const { validateCodingCompletion } = require('../dist/agent/completionEvidence');
const state = (...toolCalls) => ({ steps: [{ toolCalls }] });
const call = (name, result, args = {}) => ({ name, result, args, status: 'success' });

test('explicit Node test minima require actual fresh runner counts, not a file pass or printed success', () => {
  const task = 'Create math.cjs with at least 6 registered node:test tests. Run node --test math.test.cjs.';
  const written = call('create_file', { applied: true }, { path: 'math.test.cjs' });
  const run = stdout => call('run_command', { exitCode: 0, command: 'node --test math.test.cjs', stdout });
  for (const output of ['All tests passed!', 'ℹ tests 1\nℹ fail 0', '# tests 6\n# tests 1']) assert.match(validateCodingCompletion(task, state(written, run(output))), /at least 6 registered/);
  for (const output of ['# tests 6\n# fail 0', 'ℹ tests 6\nℹ fail 0']) assert.equal(validateCodingCompletion(task, state(written, run(output))), undefined);
  assert.match(validateCodingCompletion(task, state(written, run('# tests 6'), call('write_file', { applied: true }, { path: 'math.test.cjs' }))), /latest applied edit/);
});

test('ordinary Node tasks require a real successful test after the latest repair without demanding a website', () => {
  const task = 'Create math.cjs and math.test.cjs. No npm, dependencies, build or browser is required. Run node --test math.test.cjs and repair failures.';
  const written = call('create_file', { applied: true }, { path: 'math.test.cjs' });
  const tested = call('run_command', { exitCode: 0, command: 'node --test math.test.cjs' });
  const repaired = call('edit_workspace_file', { applied: true }, { path: 'math.test.cjs' });
  assert.match(validateCodingCompletion(task, state(written)), /requested test execution/);
  assert.equal(validateCodingCompletion(task, state(written, tested)), undefined);
  assert.match(validateCodingCompletion(task, state(written, tested, repaired)), /latest applied edit/);
  assert.equal(validateCodingCompletion(task, state(written, tested, repaired, { ...tested })), undefined);
  assert.equal(validateCodingCompletion('Explain Node tests; do not run node --test.', state()), undefined);
});

test('negative website/build requirements do not turn simple file or Node tasks into website tasks', () => {
  assert.equal(validateCodingCompletion('Create exactly one file agent-edit-test.md. No commands, dependencies or website are needed.', state(call('create_file', { applied: true }, { path: 'agent-edit-test.md' }))), undefined);
  assert.equal(validateCodingCompletion('Create math.cjs and math.test.cjs. No npm, dependencies, package.json, build or browser is required.', state()), undefined);
  assert.equal(validateCodingCompletion('Create clean.cjs. No dependencies, package.json, website or build is required.', state()), undefined);
  assert.match(validateCodingCompletion('Build a website. No dependencies or build step are needed.', state()), /applied website file edit/);
  assert.match(validateCodingCompletion('Create a landing website with no console errors.', state()), /applied website file edit/);
});

test('launch and browser verification of an existing website require execution, never prohibited source creation', () => {
  const task = 'Run and verify the existing website. Preserve all files; do not create files. This is not a new website build. Verify the browser button changes visible status text at mobile and desktop widths.';
  const missing = validateCodingCompletion(task, state());
  assert.match(missing, /development server.*browser-rendered.*visible text change/s);
  assert.doesNotMatch(missing, /applied website file edit|create_file|package.json/);
  const server = call('start_dev_server', { status: 'running' });
  const mobile = call('browser_action', { rendered: true, success: true, viewport: { width: 375 } }, { action: 'render' });
  const clicked = call('browser_action', { rendered: true, success: true, viewport: { width: 375 }, visibleTextChanged: true }, { action: 'click' });
  const desktop = call('browser_action', { rendered: true, success: true, viewport: { width: 1440 } }, { action: 'viewport' });
  assert.equal(validateCodingCompletion(task, state(server, mobile, clicked, desktop)), undefined);
  assert.match(validateCodingCompletion('Build a website and verify the browser result.', state(server, mobile, clicked, desktop)), /applied website file edit/);
  assert.equal(validateCodingCompletion('Summarize this website; do not build or run anything.', state()), undefined);
});

test('explicit browser_action verification requires actual requested widths and button effects', () => {
  const task = 'Build a tiny website. Start one tracked Python localhost server. A button changes visible status text. Use browser_action and inspect at width 375 and 1440 after verification.';
  const edit = call('create_file', { applied: true }, { path: 'index.html' });
  const server = call('start_dev_server', { status: 'running' });
  const desktop = call('browser_action', { success: true, rendered: true, viewport: { width: 1440 }, text: 'Ready' }, { action: 'render' });
  const ineffectiveClick = call('browser_action', { success: true, rendered: true, viewport: { width: 1440 }, visibleTextChanged: false }, { action: 'click' });
  assert.match(validateCodingCompletion(task, state(edit, server, desktop, ineffectiveClick)), /visible text change.*width 375/s);
  const workingClick = call('browser_action', { success: true, rendered: true, viewport: { width: 1440 }, visibleTextChanged: true }, { action: 'click' });
  const mobile = call('browser_action', { success: true, rendered: true, viewport: { width: 375 } }, { action: 'viewport' });
  assert.equal(validateCodingCompletion(task, state(edit, server, desktop, workingClick, mobile)), undefined);
  assert.match(validateCodingCompletion(task, state(edit, desktop, workingClick, mobile)), /development server/);
  assert.match(validateCodingCompletion(task, state(edit, server, desktop, workingClick, mobile, edit, desktop)), /visible text change.*width 375/s);
});

test('explicit single-file creation is not a full application build merely because content/negative instructions mention applications', () => {
  const task = 'Create a file named package.json containing this JSON. Do not modify any other files. If the file exists, stop and tell me. Confirm the saved file without claiming that an application was built.';
  assert.equal(validateCodingCompletion(task, state(call('create_file', { applied: true }, { path: 'package.json' }))), undefined);
});

test('machine-learning completion requires real fresh source, training and test execution without a web server', () => {
  const task = 'Build a machine learning project. Run actual training and tests. Verify outputs; no browser is needed.';
  assert.match(validateCodingCompletion(task, state(call('update_plan', { modelReported: true }))), /No successful applied project source/);
  const edit = call('create_file', { applied: true }, { path: 'train.py' });
  assert.match(validateCodingCompletion(task, state(edit)), /test command.*training command/);
  const training = call('run_command', { command: 'python train.py', exitCode: 0 });
  const tests = call('run_command', { command: 'python -m unittest discover -s tests -v', exitCode: 0 });
  assert.equal(validateCodingCompletion(task, state(edit, training, tests)), undefined);
  assert.match(validateCodingCompletion(task, state(training, tests, edit)), /test command.*training command/);
});

test('an inspiration read cannot count as successful landing-page implementation', () => {
  assert.match(validateCodingCompletion('Build a landing website.', state(call('read_web_page', { content: 'inspiration' }))), /No successful applied website file edit/);
});

test('website build/run/browser evidence is required when explicitly requested', () => {
  const task = 'Create a landing website. Build the project, run it, open in the browser and verify the actual result.';
  const edits = call('create_file', { success: true, applied: true }, { path: 'index.html' });
  assert.match(validateCodingCompletion(task, state(edits)), /No successful real project build/);
  const build = call('run_build', { command: 'npm run build', exitCode: 0 });
  const server = call('start_dev_server', { status: 'running' });
  assert.match(validateCodingCompletion(task, state(edits, build, server, call('browser_action', { success: true }))), /No real browser-rendered result/);
  assert.equal(validateCodingCompletion(task, state(edits, build, server, call('browser_action', { success: true, rendered: true }))), undefined);
});

test('manifests alone and build/browser evidence predating new edits cannot prove a working website', () => {
  const task = 'Build a landing website. Build the project, run it, open the browser and verify the actual result.';
  assert.match(validateCodingCompletion(task, state(call('create_file', { applied: true }, { path: 'package.json' }))), /No successful applied website file edit/);
  const edits = call('write_file', { applied: true }, { path: 'index.html' });
  assert.match(validateCodingCompletion(task, state(call('run_build', { exitCode: 0 }), call('browser_action', { success: true, rendered: true }), edits)), /No successful real project build.*No real browser-rendered/s);
});

test('reported console errors and responsive overflow block clean browser completion', () => {
  const task = 'Create a responsive website, open the browser and verify it; no console errors.';
  const edits = call('write_file', { applied: true }, { path: 'index.html' });
  assert.match(validateCodingCompletion(task, state(edits, call('browser_action', { success: true, rendered: true, consoleErrors: ['runtime failed'], horizontalOverflow: true }))), /console errors.*horizontal overflow/s);
});

test('review-only proposals and ordinary questions keep their existing semantics', () => {
  assert.equal(validateCodingCompletion('Create a landing page; show a proposal for approval.', state(call('create_file', { proposed: true }))), undefined);
  assert.equal(validateCodingCompletion('Summarize this project.', state()), undefined);
  assert.match(validateCodingCompletion('Create a landing page.', state(call('create_file', { success: false }))), /incomplete/);
});

test('actual broken navigation or failed network requests cannot certify browser verification', () => {
  const task = 'Create a landing website and verify the actual result in the browser.';
  const edit = call('write_file', { applied: true }, { path: 'index.html' });
  const broken = call('browser_action', { success: true, rendered: true, links: [{ href: '#features', brokenFragment: true }], networkFailures: [{ url: 'http://localhost:8080/missing.js' }] });
  assert.match(validateCodingCompletion(task, state(edit, broken)), /broken navigation.*failed network/s);
  const repaired = call('browser_action', { success: true, rendered: true, links: [{ href: '#features', brokenFragment: false }], networkFailures: [] });
  assert.equal(validateCodingCompletion(task, state(edit, broken, repaired)), undefined);
});

test('requested favicon cannot be omitted even when all other browser checks pass', () => {
  const task = 'Create a website with a favicon and verify it in the browser.';
  const edit = call('write_file', { applied: true }, { path: 'index.html' });
  const render = favicon => call('browser_action', { success: true, rendered: true, favicon });
  for (const favicon of [undefined, '', ' ']) assert.match(validateCodingCompletion(task, state(edit, render(favicon))), /no requested favicon/);
  assert.equal(validateCodingCompletion(task, state(edit, render('/favicon.svg'))), undefined);
  assert.match(validateCodingCompletion(task, state(edit, render('/favicon.svg'), edit)), /No real browser-rendered result/);
});

test('desktop inspection cannot hide a failed mobile check or malformed semantic/favicon output', () => {
  const task = 'Create a website with one main and a favicon. Verify it in the browser on mobile and desktop.';
  const edit = call('write_file', { applied: true }, { path: 'index.html' });
  const mobile = call('browser_action', { success: true, rendered: true, viewport: { width: 375 }, horizontalOverflow: true, mainLandmarks: 0, favicon: 'data:image/svg+xml,invalid', faviconSyntaxValid: false });
  const desktop = call('browser_action', { success: true, rendered: true, viewport: { width: 1440 }, horizontalOverflow: false, mainLandmarks: 0, favicon: 'data:image/svg+xml,invalid', faviconSyntaxValid: false });
  assert.match(validateCodingCompletion(task, state(edit, mobile, desktop)), /horizontal overflow.*main landmark.*favicon/s);
  const repairedDesktop = call('browser_action', { success: true, rendered: true, viewport: { width: 1440 }, horizontalOverflow: false, mainLandmarks: 1, favicon: 'data:image/svg+xml,valid', faviconSyntaxValid: true });
  const repairedMobile = call('browser_action', { success: true, rendered: true, viewport: { width: 375 }, horizontalOverflow: false, mainLandmarks: 1, favicon: 'data:image/svg+xml,valid', faviconSyntaxValid: true });
  assert.match(validateCodingCompletion(task, state(edit, mobile, desktop, edit, repairedDesktop)), /fresh mobile/);
  assert.equal(validateCodingCompletion(task, state(edit, mobile, desktop, edit, repairedDesktop, repairedMobile)), undefined);
});

test('a relative route is not verified just because it has no broken hash fragment', () => {
  const task = 'Create a landing website and verify it in the browser.';
  const edit = call('write_file', { applied: true }, { path: 'index.html' });
  const home = call('browser_action', { success: true, rendered: true, url: 'http://localhost:8080/', httpStatus: 200, navigationRoutes: ['http://localhost:8080/features'], links: [{ href: 'features', brokenFragment: false }], networkFailures: [] });
  assert.match(validateCodingCompletion(task, state(edit, home)), /Internal navigation routes/);
  const broken = call('browser_action', { success: true, rendered: true, url: 'http://localhost:8080/features', httpStatus: 404, networkFailures: ['HTTP 404'] });
  assert.match(validateCodingCompletion(task, state(edit, broken, home)), /Internal navigation routes/);
  const valid = call('browser_action', { success: true, rendered: true, url: 'http://localhost:8080/features', httpStatus: 200, networkFailures: [] });
  assert.equal(validateCodingCompletion(task, state(edit, broken, valid, home)), undefined);
});
