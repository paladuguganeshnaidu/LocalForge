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
  const deleted = vscode.Uri.joinPath(root, 'deleted.bin');
  const movedSource = vscode.Uri.joinPath(root, 'source.bin');
  const movedTarget = vscode.Uri.joinPath(root, 'nested', 'moved.bin');
  const binary = Buffer.from([0, 255, 128, 17, 0, 200]);

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
    await vscode.workspace.fs.writeFile(deleted, binary);
    const deletion = await api.engine.editEngine.proposeEdits(root, [
      { path: 'deleted.bin', newContent: '', operation: 'delete' }
    ], 'Restart deletion fixture');
    const deletedResult = await api.engine.editEngine.applyProposal(deletion.id);
    assert.equal(deletedResult.success, true, JSON.stringify(deletedResult.errors));
    await assert.rejects(vscode.workspace.fs.readFile(deleted));
    await vscode.workspace.fs.writeFile(movedSource, binary);
    const moving = await api.engine.editEngine.proposeMove(root, 'source.bin', 'nested/moved.bin');
    assert.equal(moving.files.every((file) => file.binary), true);
    const binaryPreview = vscode.Uri.parse(`localforge-proposed:source.bin?proposal=${moving.id}&side=original`);
    assert.match((await vscode.workspace.openTextDocument(binaryPreview)).getText(), /Binary contents are not rendered/);
    const movedResult = await api.engine.editEngine.applyProposal(moving.id);
    assert.equal(movedResult.success, true, JSON.stringify(movedResult.errors));
    await assert.rejects(vscode.workspace.fs.readFile(movedSource));
    assert.deepEqual(Buffer.from(await vscode.workspace.fs.readFile(movedTarget)), binary);
    const originalSide = vscode.Uri.parse(`localforge-proposed:created.txt?proposal=${proposal.id}&side=original`);
    const proposedSide = vscode.Uri.parse(`localforge-proposed:created.txt?proposal=${proposal.id}`);
    assert.equal((await vscode.workspace.openTextDocument(originalSide)).getText(), '');
    assert.equal((await vscode.workspace.openTextDocument(proposedSide)).getText(), 'CREATED BY REVIEWED EDIT');
    await fs.writeFile(marker, JSON.stringify({ recoveryId: result.recoveryId, deletionId: deletedResult.recoveryId, moveId: movedResult.recoveryId }));
    console.log('[RecoveryRestart] Changes and recovery snapshot saved before process exit');
    return;
  }

  const { recoveryId, deletionId, moveId } = JSON.parse(await fs.readFile(marker, 'utf8'));
  const history = api.engine.editEngine.getRecoveryHistory();
  assert.ok(history.some((record) => record.id === recoveryId && record.status === 'applied'), 'A new VS Code process must load the persisted recovery record');
  for (const id of [deletionId, moveId]) assert.ok(history.some((record) => record.id === id && record.status === 'applied'));
  const movedBack = await api.engine.rollbackRecordedChanges(moveId);
  assert.equal(movedBack.success, true, JSON.stringify(movedBack.conflicts));
  assert.deepEqual(Buffer.from(await vscode.workspace.fs.readFile(movedSource)), binary);
  await assert.rejects(vscode.workspace.fs.readFile(movedTarget));
  const undeleted = await api.engine.rollbackRecordedChanges(deletionId);
  assert.equal(undeleted.success, true, JSON.stringify(undeleted.conflicts));
  assert.deepEqual(Buffer.from(await vscode.workspace.fs.readFile(deleted)), binary);
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
  console.log('[RecoveryRestart] Exact original bytes, binary deletion/move recovery, new-file diff, editor contents, and rollback timeline verified');
}

module.exports = { run };
