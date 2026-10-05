const assert = require('node:assert/strict');
const { test } = require('node:test');
const http = require('node:http');
const { RenderedBrowser, findBrowserExecutable } = require('../dist/browser/renderedBrowser');

test('real installed browser renders JS, interacts, validates forms and observes console/network failures', async context => {
  if (!await findBrowserExecutable()) { context.skip('No supported installed Chrome/Edge executable.'); return; }
  const server = http.createServer((request, response) => {
    if (request.url === '/missing') { response.writeHead(404); response.end('missing'); return; }
    response.setHeader('Content-Type', 'text/html');
    response.end('<!doctype html><html lang="en"><head><title>Real browser fixture</title><meta name="description" content="Controlled browser regression"></head><body><h1>Browser regression</h1><button id="button" onclick="document.querySelector(\'h1\').textContent=\'Clicked\'">Update</button><form><label for="email">Email</label><input id="email" type="email" required></form><script>document.body.dataset.javascript="executed"; console.error("intentional-browser-error"); fetch("/missing");</script></body></html>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = new RenderedBrowser();
  try {
    const rendered = await browser.execute({ action: 'render', url: `http://127.0.0.1:${server.address().port}` });
    assert.equal(rendered.rendered, true);
    assert.equal(rendered.title, 'Real browser fixture');
    assert.equal(rendered.httpStatus, 200);
    assert.equal(rendered.mainLandmarks, 0);
    assert.equal(rendered.forms[0].valid, false);
    const clicked = await browser.execute({ action: 'click', selector: '#button' });
    assert.equal(clicked.headings[0].text, 'Clicked');
    assert.equal(clicked.visibleTextChanged, true);
    assert.equal((await browser.execute({ action: 'click', selector: '#button' })).visibleTextChanged, false);
    await assert.rejects(browser.execute({ action: 'inspect', width: 375, height: 812 }), /action viewport/);
    assert.equal((await browser.execute({ action: 'inspect' })).viewport.width, 1440);
    const resizedRender = await browser.execute({ action: 'render', url: `http://127.0.0.1:${server.address().port}`, width: 375, height: 812 });
    assert.equal(resizedRender.viewport.width, 375);
    await assert.rejects(browser.execute({ action: 'render', width: 375 }), /both width and height/);
    await assert.rejects(browser.execute({ action: 'render' }), /actual running localhost URL/);
    const filled = await browser.execute({ action: 'fill', selector: '#email', value: 'test@example.com' });
    assert.equal(filled.forms[0].valid, true);
    const mobile = await browser.execute({ action: 'viewport', width: 375, height: 812 });
    assert.equal(mobile.viewport.width, 375);
    assert.equal(mobile.horizontalOverflow, false);
    assert.ok(mobile.consoleErrors.some(error => error.includes('intentional-browser-error')));
    assert.ok(mobile.networkFailures.some(error => error.includes('/missing')));
    await assert.rejects(browser.execute({ action: 'render', url: 'https://example.com' }), /loopback/);
  } finally { await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});

test('failed rendered navigation reports missing session rather than rejecting a valid localhost inspection URL', async context => {
  if (!await findBrowserExecutable()) { context.skip('No supported installed browser.'); return; }
  const server = http.createServer((_request, response) => { response.setHeader('Content-Type', 'text/html'); response.end('<main>Owned recovery fixture</main>'); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  const browser = new RenderedBrowser();
  try {
    await new Promise(resolve => server.close(resolve));
    await assert.rejects(browser.execute({ action: 'render', url }), /ERR_CONNECTION_REFUSED/);
    await assert.rejects(browser.execute({ action: 'inspect', url }), /No successfully rendered page/);
    await assert.rejects(browser.execute({ action: 'viewport', width: 375, height: 812 }), /No successfully rendered page/);
    await new Promise(resolve => server.listen(new URL(url).port, '127.0.0.1', resolve));
    assert.equal((await browser.execute({ action: 'render', url, width: 375, height: 812 })).viewport.width, 375);
    assert.equal((await browser.execute({ action: 'inspect', url })).mainLandmarks, 1);
  } finally { await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});

test('real browser diagnoses malformed SVG data favicon and semantic main counts', async context => {
  if (!await findBrowserExecutable()) { context.skip('No supported installed browser.'); return; }
  const server = http.createServer((request, response) => {
    const favicon = request.url === '/valid' ? 'data:image/svg+xml,%3Csvg%20xmlns=%22http://www.w3.org/2000/svg%22/%3E' : 'data:image/svg+xml,%3Csvg';
    response.setHeader('Content-Type', 'text/html');
    response.end(`<!doctype html><html lang="en"><head><title>Diagnostic fixture</title><link rel="icon" href="${favicon}"></head><body><main><h1>Fixture</h1></main></body></html>`);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = new RenderedBrowser();
  try {
    const root = `http://127.0.0.1:${server.address().port}`;
    const invalid = await browser.execute({ action: 'render', url: root });
    assert.equal(invalid.mainLandmarks, 1);
    assert.equal(invalid.faviconSyntaxValid, false);
    const valid = await browser.execute({ action: 'render', url: `${root}/valid` });
    assert.equal(valid.faviconSyntaxValid, true);
  } finally { await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});
