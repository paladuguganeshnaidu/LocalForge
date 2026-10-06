const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ExecutionTierManager, TIER_CAPABILITIES } = require('../dist/sandbox/executionTiers');
const { EnvironmentFilter } = require('../dist/terminal/environmentFilter');
const { RingBuffer } = require('../dist/terminal/ringBuffer');
const { ProviderGateway } = require('../dist/providers/providerGateway');
const { AdaptiveRouter } = require('../dist/providers/adaptiveRouter');
const { RunEventLogger } = require('../dist/observability/runEventLogger');

test('ExecutionTierManager enforces tier capabilities and isolation policies', () => {
  const manager = new ExecutionTierManager('read_only');
  assert.equal(manager.canMutateFilesystem(), false);
  assert.equal(manager.canExecuteTerminal(), false);

  manager.setTier('workspace_host');
  assert.equal(manager.canMutateFilesystem(), true);
  assert.equal(manager.canExecuteTerminal(), true);

  manager.setTier('isolated_worktree');
  assert.equal(manager.getCapabilities().requiresIsolation, true);
});

test('EnvironmentFilter strips sensitive tokens and retains whitelisted development variables', () => {
  const dirtyEnv = {
    PATH: '/usr/bin:/bin',
    NODE_ENV: 'production',
    AWS_SECRET_ACCESS_KEY: 'supersecret',
    GITHUB_TOKEN: 'ghp_secrettoken',
    OPENAI_API_KEY: 'sk-secretkey',
    CUSTOM_SETTING: 'ok'
  };

  const filtered = EnvironmentFilter.filterEnvironment(dirtyEnv, ['CUSTOM_SETTING']);
  assert.equal(filtered.PATH, '/usr/bin:/bin');
  assert.equal(filtered.NODE_ENV, 'production');
  assert.equal(filtered.CUSTOM_SETTING, 'ok');

  // Secrets must be scrubbed
  assert.equal(filtered.AWS_SECRET_ACCESS_KEY, undefined);
  assert.equal(filtered.GITHUB_TOKEN, undefined);
  assert.equal(filtered.OPENAI_API_KEY, undefined);
});

test('RingBuffer limits output to configured byte size with FIFO eviction', () => {
  const buffer = new RingBuffer(20); // 20 bytes max

  buffer.write('1234567890'); // 10 bytes
  assert.equal(buffer.getBytesCount(), 10);
  assert.equal(buffer.toString(), '1234567890');

  buffer.write('abcdefghij'); // +10 bytes = 20 bytes total
  assert.equal(buffer.getBytesCount(), 20);
  assert.equal(buffer.toString(), '1234567890abcdefghij');

  // Exceeds maxBytes -> oldest bytes evicted
  buffer.write('XYZ'); // +3 bytes -> 123 evicted
  assert.equal(buffer.getBytesCount(), 20);
  assert.equal(buffer.toString(), '4567890abcdefghijXYZ');
});

test('ProviderGateway normalizes errors and identifies retryable conditions', () => {
  // Auth error
  const authErr = ProviderGateway.normalizeError({ status: 401, message: 'Invalid API key' });
  assert.equal(authErr.code, 'AUTH_FAILED');
  assert.equal(authErr.isRetryable, false);

  // Rate limit
  const rateErr = ProviderGateway.normalizeError({ status: 429, message: 'Rate limit reached' });
  assert.equal(rateErr.code, 'RATE_LIMITED');
  assert.equal(rateErr.isRetryable, true);

  // Service unavailable
  const unavailErr = ProviderGateway.normalizeError(new Error('ECONNREFUSED 127.0.0.1:11434'));
  assert.equal(unavailErr.code, 'SERVICE_UNAVAILABLE');
  assert.equal(unavailErr.isRetryable, true);
});

test('AdaptiveRouter strictly enforces privacy modes and matches models to tasks', () => {
  const router = new AdaptiveRouter('local_only');

  const models = [
    {
      id: 'qwen2.5-coder:7b',
      name: 'Qwen Coder Local',
      isLocal: true,
      contextWindow: 32768,
      supportsTools: true,
      supportsStreaming: true
    },
    {
      id: 'gpt-4o',
      name: 'GPT-4o Cloud',
      isLocal: false,
      contextWindow: 128000,
      supportsTools: true,
      supportsStreaming: true
    }
  ];

  // In local_only, cloud models are excluded
  const selectedCoding = router.selectModel('coding', models);
  assert.equal(selectedCoding.id, 'qwen2.5-coder:7b');

  // In air_gapped_local with only cloud models -> throws
  router.setPrivacyMode('air_gapped_local');
  assert.throws(
    () => router.selectModel('coding', [models[1]]),
    /Privacy mode is "air_gapped_local", but no local models were found/
  );

  // In cloud_preferred, GPT-4o is eligible
  router.setPrivacyMode('cloud_preferred');
  const selectedPlanning = router.selectModel('planning', models);
  assert.equal(selectedPlanning.id, 'gpt-4o');
});

test('RunEventLogger logs structured events, redacts secrets in details, and exports diagnostics', () => {
  const logger = new RunEventLogger();

  const logged = logger.log({
    runId: 'run-101',
    eventType: 'tool_call',
    details: {
      tool: 'run_command',
      cmd: 'npm test',
      secret: 'sk-1234567890abcdef1234567890abcdef'
    }
  });

  assert.equal(logged.runId, 'run-101');
  assert.ok(logged.eventId.startsWith('evt_'));

  // Secret is scrubbed in details
  assert.ok(!JSON.stringify(logged.details).includes('sk-1234567890abcdef'));
  assert.ok(JSON.stringify(logged.details).includes('[REDACTED_SECRET:OPENAI_API_KEY]'));

  // Export diagnostics
  const exported = logger.exportDiagnostics();
  assert.equal(exported.totalEvents, 1);
  assert.equal(exported.events[0].runId, 'run-101');
});
