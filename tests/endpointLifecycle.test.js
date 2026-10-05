const assert = require('node:assert/strict');
const http = require('node:http');
const { test } = require('node:test');
const { normalizeEndpoint, parseCompatibleEndpoints, compatibleProviderId } = require('../dist/providers/endpointConfiguration');
const { ConfiguredProviders } = require('../dist/providers/configuredProviders');
const { ModelRegistry } = require('../dist/providers/modelRegistry');
const { CompositeProvider } = require('../dist/providers/compositeProvider');
const { ModelRouter, routeModel } = require('../dist/providers/modelRouter');
const { OpenAiCompatibleProvider } = require('../dist/providers/openAiCompatibleProvider');
const { OllamaProvider } = require('../dist/providers/ollamaProvider');
const { isWebviewMessage } = require('../dist/ui/webviewMessages');

async function endpoint(context, label) {
  const state = { healthy: true, calls: [], redirect: undefined, requests: 0, discoveryDelay: 0 };
  const server = http.createServer((request, response) => {
    state.requests += 1;
    if (state.redirect) { response.writeHead(307, { Location: state.redirect + request.url }).end(); return; }
    if (!state.healthy) { response.writeHead(503).end('fixture unavailable'); return; }
    if (request.url === '/v1/models') {
      const send = () => response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ data: [{ id: 'shared:model/v1' }] }));
      if (state.discoveryDelay) setTimeout(send, state.discoveryDelay); else send();
      return;
    }
    let body = '';
    request.on('data', (chunk) => { body += chunk; });
    request.on('end', () => {
      const input = JSON.parse(body);
      state.calls.push(input);
      response.writeHead(200, { 'Content-Type': 'text/event-stream' }).end('data: ' + JSON.stringify({ choices: [{ delta: { content: label } }] }) + '\n\ndata: [DONE]\n\n');
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  context.after(async () => { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); });
  return { state, url: 'http://127.0.0.1:' + server.address().port + '/v1' };
}

function configured() {
  const registry = new ModelRegistry();
  const composite = new CompositeProvider([], registry);
  const manager = new ConfiguredProviders(registry, () => ({ num_ctx: 8192, num_predict: -1, temperature: 0.1 }));
  return { registry, composite, manager };
}

test('endpoint parsing normalizes, deduplicates, bounds and reports invalid positions without echoing secrets', () => {
  assert.equal(normalizeEndpoint(' HTTP://LOCALHOST:80/v1/// '), 'http://localhost/v1');
  const parsed = parseCompatibleEndpoints(' https://EXAMPLE.test:443/v1/,\nhttps://example.test/v1,http://127.0.0.1:8080/v1');
  assert.deepEqual(parsed, { endpoints: ['https://example.test/v1', 'http://127.0.0.1:8080/v1'], errors: [] });
  for (const value of ['file:///tmp/model', 'ftp://host/model', 'http://user:secret@host/v1', 'http://host/v1?api_key=secret', 'http://host/#secret', 'http://host/a b', 'not-url', 'http:\\host']) assert.throws(() => normalizeEndpoint(value));
  const rejected = parseCompatibleEndpoints('https://user:MY_PRIVATE_TOKEN@host/v1,http://localhost/v1');
  assert.deepEqual(rejected.endpoints, ['http://localhost/v1']);
  assert.doesNotMatch(JSON.stringify(rejected), /MY_PRIVATE_TOKEN/);
  assert.equal(parseCompatibleEndpoints('x'.repeat(16385)).endpoints.length, 0);
  assert.equal(parseCompatibleEndpoints(Array.from({ length: 33 }, (_, index) => 'http://localhost:' + (1000 + index)).join(',')).endpoints.length, 0);
  assert.equal(compatibleProviderId('http://localhost:80/v1/'), compatibleProviderId('HTTP://LOCALHOST/v1'));
  assert.notEqual(compatibleProviderId('http://localhost:8080/v1'), compatibleProviderId('http://localhost:8081/v1'));
});

test('a healthy compatible endpoint responding after one second is not falsely marked unavailable', async (context) => {
  const server = await endpoint(context, 'DELAYED');
  server.state.discoveryDelay = 1200;
  const provider = new OpenAiCompatibleProvider('delayed-fixture', server.url);
  assert.equal(await provider.detect(), true);
  assert.deepEqual((await provider.listModels()).map((model) => model.name), ['shared:model/v1']);
});

test('all configured endpoints share their exact provider instances between discovery and runtime; reorder preserves identity', () => {
  const { registry, composite, manager } = configured();
  const first = 'http://127.0.0.1:9001/v1';
  const second = 'http://127.0.0.1:9002/v1';
  manager.configure({ openAiEndpoints: first + ',' + second + ',' + first + '/' });
  assert.equal(registry.getAllProviders().length, 3);
  const original = registry.getProvider(compatibleProviderId(first));
  assert.equal(composite.getProviders().find((provider) => provider.id === original.id), original);
  manager.configure({ openAiEndpoints: second + ',' + first });
  assert.equal(registry.getProvider(original.id), original);
  manager.configure({ openAiEndpoints: second });
  assert.equal(registry.getProvider(original.id), undefined);
  assert.equal(composite.getProviders().some((provider) => provider.id === original.id), false);
  manager.configure({ openAiEndpoints: 'https://user:secret@host/v1,' + second });
  assert.equal(manager.getErrors().length, 1);
  assert.doesNotMatch(manager.getErrors().join(), /secret/);
  assert.ok(registry.getProvider(compatibleProviderId(second)));
});

test('two real HTTP endpoints with identical model names have independent health and exact streaming routes in all four health combinations', async (context) => {
  const first = await endpoint(context, 'API_A');
  const second = await endpoint(context, 'API_B');
  const { registry, composite, manager } = configured();
  manager.configure({ ollamaEndpoint: 'http://127.0.0.1:1', openAiEndpoints: first.url + ',' + second.url });
  for (const [healthyFirst, healthySecond] of [[true, true], [false, true], [true, false], [false, false]]) {
    first.state.healthy = healthyFirst; second.state.healthy = healthySecond;
    await registry.refresh();
    for (const [fixture, healthy, label] of [[first, healthyFirst, 'API_A'], [second, healthySecond, 'API_B']]) {
      const id = compatibleProviderId(fixture.url);
      const health = registry.getHealthReport().find((entry) => entry.id === id);
      assert.equal(health.isReachable, healthy);
      assert.equal(health.modelCount, healthy ? 1 : 0);
      assert.equal(health.endpoint, fixture.url);
      const model = registry.getModels().find((entry) => entry.providerId === id);
      assert.equal(!!model, healthy);
      if (healthy) {
        assert.equal(composite.resolveProvider(model.id).provider, registry.getProvider(id));
        let output = '';
        await composite.streamChat(model.id, [{ role: 'user', content: 'fixture prompt' }], (text) => { output += text; });
        assert.equal(output, label);
        assert.equal(fixture.state.calls.at(-1).model, 'shared:model/v1');
      } else assert.ok(health.error);
    }
    if (healthyFirst && healthySecond) {
      assert.equal(composite.resolveProvider('shared:model/v1'), undefined);
      assert.equal(new ModelRouter(() => registry.getModels()).route('chat', 'shared:model/v1').model, undefined);
      assert.equal(routeModel(registry.getModels(), 'chat', {}, 'shared:model/v1'), undefined);
    }
    assert.equal(composite.resolveProvider('removed:shared:model/v1'), undefined);
  }
});

test('removed or replaced providers cannot be resurrected by an old discovery and full discovery publishes atomically', async () => {
  const registry = new ModelRegistry();
  let finish;
  let entered;
  const started = new Promise((resolve) => { entered = resolve; });
  const delayed = new Promise((resolve) => { finish = resolve; });
  const old = { id: 'fixture', detect: async () => true, listModels: async () => { entered(); return delayed; } };
  registry.registerProvider(old);
  const pending = registry.refresh();
  await started;
  registry.unregisterProvider('fixture');
  const replacement = { id: 'fixture', detect: async () => true, listModels: async () => [{ name: 'new' }] };
  registry.registerProvider(replacement);
  await registry.refresh();
  finish([{ name: 'stale' }]); await pending;
  assert.deepEqual(registry.getModels().map((model) => model.name), ['new']);
  assert.equal(registry.getProvider('fixture'), replacement);
  const failing = { id: 'fixture', detect: async () => true, listModels: async () => { throw new Error('Discovery failed'); } };
  registry.registerProvider(failing); await registry.refresh();
  assert.equal(registry.getHealthReport()[0].isReachable, false);
  assert.equal(registry.getHealthReport()[0].modelCount, 0);
  assert.match(registry.getHealthReport()[0].error, /Discovery failed/);
});

test('standalone composite cannot retain routes across removal during discovery', async () => {
  let finish;
  const delayed = new Promise((resolve) => { finish = resolve; });
  const composite = new CompositeProvider([{ id: 'old', listModels: () => delayed }]);
  const pending = composite.listModels();
  composite.removeProvider('old');
  finish([{ name: 'shared' }]); await pending;
  assert.equal(composite.resolveProvider('old:shared'), undefined);
  assert.equal(composite.resolveProvider('shared'), undefined);
});

test('endpoint redirects never forward model discovery or private prompts to another server', async (context) => {
  const source = await endpoint(context, 'SOURCE');
  const destination = await endpoint(context, 'DESTINATION');
  source.state.redirect = destination.url.slice(0, -3);
  const provider = new OpenAiCompatibleProvider('redirect-fixture', source.url);
  assert.equal(await provider.detect(), false);
  await assert.rejects(provider.listModels());
  await assert.rejects(provider.streamChat('shared:model/v1', [{ role: 'user', content: 'PRIVATE_SOURCE_TEXT' }], () => {}));
  await assert.rejects(provider.chatWithTools('shared:model/v1', [{ role: 'user', content: 'PRIVATE_SOURCE_TEXT' }], [], undefined, () => {}));
  assert.equal(destination.state.calls.length, 0);
  assert.equal(destination.state.requests, 0, 'No discovery GET or prompt POST may follow the redirect');
  const ollama = new OllamaProvider(source.url.slice(0, -3));
  assert.equal(await ollama.detect(), false);
  await assert.rejects(ollama.listModels());
  await assert.rejects(ollama.streamChat('shared', [{ role: 'user', content: 'PRIVATE_SOURCE_TEXT' }], () => {}));
  assert.equal(destination.state.requests, 0, 'Ollama discovery and chat must not follow redirects either');
});

test('provider settings validate every endpoint, preserve explicit unavailable selections, and remain user-scoped', () => {
  assert.equal(isWebviewMessage({ type: 'updateSettings', settings: { 'ollama.baseUrl': 'http://localhost:11434', 'providers.openAICompatibleUrls': 'http://localhost:1234/v1,\nhttps://api.example.test/v1' } }), true);
  for (const key of ['ollama.baseUrl', 'providers.openAICompatibleUrls']) assert.equal(isWebviewMessage({ type: 'updateSettings', settings: { [key]: 'https://host/v1?api_key=secret' } }), false);
  const properties = require('../package.json').contributes.configuration.properties;
  assert.equal(properties['tuxnest.ollama.baseUrl'].scope, 'machine');
  assert.equal(properties['tuxnest.providers.openAICompatibleUrls'].scope, 'machine');
  assert.equal(routeModel([{ id: 'b:shared', name: 'shared' }], 'chat', { chat: 'removed:shared' }, 'b:shared'), undefined);
});
