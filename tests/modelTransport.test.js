const assert = require('node:assert/strict');
const http = require('node:http');
const { test } = require('node:test');
const { Agent } = require('undici');
const { OllamaProvider } = require('../dist/providers/ollamaProvider');

test('generation tolerates delayed headers/body while explicit cancellation still aborts it', async context => {
  const server = http.createServer((request, response) => {
    request.resume();
    if (request.url === '/api/chat') setTimeout(() => {
      if (response.destroyed) return;
      response.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
      response.write('{"message":{"content":"First "}}\n');
      setTimeout(() => { if (!response.destroyed) response.end('{"message":{"content":"second"},"done":true}\n'); }, 1100);
    }, 1100);
    else response.writeHead(404).end();
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  const baseline = new Agent({ headersTimeout: 100, bodyTimeout: 100 });
  const provider = new OllamaProvider(url);
  const originalFetch = global.fetch;
  global.fetch = async () => { throw new Error('Host-patched fetch must not handle generation.'); };
  context.after(async () => { global.fetch = originalFetch; provider.dispose(); await baseline.destroy(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  await assert.rejects(baseline.request({ origin: url, path: '/api/chat', method: 'POST' }), error => error.code === 'UND_ERR_HEADERS_TIMEOUT');
  let content = '';
  await provider.streamChat('fixture', [{ role: 'user', content: 'Generate' }], delta => { content += delta; }, AbortSignal.timeout(5000));
  assert.equal(content, 'First second');
  await assert.rejects(provider.streamChat('fixture', [], () => {}, AbortSignal.timeout(100)), error => ['TimeoutError', 'AbortError'].includes(error.name));
});

test('a real reset stream retains delivered text but fails clearly without retrying or changing models', async context => {
  let requests = 0;
  const server = http.createServer((request, response) => {
    request.resume();
    requests += 1;
    response.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
    response.write('{"message":{"content":"PARTIAL_ONLY"}}\n');
    setTimeout(() => response.destroy(), 100);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const provider = new OllamaProvider(`http://127.0.0.1:${server.address().port}`);
  context.after(async () => { provider.dispose(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  let text = '';
  await assert.rejects(provider.streamChat('explicit-fixture', [], delta => { text += delta; }), error => {
    assert.match(error.message, /generation stream disconnected/);
    assert.match(error.message, /Partial output is not completion/);
    assert.match(error.message, /SSH GPU studio/);
    assert.match(error.message, /No automatic retry or model substitution/);
    assert.ok(error.cause);
    return true;
  });
  assert.equal(text, 'PARTIAL_ONLY');
  assert.equal(requests, 1);
});

test('normal EOF without Ollama done fails while protocol and server errors retain their real diagnostics', async context => {
  const server = http.createServer((request, response) => {
    let body = '';
    request.on('data', chunk => { body += chunk; });
    request.on('end', () => {
      const model = JSON.parse(body).model;
      response.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
      response.end(model === 'truncated' ? '{"message":{"content":"unfinished"}}\n' : model === 'invalid' ? 'not json\n' : '{"error":"actual model out of memory"}\n');
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const provider = new OllamaProvider(`http://127.0.0.1:${server.address().port}`);
  context.after(async () => { provider.dispose(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  await assert.rejects(provider.streamChat('truncated', [], () => {}), /before confirming completion/);
  await assert.rejects(provider.streamChat('invalid', [], () => {}), SyntaxError);
  await assert.rejects(provider.streamChat('server-error', [], () => {}), /actual model out of memory/);
});
