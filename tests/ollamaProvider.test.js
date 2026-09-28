const assert = require('node:assert/strict');
const http = require('node:http');
const { after, before, test } = require('node:test');
const { OllamaProvider } = require('../dist/providers/ollamaProvider.js');

let server;
let baseUrl;

before(async () => {
  server = http.createServer((request, response) => {
    if (request.url === '/api/version') {
      response.writeHead(200, { 'Content-Type': 'application/json' }).end('{"version":"test"}');
      return;
    }
    if (request.url === '/api/tags') {
      response.writeHead(200, { 'Content-Type': 'application/json' }).end('{"models":[{"name":"qwen:test","size":42,"modified_at":"2026-09-01T00:00:00Z"}]}');
      return;
    }
    if (request.url === '/api/chat') {
      let body = '';
      request.on('data', (chunk) => { body += chunk; });
      request.on('end', () => {
        if (!JSON.parse(body).stream) {
          response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ message: {
            role: 'assistant', content: '', tool_calls: [{ function: { name: 'search_workspace', arguments: { query: 'parser' } } }]
          } }));
          return;
        }
        response.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
        response.write('{"message":{"content":"O"}}\n');
        response.write('{"message":{"content":"K"}}\n');
        response.end('{"done":true}\n');
      });
      return;
    }
    response.writeHead(404).end();
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});

test('detects Ollama and maps installed model metadata', async () => {
  const provider = new OllamaProvider(baseUrl);
  assert.equal(await provider.detect(), true);
  assert.deepEqual(await provider.listModels(), [{
    name: 'qwen:test',
    size: 42,
    modifiedAt: '2026-09-01T00:00:00Z'
  }]);
});

test('streams chat tokens in order', async () => {
  const provider = new OllamaProvider(baseUrl);
  let answer = '';
  await provider.streamChat('qwen:test', [{ role: 'user', content: 'Reply OK' }], (token) => {
    answer += token;
  });
  assert.equal(answer, 'OK');
});

test('decodes Ollama tool calls without streaming', async () => {
  const provider = new OllamaProvider(baseUrl);
  const message = await provider.chatWithTools('qwen:test', [{ role: 'user', content: 'find parser' }], []);
  assert.equal(message.tool_calls[0].function.name, 'search_workspace');
  assert.deepEqual(message.tool_calls[0].function.arguments, { query: 'parser' });
});
