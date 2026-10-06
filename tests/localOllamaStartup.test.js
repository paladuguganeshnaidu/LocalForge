const { test } = require('node:test');
const assert = require('node:assert/strict');
const { join } = require('node:path');
const { LocalOllamaStartup } = require('../dist/providers/localOllamaStartup');

function fixture(overrides = {}) {
  const launches = [];
  let probes = 0;
  const starter = new LocalOllamaStartup({
    platform: 'win32', home: 'fixture-home', environment: { OLLAMA_MODELS: 'missing-drive', PATH: 'untrusted-workspace' },
    fileExists: async path => path === join('fixture-home', 'AppData', 'Local', 'Programs', 'Ollama', 'ollama.exe'),
    directoryExists: async path => path === join('fixture-home', '.ollama', 'models'),
    ready: async () => ++probes >= 4,
    launch: (binary, environment) => { launches.push({ binary, environment }); return () => undefined; },
    delay: async () => {}, attempts: 5, ...overrides
  });
  return { starter, launches };
}

test('already running Ollama is reused without spawning anything', async () => {
  const { starter, launches } = fixture({ ready: async () => true });
  assert.equal((await starter.ensure('http://127.0.0.1:11434', true)).status, 'running');
  assert.equal(launches.length, 0);
});

test('disabled, remote, privileged, HTTPS and malformed endpoints never launch a service', async () => {
  const { starter, launches } = fixture({ ready: async () => { throw new Error('Must not probe'); } });
  assert.equal((await starter.ensure('http://127.0.0.1:11434', false)).status, 'disabled');
  for (const endpoint of ['bad', 'http://example.com:11434', 'https://localhost:11434', 'http://localhost:80', 'http://localhost:11434/api', 'http://user:secret@localhost:11434', 'http://localhost:11434/?x=1']) assert.equal((await starter.ensure(endpoint, true)).status, 'skipped');
  assert.equal(launches.length, 0);
});

test('parallel startup shares one launch and repairs only the child model directory environment', async () => {
  const environment = { OLLAMA_MODELS: 'missing-drive' };
  const { starter, launches } = fixture({ environment });
  const results = await Promise.all(Array.from({ length: 10 }, () => starter.ensure('http://127.0.0.1:11434/', true)));
  assert.ok(results.every(result => result.status === 'started'));
  assert.equal(launches.length, 1);
  assert.equal(launches[0].environment.OLLAMA_HOST, '127.0.0.1:11434');
  assert.equal(launches[0].environment.OLLAMA_MODELS, join('fixture-home', '.ollama', 'models'));
  assert.equal(environment.OLLAMA_MODELS, 'missing-drive');
});

test('valid configured model storage and explicit local port are preserved', async () => {
  const { starter, launches } = fixture({ directoryExists: async () => true });
  assert.equal((await starter.ensure('http://localhost:11500', true)).status, 'started');
  assert.equal(launches[0].environment.OLLAMA_MODELS, 'missing-drive');
  assert.equal(launches[0].environment.OLLAMA_HOST, 'localhost:11500');
});

test('missing installation and failed or timed-out launch report failure without claiming readiness', async () => {
  const absent = fixture({ fileExists: async () => false, ready: async () => false });
  assert.match((await absent.starter.ensure('http://127.0.0.1:11434', true)).message, /not installed/);
  assert.equal(absent.launches.length, 0);
  const failed = fixture({ ready: async () => false, launch: () => () => 'Permission denied' });
  assert.equal((await failed.starter.ensure('http://127.0.0.1:11434', true)).message, 'Permission denied');
  const timedOut = fixture({ ready: async () => false, attempts: 2 });
  assert.match((await timedOut.starter.ensure('http://127.0.0.1:11434', true)).message, /timed out/);
});

test('startup errors are contained and a later refresh can recover', async () => {
  let fail = true;
  const { starter } = fixture({ ready: async () => { if (fail) throw new Error('temporary'); return true; } });
  assert.equal((await starter.ensure('http://127.0.0.1:11434', true)).status, 'unavailable');
  fail = false;
  assert.equal((await starter.ensure('http://127.0.0.1:11434', true)).status, 'running');
});
