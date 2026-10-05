const assert = require('node:assert/strict');
const { test } = require('node:test');
const http = require('node:http');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { verifyAgentWebsite } = require('../scripts/verify-agent-website.cjs');
const { findBrowserExecutable } = require('../dist/browser/renderedBrowser');

test('minimal website verifier visits relative routes and rejects the observed false-positive 404', async context => {
  if (!await findBrowserExecutable()) { context.skip('No installed browser.'); return; }
  let routeExists = false;
  const visited = [];
  const server = http.createServer((request, response) => {
    visited.push(request.url);
    if (request.url === '/features' && !routeExists) { response.writeHead(404); response.end('Missing fixture route'); return; }
    response.setHeader('Content-Type', 'text/html');
    response.end('<!doctype html><html lang="en"><head><title>Verifier fixture</title><meta name="description" content="Controlled verifier regression"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:image/svg+xml,%3Csvg%20xmlns=%22http://www.w3.org/2000/svg%22/%3E"></head><body><main><h1>Fixture</h1><nav><a href="/features">Features</a></nav><button id="demo-action" onclick="document.getElementById(\'demo-status\').textContent=\'Done\'">Try demo</button><p id="demo-status">Ready</p></main></body></html>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const temporaryRoot = path.resolve(os.tmpdir());
  const output = await fs.mkdtemp(path.join(temporaryRoot, 'lomvren-route-verifier-'));
  try {
    const url = `http://127.0.0.1:${server.address().port}/`;
    const broken = await verifyAgentWebsite(url, path.join(output, 'broken'), { profile: 'minimal' });
    assert.equal(broken.checks.navigationTargets, false);
    assert.equal(broken.passed, false);
    assert.ok(visited.includes('/features'));
    assert.equal(broken.navigationRoutes[0].status, 404);
    routeExists = true;
    const valid = await verifyAgentWebsite(url, path.join(output, 'valid'), { profile: 'minimal' });
    assert.equal(valid.checks.navigationTargets, true);
    assert.equal(valid.navigationRoutes[0].status, 200);
    assert.equal(valid.passed, true);
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    assert.equal(path.dirname(path.resolve(output)), temporaryRoot);
    assert.ok(path.basename(output).startsWith('lomvren-route-verifier-'));
    await fs.rm(output, { recursive: true, force: true });
  }
});
