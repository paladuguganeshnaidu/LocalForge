const { test } = require('node:test');
const assert = require('node:assert/strict');
const { StorageMigrationManager, CURRENT_SCHEMA_VERSION } = require('../dist/migrations/storageMigration');

test('StorageMigrationManager maps legacy keys to modern tuxnest keys', () => {
  assert.equal(
    StorageMigrationManager.mapLegacyKey('localforge.agent.checkpoint'),
    'tuxnest.agent.checkpoint'
  );
  assert.equal(
    StorageMigrationManager.mapLegacyKey('localforge.conversation.history'),
    'tuxnest.conversation.history'
  );
  assert.equal(
    StorageMigrationManager.mapLegacyKey('localforge.custom.setting'),
    'tuxnest.custom.setting'
  );
  assert.equal(
    StorageMigrationManager.mapLegacyKey('tuxnest.already.modern'),
    'tuxnest.already.modern'
  );
});

test('StorageMigrationManager wraps and unwraps versioned records correctly', () => {
  const original = { tasks: ['t1', 't2'], completed: true };
  const wrapped = StorageMigrationManager.wrapVersioned(original);

  assert.equal(wrapped.schemaVersion, CURRENT_SCHEMA_VERSION);
  assert.ok(typeof wrapped.migratedAt === 'number');
  assert.deepEqual(wrapped.data, original);

  // Unwrap current version
  const unwrapped = StorageMigrationManager.unwrapVersioned(wrapped);
  assert.equal(unwrapped.version, CURRENT_SCHEMA_VERSION);
  assert.equal(unwrapped.migrated, false);
  assert.deepEqual(unwrapped.data, original);
});

test('StorageMigrationManager migrates legacy unversioned payloads', () => {
  const legacyPayload = { oldSetting: 'abc' };

  const migrations = {
    1: (data) => ({
      newSetting: data.oldSetting.toUpperCase()
    })
  };

  const unwrapped = StorageMigrationManager.unwrapVersioned(legacyPayload, migrations);
  assert.equal(unwrapped.migrated, true);
  assert.deepEqual(unwrapped.data, { newSetting: 'ABC' });
});

test('StorageMigrationManager rejects future unsupported versions and corrupted JSON', () => {
  const futureRecord = {
    schemaVersion: 999,
    data: { foo: 'bar' }
  };

  assert.throws(
    () => StorageMigrationManager.unwrapVersioned(futureRecord),
    /Unsupported schema version 999/
  );

  assert.throws(
    () => StorageMigrationManager.unwrapVersioned('invalid { json'),
    /Corrupted storage payload/
  );
});
