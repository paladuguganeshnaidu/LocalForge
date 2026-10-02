const assert = require('node:assert/strict');
const http = require('node:http');
const { after, before, test } = require('node:test');
const { OllamaProvider } = require('../dist/providers/ollamaProvider.js');

let server;
let baseUrl;
let pullRequest;
let deleteRequest;

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
    if (request.url === '/api/pull') {
      let body = '';
      request.on('data', (chunk) => { body += chunk; });
      request.on('end', () => {
        pullRequest = JSON.parse(body);
        response.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
        if (pullRequest.name === 'invalid:test') {
          response.end('invalid-json\n');
          return;
        }
        response.write('{"status":"pulling manifest"}\n');
        if (pullRequest.name === 'truncated:test') {
          response.end('{"status":"pulling layers","total":1024,"completed":512}\n');
          return;
        }
        if (pullRequest.name === 'error:test') {
          response.end('{"error":"model manifest not found"}\n');
          return;
        }
        if (pullRequest.name === 'tail:test') {
          response.end('{"status":"success"}');
          return;
        }
        if (pullRequest.name === 'slow:test') {
          setTimeout(() => response.end('{"status":"success"}\n'), 300);
          return;
        }
        response.write('{"status":"pulling layers","total":1024,"completed":512}\n');
        response.end('{"status":"success","total":1024,"completed":1024}\n');
      });
      return;
    }
    if (request.url === '/api/delete') {
      let body = '';
      request.on('data', (chunk) => { body += chunk; });
      request.on('end', () => {
        deleteRequest = JSON.parse(body);
        response.writeHead(200).end();
      });
      return;
    }
    if (request.url === '/api/chat') {
      let body = '';
      request.on('data', (chunk) => { body += chunk; });
      request.on('end', () => {
        const input = JSON.parse(body);
        if (!input.stream) {
          response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ message: {
            role: 'assistant', content: '', tool_calls: [{ function: { name: 'search_workspace', arguments: { query: 'parser' } } }]
          } }));
          return;
        }
        response.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
        if (input.tools?.length) {
          response.write(JSON.stringify({ message: { content: 'Inspecting ' } }) + '\n');
          response.end(JSON.stringify({ message: { tool_calls: [{ function: { name: 'search_workspace', arguments: { query: 'parser' } } }] }, done: true }) + '\n');
          return;
        }
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
    source: 'local',
    size: 42,
    modifiedAt: '2026-09-01T00:00:00Z'
  }]);
});

test('classifies LAN, internet, and SSH-tunneled Ollama endpoints as remote', () => {
  assert.equal(new OllamaProvider('http://127.0.0.1:11434').source, 'local');
  assert.equal(new OllamaProvider('http://localhost:11434').source, 'local');
  assert.equal(new OllamaProvider('http://[::1]:11434').source, 'local');
  assert.equal(new OllamaProvider('http://192.168.1.10:11434').source, 'remote');
  assert.equal(new OllamaProvider('https://models.example.com').source, 'remote');
  assert.equal(new OllamaProvider('http://127.0.0.1:11435', 'ssh-remote-ollama').source, 'remote');
});

test('pulls an Ollama model and reports streamed progress', async () => {
  const provider = new OllamaProvider(baseUrl);
  const updates = [];
  await provider.pullModel('qwen2.5-coder:7b', (progress) => updates.push(progress));

  assert.deepEqual(pullRequest, { name: 'qwen2.5-coder:7b', stream: true });
  assert.deepEqual(updates, [
    { status: 'pulling manifest' },
    { status: 'pulling layers', total: 1024, completed: 512 },
    { status: 'success', total: 1024, completed: 1024 }
  ]);
});

test('rejects invalid Ollama model names before making a request', async () => {
  const provider = new OllamaProvider(baseUrl);
  await assert.rejects(provider.pullModel('bad\nmodel', () => {}), /valid Ollama model name/);
});

test('rejects incomplete or corrupt download streams instead of claiming a successful install', async () => {
  const provider = new OllamaProvider(baseUrl);
  await assert.rejects(provider.pullModel('truncated:test', () => {}), /before confirming success/);
  await assert.rejects(provider.pullModel('invalid:test', () => {}), /invalid model-download progress event/);
  await assert.rejects(provider.pullModel('error:test', () => {}), /model manifest not found/);
});

test('accepts the final download success event without a trailing newline', async () => {
  const provider = new OllamaProvider(baseUrl);
  const progress = [];
  await provider.pullModel('tail:test', (item) => progress.push(item));
  assert.equal(progress.at(-1).status, 'success');
});

test('deletes a named Ollama model through the local delete endpoint', async () => {
  const provider = new OllamaProvider(baseUrl);
  await provider.deleteModel('qwen2.5-coder:7b');
  assert.deepEqual(deleteRequest, { name: 'qwen2.5-coder:7b' });
});

test('cancels an active Ollama model download when its signal is aborted', async () => {
  const provider = new OllamaProvider(baseUrl);
  const controller = new AbortController();
  const pending = provider.pullModel('slow:test', () => {}, controller.signal);
  setTimeout(() => controller.abort(), 20);
  await assert.rejects(pending, (error) => error.name === 'AbortError');
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

test('streams compact Ollama model text through the text-tool fallback', async () => {
  const provider = new OllamaProvider(baseUrl);
  let visible = '';
  const message = await provider.chatWithTools('qwen2.5-coder:1.5b', [{ role: 'user', content: 'Reply OK' }], [], undefined, (delta) => {
    visible += delta;
  });

  assert.equal(visible, 'OK');
  assert.equal(message.content, 'OK');
});

test('streams Ollama native tool calls and visible assistant text', async () => {
  const provider = new OllamaProvider(baseUrl);
  let visible = '';
  const message = await provider.chatWithTools(
    'qwen:test',
    [{ role: 'user', content: 'Search for parser' }],
    [{ type: 'function', function: { name: 'search_workspace', description: 'Search', parameters: {} } }],
    undefined,
    (delta) => { visible += delta; }
  );

  assert.equal(visible, 'Inspecting ');
  assert.equal(message.content, 'Inspecting ');
  assert.equal(message.tool_calls[0].function.name, 'search_workspace');
  assert.deepEqual(message.tool_calls[0].function.arguments, { query: 'parser' });
});
