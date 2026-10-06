const assert = require('node:assert/strict');
const { test } = require('node:test');

const { ComputerUseManager } = require('../dist/computerUse/computerUseManager');
const { MockDesktopAdapter } = require('../dist/computerUse/desktopAdapters');
const { ComputerUsePolicy } = require('../dist/computerUse/computerUsePolicy');
const { EmergencyStop } = require('../dist/computerUse/emergencyStop');
const { VisualGrounder } = require('../dist/computerUse/visualGrounder');
const { SensitiveFieldDetector } = require('../dist/computerUse/sensitiveFieldDetector');

test('ComputerUse observe captures screen and window details', async () => {
  const manager = new ComputerUseManager({ adapter: new MockDesktopAdapter() });
  const observation = await manager.observe('run-1');

  assert.ok(observation.screenHash);
  assert.equal(observation.width, 1920);
  assert.equal(observation.height, 1080);
  assert.ok(observation.windows.length >= 2);
  assert.equal(observation.activeWindow?.isFocused, true);
});

test('ComputerUse click executes observe-act-observe loop and writes receipt', async () => {
  const adapter = new MockDesktopAdapter();
  const policy = new ComputerUsePolicy(['SCREEN_READ', 'MOUSE_CLICK']);
  const manager = new ComputerUseManager({ adapter, policy });

  const preObs = await manager.observe('run-click');
  const receipt = await manager.click('run-click', { x: 50, y: 50 }, preObs.screenHash);

  assert.equal(receipt.status, 'success');
  assert.equal(receipt.verificationResult, 'verified');
  assert.equal(receipt.preObservationHash, preObs.screenHash);
  assert.notEqual(receipt.postObservationHash, preObs.screenHash);
  assert.equal(receipt.policyApproval, true);

  const receipts = manager.receiptStore.getReceiptsForRun('run-click');
  assert.equal(receipts.length, 1);
});

test('ComputerUse stale screenshot detection blocks blind actions', async () => {
  const adapter = new MockDesktopAdapter();
  const policy = new ComputerUsePolicy(['SCREEN_READ', 'MOUSE_CLICK']);
  const manager = new ComputerUseManager({ adapter, policy });

  await assert.rejects(
    manager.click('run-stale', { x: 50, y: 50 }, 'hash_does_not_match_current_screen'),
    /Screen state has changed since last observation/
  );

  const latest = manager.receiptStore.getLatestReceipt();
  assert.equal(latest?.status, 'blocked');
  assert.equal(latest?.verificationResult, 'failed');
});

test('ComputerUse blocks clicking outside window boundaries', async () => {
  const adapter = new MockDesktopAdapter();
  const policy = new ComputerUsePolicy(['SCREEN_READ', 'MOUSE_CLICK']);
  const manager = new ComputerUseManager({ adapter, policy });

  // Out of screen bounds
  await assert.rejects(
    manager.click('run-bounds', { x: 5000, y: 5000 }),
    /outside screen bounds/
  );
});

test('ComputerUse sensitive field detection triggers category and requires user approval', async () => {
  const adapter = new MockDesktopAdapter();
  adapter.addMockWindow({
    id: 'win-pwd',
    title: 'Enter Password to Continue',
    processName: 'auth_prompt.exe',
    bounds: { x: 0, y: 0, width: 600, height: 400 },
    isFocused: true
  });
  await adapter.focusWindow('win-pwd');

  const policy = new ComputerUsePolicy(['SCREEN_READ', 'KEYBOARD_TYPE']);
  const manager = new ComputerUseManager({ adapter, policy });

  // Without approval handler, sensitive action is rejected
  await assert.rejects(
    manager.type('run-pwd-reject', 'Secret123!'),
    /Sensitive action "password" detected without user approval handler/
  );

  // With approval handler approving
  let approvedCalled = false;
  policy.setApprovalHandler(async ({ category }) => {
    approvedCalled = true;
    assert.equal(category, 'password');
    return true;
  });

  const receipt = await manager.type('run-pwd-approve', 'Secret123!');
  assert.equal(approvedCalled, true);
  assert.equal(receipt.status, 'success');
  assert.equal(receipt.sensitiveCategory, 'password');
});

test('ComputerUse EmergencyStop halts execution on runaway action count or repeated failures', async () => {
  const adapter = new MockDesktopAdapter();
  const policy = new ComputerUsePolicy(['SCREEN_READ', 'MOUSE_CLICK']);
  const emergencyStop = new EmergencyStop({ maxActionsPerRun: 3, maxConsecutiveFailures: 2 });
  const manager = new ComputerUseManager({ adapter, policy, emergencyStop });

  await manager.click('run-limit', { x: 10, y: 10 });
  await manager.click('run-limit', { x: 20, y: 20 });
  await manager.click('run-limit', { x: 30, y: 30 });

  // 4th action exceeds maxActionsPerRun (3)
  await assert.rejects(
    manager.click('run-limit', { x: 40, y: 40 }),
    /Exceeded maximum allowed actions limit/
  );
  assert.equal(emergencyStop.isTriggered(), true);

  // Further actions are unconditionally halted
  await assert.rejects(
    manager.observe('run-limit'),
    /ComputerUse automation halted by EmergencyStop/
  );
});

test('ComputerUse enforces capability permissions', async () => {
  const adapter = new MockDesktopAdapter();
  const policy = new ComputerUsePolicy(['SCREEN_READ']); // Only read, no click
  const manager = new ComputerUseManager({ adapter, policy });

  await assert.rejects(
    manager.click('run-perm', { x: 10, y: 10 }),
    /Capability "MOUSE_CLICK" is not granted/
  );

  policy.grantCapability('MOUSE_CLICK');
  const receipt = await manager.click('run-perm', { x: 10, y: 10 });
  assert.equal(receipt.status, 'success');
});
