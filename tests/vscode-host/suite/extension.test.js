const assert = require('node:assert/strict');
const vscode = require('vscode');

suite('LocalForge Extension Host', () => {
  test('activates in a real VS Code Extension Host', async () => {
    const extension = vscode.extensions.getExtension('paladuguganeshnaidu.localforge-vscode');
    assert.ok(extension, 'LocalForge extension was not discovered');
    if (!extension.isActive) await extension.activate();
    assert.equal(extension.isActive, true);

    const commands = await vscode.commands.getCommands(true);
    assert.ok(commands.includes('localforge.openAgent'));
    assert.ok(commands.includes('localforge.refreshModels'));
    assert.ok(commands.includes('localforge.cancelAgent'));
  });

  test('registers LocalForge in the Secondary Sidebar', async () => {
    const extension = vscode.extensions.getExtension('paladuguganeshnaidu.localforge-vscode');
    assert.ok(extension);
    const secondary = extension.packageJSON?.contributes?.viewsContainers?.secondarySidebar;
    assert.ok(Array.isArray(secondary));
    assert.ok(secondary.some((item) => item.id === 'localforge-secondary'));
    const views = extension.packageJSON?.contributes?.views?.['localforge-secondary'];
    assert.ok(Array.isArray(views));
    assert.ok(views.some((item) => item.id === 'localforge.chatView'));
    await vscode.commands.executeCommand('localforge.openAgent');
  });

  test('refresh command completes without a model runtime', async () => {
    await vscode.commands.executeCommand('localforge.refreshModels');
  });
});
