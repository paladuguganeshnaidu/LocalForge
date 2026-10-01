const assert = require('node:assert/strict');
const http = require('node:http');
const { after, before, test } = require('node:test');
const { CompositeProvider } = require('../dist/providers/compositeProvider.js');
const { OpenAiCompatibleProvider } = require('../dist/providers/openAiCompatibleProvider.js');
const { routeModel } = require('../dist/providers/modelRouter.js');

let server;
let baseUrl;

before(async () => {
  server = http.createServer((request, response) => {
    if (request.url === '/v1/models') {
      response.writeHead(200, { 'Content-Type': 'application/json' }).end('{"data":[{"id":"local-model"}]}');
      return;
    }
    if (request.url === '/v1/chat/completions') {
      let body = '';
      request.on('data', (chunk) => { body += chunk; });
      request.on('end', () => {
        const input = JSON.parse(body);
        if (input.model === 'json-stream-model') {
          response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ choices: [{ message: {
            role: 'assistant', content: 'Buffered API response'
          } }] }));
          return;
        }
        if (!input.stream) {
          response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ choices: [{ message: {
            role: 'assistant', content: '', tool_calls: [{ id: 'call-1', type: 'function', function: { name: 'search_workspace', arguments: '{"query":"local"}' } }]
          } }] }));
          return;
        }
        response.writeHead(200, { 'Content-Type': 'text/event-stream' });
        if (input.tools?.length) {
          response.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'Inspecting ' } }] })}\n\n`);
          response.write(`data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'call-stream', type: 'function', function: { name: 'search_workspace', arguments: '{"query":' } }] } }] })}\n\n`);
          response.end(`data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '"local"}' } }] } }] })}\n\ndata: [DONE]\n\n`);
          return;
        }
        response.write('data: {"choices":[{"delta":{"content":"Local "}}]}\n\n');
        response.write('data: {"choices":[{"delta":{"content":"answer"}}]}\n\n');
        response.end('data: [DONE]\n\n');
      });
      return;
    }
    response.writeHead(404).end();
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}/v1`;
});

after(async () => {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});

test('discovers and streams from an OpenAI-compatible server', async () => {
  const provider = new OpenAiCompatibleProvider('test-compatible', baseUrl);
  assert.equal(await provider.detect(), true);
  assert.deepEqual(await provider.listModels(), [{ name: 'local-model' }]);
  let output = '';
  await provider.streamChat('local-model', [{ role: 'user', content: 'hello' }], (token) => { output += token; });
  assert.equal(output, 'Local answer');
});

test('returns non-streaming function tool calls from an OpenAI-compatible server', async () => {
  const provider = new OpenAiCompatibleProvider('test-compatible', baseUrl);
  const message = await provider.chatWithTools('local-model', [{ role: 'user', content: 'search' }], []);
  assert.equal(message.tool_calls[0].function.name, 'search_workspace');
  assert.equal(message.tool_calls[0].function.arguments, '{"query":"local"}');
});

test('streams visible text and reconstructs native OpenAI-compatible tool calls', async () => {
  const provider = new OpenAiCompatibleProvider('test-compatible', baseUrl);
  let visible = '';
  const message = await provider.chatWithTools(
    'local-model',
    [{ role: 'user', content: 'search' }],
    [{ type: 'function', function: { name: 'search_workspace', description: 'Search', parameters: {} } }],
    undefined,
    (delta) => { visible += delta; }
  );

  assert.equal(visible, 'Inspecting ');
  assert.equal(message.content, 'Inspecting ');
  assert.equal(message.tool_calls[0].id, 'call-stream');
  assert.equal(message.tool_calls[0].function.name, 'search_workspace');
  assert.deepEqual(JSON.parse(message.tool_calls[0].function.arguments), { query: 'local' });
});

test('falls back to a JSON response when an OpenAI-compatible API ignores stream mode', async () => {
  const provider = new OpenAiCompatibleProvider('test-compatible', baseUrl);
  let visible = '';
  const message = await provider.chatWithTools('json-stream-model', [{ role: 'user', content: 'hello' }], [], undefined, (delta) => {
    visible += delta;
  });

  assert.equal(message.content, 'Buffered API response');
  assert.equal(visible, 'Buffered API response');
});

test('routes namespaced composite model ids to the provider that discovered them', async () => {
  const composite = new CompositeProvider([new OpenAiCompatibleProvider('test-compatible', baseUrl)]);
  const models = await composite.listModels();
  assert.equal(models[0].providerId, 'test-compatible');
  assert.equal(models[0].displayName, 'local-model · test-compatible');
  let output = '';
  await composite.streamChat(models[0].name, [{ role: 'user', content: 'hello' }], (token) => { output += token; });
  assert.equal(output, 'Local answer');
});

test('model routing honors a task preference and falls back to the explicit selection', () => {
  const models = [
    { name: 'ollama:qwen', providerId: 'ollama' },
    { name: 'lmstudio:codestral', providerId: 'lmstudio' }
  ];
  assert.equal(routeModel(models, 'edit', { edit: 'lmstudio' }, 'ollama:qwen').name, 'lmstudio:codestral');
  assert.equal(routeModel(models, 'chat', {}, 'ollama:qwen').name, 'ollama:qwen');
  assert.equal(routeModel(models, 'completion', {}, 'missing').name, 'ollama:qwen');
});
