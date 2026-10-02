const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const vscode = require('vscode');

async function run() {
  const fixture = process.env.LOCALFORGE_RECOVERY_FIXTURE;
  assert.ok(fixture && path.isAbsolute(fixture));
  const marker = path.join(fixture, 'expected.json');
  const root = vscode.workspace.workspaceFolders?.[0]?.uri;
  const actualRoot = path.resolve(root?.fsPath || '');
  const expectedRoot = path.resolve(fixture, 'project');
  assert.equal(process.platform === 'win32' ? actualRoot.toLowerCase() : actualRoot, process.platform === 'win32' ? expectedRoot.toLowerCase() : expectedRoot);
  const extension = vscode.extensions.getExtension('paladuguganeshnaidu.localforge-vscode');
  assert.ok(extension);
  const api = await extension.activate();
  const original = Buffer.from('\ufeffORIGINAL\r\nexact Windows line endings\r\n');
  const existing = vscode.Uri.joinPath(root, 'existing.txt');
  const created = vscode.Uri.joinPath(root, 'created.txt');

  if (process.env.LOCALFORGE_RECOVERY_PHASE === 'prepare') {
    await vscode.workspace.fs.writeFile(existing, original);
    const proposal = await api.engine.editEngine.proposeEdits(root, [
      { path: 'existing.txt', newContent: 'REVIEWED CHANGE\n' },
      { path: 'created.txt', newContent: 'CREATED BY REVIEWED EDIT' }
    ], 'Restart recovery fixture');
    const result = await api.engine.editEngine.applyProposal(proposal.id);
    assert.equal(result.success, true, JSON.stringify(result.errors));
    assert.ok(result.recoveryId);
    assert.equal(api.engine.editEngine.getRecoveryHistory()[0].status, 'applied');
    await fs.writeFile(marker, JSON.stringify({ recoveryId: result.recoveryId }));
    console.log('[RecoveryRestart] Changes and recovery snapshot saved before process exit');
    return;
  }

  const { recoveryId } = JSON.parse(await fs.readFile(marker, 'utf8'));
  const history = api.engine.editEngine.getRecoveryHistory();
  assert.ok(history.some((record) => record.id === recoveryId && record.status === 'applied'), 'A new VS Code process must load the persisted recovery record');
  const document = await vscode.workspace.openTextDocument(existing);
  assert.match(document.getText(), /REVIEWED CHANGE/);
  const result = await api.engine.rollbackRecordedChanges(recoveryId);
  assert.equal(result.success, true, JSON.stringify(result.conflicts));
  assert.equal(result.restoredFiles.length, 2);
  assert.deepEqual(Buffer.from(await vscode.workspace.fs.readFile(existing)), original);
  await assert.rejects(vscode.workspace.fs.readFile(created));
  const expectedText = new TextDecoder().decode(original);
  const deadline = Date.now() + 5000;
  let restoredDocument;
  do {
    restoredDocument = await vscode.workspace.openTextDocument(existing);
    if (restoredDocument.getText() === expectedText) break;
    await new Promise((resolve) => setTimeout(resolve, 25));
  } while (Date.now() < deadline);
  assert.equal(restoredDocument.getText(), expectedText, 'The open editor must show the restored contents');
  assert.equal(restoredDocument.isDirty, false);
  assert.equal(api.engine.editEngine.getRecoveryHistory().find((record) => record.id === recoveryId).status, 'reverted');
  const activities = api.engine.getActivityHistory(api.engine.sessionManager.getActiveSession().id);
  assert.ok(activities.some((activity) => activity.toolName === 'rollback_changes' && activity.status === 'success'));
  console.log('[RecoveryRestart] Exact original bytes, removed new file, editor contents, and rollback timeline verified');
}

module.exports = { run };
