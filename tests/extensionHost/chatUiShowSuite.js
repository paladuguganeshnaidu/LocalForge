const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const vscode = require('vscode');

async function run() {
  const runRoot = process.env.LOCALFORGE_UI_RUN;
  assert.ok(runRoot && path.isAbsolute(runRoot));
  const extension = vscode.extensions.getExtension('paladuguganeshnaidu.localforge-vscode');
  assert.ok(extension);
  const result = { startedAt: new Date().toISOString(), version: extension.packageJSON.version, installed: extension.extensionPath, vscode: vscode.version, kind: 'Real installed extension UI startup, not model or website acceptance' };
  const persist = () => fs.writeFile(path.join(runRoot, 'result.json'), JSON.stringify(result, null, 2));
  result.bundleSha256 = crypto.createHash('sha256').update(await fs.readFile(path.join(extension.extensionPath, 'dist/extension.bundle.js'))).digest('hex');
  const api = await extension.activate();
  await api.engine.bootstrap();
  let ready = false;
  const originalResolve = api.viewProvider.resolveWebviewView.bind(api.viewProvider);
  api.viewProvider.resolveWebviewView = async (view, ...args) => {
    view.webview.onDidReceiveMessage(message => { if (message.type === 'ready') ready = true; });
    return originalResolve(view, ...args);
  };
  try {
    await vscode.commands.executeCommand('localforge.openAgent');
    const deadline = Date.now() + 30000;
    while ((!ready || !api.viewProvider.view?.visible) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 200));
    assert.ok(ready, 'The real VS Code webview JavaScript must send ready.');
    assert.ok(api.viewProvider.view?.visible, 'The installed chat must actually be visible.');
    const html = api.viewProvider.view.webview.html;
    assert.ok(html.indexOf('id="modelSelect"') > html.indexOf('class="composer"'), 'The loaded installed view must contain the new bottom model control.');
    assert.ok(html.includes('id="modeSelect"'));
    assert.ok(html.includes('id="effortSelect"'));
    assert.ok(!html.includes('class="mode-bar"'));
    await api.viewProvider.refresh();
    result.ready = ready;
    result.visible = api.viewProvider.view.visible;
    result.models = api.engine.modelRegistry.getModels().map(model => ({ id: model.id, name: model.name, source: model.source }));
    result.uiStartupPassed = true;
    result.retainedUntil = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
    await persist();
    console.log(`INSTALLED_CHAT_UI_VISIBLE ${runRoot}`);
    const end = Date.now() + 2 * 60 * 60 * 1000;
    while (Date.now() < end) {
      try { await fs.access(path.join(runRoot, 'stop-request')); break; } catch {}
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  } catch (error) { result.error = error.stack || error.message; throw error; }
  finally {
    api.viewProvider.resolveWebviewView = originalResolve;
    result.finishedAt = new Date().toISOString();
    await persist();
  }
}

module.exports = { run };
