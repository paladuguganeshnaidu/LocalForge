const test = require('node:test');
const assert = require('node:assert');
const Module = require('node:module');
const vm = require('node:vm');

// Regression: the webview script lives inside a TypeScript template literal, so
// escapes such as \n and \' are consumed at render time. Checking the raw .ts
// source (see webviewScriptSyntax.test.js) cannot see that. This test renders
// the REAL html produced by getHtml() and syntax-checks the script the browser gets.
function renderHtml() {
  const origLoad = Module._load;
  const stub = new Proxy({}, {
    get: (_, k) => {
      if (k === 'Uri') return { joinPath: (...x) => ({ toString: () => x.join('/') }), file: (p) => p };
      if (k === 'EventEmitter') return class { constructor() { this.event = () => ({ dispose() {} }); } fire() {} dispose() {} };
      return new Proxy(function () {}, { get: () => () => ({}), apply: () => ({}) });
    }
  });
  Module._load = function (req, ...rest) { return req === 'vscode' ? stub : origLoad.call(this, req, ...rest); };
  try {
    const { LocalForgeViewProvider } = require('../dist/ui/chatView.js');
    const ctx = { extensionUri: { fsPath: 'ext' }, workspaceState: { get: () => undefined, update: () => Promise.resolve() }, globalState: { get: () => undefined, update: () => Promise.resolve() }, subscriptions: [] };
    const provider = new LocalForgeViewProvider({}, ctx, undefined);
    let html = '';
    const view = { webview: { options: {}, set html(v) { html = v; }, get html() { return html; }, cspSource: 'vscode-webview://test', asWebviewUri: (u) => u, onDidReceiveMessage: () => ({ dispose() {} }), postMessage: async () => true }, onDidChangeVisibility: () => ({ dispose() {} }), onDidDispose: () => ({ dispose() {} }), visible: true };
    provider.resolveWebviewView(view);
    return html;
  } finally {
    Module._load = origLoad;
  }
}

test('rendered webview script (after template-literal evaluation) is valid JavaScript', () => {
  const html = renderHtml();
  const match = html.match(/<script nonce="[^"]*">([\s\S]*?)<\/script>/);
  assert.ok(match, 'rendered html must contain the nonce script block');
  assert.doesNotThrow(() => new vm.Script(match[1]), 'Rendered webview script has a syntax error');
});

test('rendered Changes drawer exposes guarded recovery controls and binds cards to their own proposals', () => {
  const html = renderHtml();
  assert.match(html, /id="recoveryList"/);
  assert.match(html, /Undo recorded edit/);
  assert.match(html, /Remove backup/);
  assert.match(html, /type: 'rollbackEdit'/);
  assert.match(html, /type: 'forgetEditRecovery'/);
  assert.match(html, /proposalId: displayedProposal.id/);
  assert.match(html, /activeProposal.id === msg.proposalId/);
  assert.doesNotMatch(html, /record.originalBytes/);
});

test('rendered chat exposes expandable run evidence and approval modes', () => {
  const html = renderHtml();
  assert.match(html, /permissionModeSelect/);
  assert.match(html, /always_ask/);
  assert.match(html, /Model tool input/);
  assert.match(html, /Model response · user-visible/);
  assert.match(html, /Command and arguments/);
  assert.match(html, /Command result/);
  assert.match(html, /Tool output/);
  assert.match(html, /Inspect run details/);
  assert.match(html, /activityHistory/);
  assert.match(html, /permission-command/);
  assert.match(html, /escapeHtml\(req\.command\)/);
  assert.match(html, /req\.commandCategory/);
  assert.doesNotMatch(html, /always-allow-/);
  assert.match(html, /id="jumpToLatest"/);
  assert.match(html, /followingLatest/);
  assert.match(html, /scrollToLatest\(false\)/);
});

test('rendered activity feed preserves reading position and exposes jump-to-latest', () => {
  const html = renderHtml();
  const script = html.match(/<script nonce="[^"]*">([\s\S]*?)<\/script>/)[1];
  const scrollFunction = script.match(/function scrollToLatest\(force\) \{[\s\S]*?\n    \}/);
  const scrollListener = script.match(/mainScroll\.addEventListener\('scroll', \(\) => \{([\s\S]*?)\n    \}\);/);
  assert.ok(scrollFunction, 'webview must expose its actual scroll-follow function');
  assert.ok(scrollListener, 'webview must update following state from user scroll events');

  const state = {
    followingLatest: false,
    jumpToLatest: { hidden: true },
    mainScroll: { scrollTop: 120, scrollHeight: 900, clientHeight: 400 }
  };
  vm.runInNewContext(`${scrollFunction[0]}; scrollToLatest(false);`, state);
  assert.equal(state.mainScroll.scrollTop, 120, 'live activity must not yank a reader away from earlier steps');
  assert.equal(state.jumpToLatest.hidden, false, 'a jump control appears when new activity is below the reader');

  vm.runInNewContext(`${scrollFunction[0]}; scrollToLatest(true);`, state);
  assert.equal(state.mainScroll.scrollTop, 900, 'jump-to-latest must scroll to the newest content');
  assert.equal(state.jumpToLatest.hidden, true);

  state.mainScroll.scrollTop = 900;
  state.mainScroll.scrollHeight = 900;
  state.mainScroll.clientHeight = 400;
  vm.runInNewContext(`(() => { ${scrollListener[1]} })();`, state);
  assert.equal(state.followingLatest, true, 'scrolling back to the bottom resumes automatic following');
  assert.equal(state.jumpToLatest.hidden, true);
});
