const assert = require('node:assert/strict');
const { test } = require('node:test');
const { fingerprintMatches, SshOllamaTunnel } = require('../dist/remote/sshOllamaTunnel.js');
const { generateKeyPairSync, createHash } = require('node:crypto');
const http = require('node:http');
const net = require('node:net');
const { Server, utils } = require('ssh2');

test('requires a pinned SSH fingerprint and rejects changes', () => {
  const actual = 'aa'.repeat(32);
  const standard = `SHA256:${Buffer.from(actual, 'hex').toString('base64').replace(/=+$/, '')}`;
  assert.equal(fingerprintMatches(undefined, actual), false);
  assert.equal(fingerprintMatches(actual, actual), true);
  assert.equal(fingerprintMatches(actual, 'bb'.repeat(32)), false);
  assert.equal(fingerprintMatches(standard, actual), true);
  assert.equal(fingerprintMatches(actual.toUpperCase(), standard), true);
  assert.equal(fingerprintMatches('aa11', 'aa11'), false);
});

test('real SSH waits for asynchronous host approval, forwards loopback traffic and rejects changed keys', async () => {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs1', format: 'pem' }, publicKeyEncoding: { type: 'pkcs1', format: 'pem' } });
  const hostHash = createHash('sha256').update(utils.parseKey(privateKey).getPublicSSH()).digest('hex');
  let cancelledStreamClosed = false;
  const httpServer = http.createServer((request, response) => {
    if (request.url === '/stream') {
      response.writeHead(200, { 'Content-Type': 'text/plain' });
      response.write('STREAM_STARTED');
      const timer = setInterval(() => response.write('streaming'), 20);
      response.on('close', () => { cancelledStreamClosed = true; clearInterval(timer); });
    } else response.end('SSH_FORWARD_VERIFIED');
  });
  await new Promise(resolve => httpServer.listen(0, '127.0.0.1', resolve));
  const clients = new Set();
  const server = new Server({ hostKeys: [privateKey] }, client => {
    clients.add(client);
    client.on('error', () => {});
    client.on('close', () => clients.delete(client));
    client.on('authentication', auth => {
      if (auth.method === 'password' && auth.username === 'fixture' && auth.password === 'fixture-only') auth.accept();
      else auth.reject();
    });
    client.on('tcpip', (accept, reject, info) => {
      if (info.destIP !== '127.0.0.1' || info.destPort !== httpServer.address().port) { reject(); return; }
      const socket = net.connect(info.destPort, info.destIP);
      socket.on('connect', () => { const channel = accept(); channel.on('error', () => socket.destroy()); channel.on('close', () => socket.destroy()); socket.on('error', () => channel.destroy()); socket.on('close', () => channel.close()); socket.pipe(channel).pipe(socket); });
      socket.on('error', () => { reject(); });
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const profile = { id: 'fixture', name: 'Controlled SSH fixture', host: '127.0.0.1', port: server.address().port, username: 'fixture', remoteOllamaHost: '127.0.0.1', remoteOllamaPort: httpServer.address().port, authenticationMethod: 'password' };
  let tunnel;
  try {
    let approvedFingerprint;
    tunnel = await SshOllamaTunnel.open(profile, { password: 'fixture-only', verifyUnknownHost: async fingerprint => { approvedFingerprint = fingerprint; await new Promise(resolve => setTimeout(resolve, 30)); return true; } });
    assert.ok(fingerprintMatches(approvedFingerprint, hostHash));
    assert.match(approvedFingerprint, /^SHA256:/);
    assert.equal(await (await fetch(`http://127.0.0.1:${tunnel.port}`)).text(), 'SSH_FORWARD_VERIFIED');
    const controller = new AbortController();
    const streaming = await fetch(`http://127.0.0.1:${tunnel.port}/stream`, { signal: controller.signal });
    const reader = streaming.body.getReader();
    await reader.read();
    controller.abort();
    await reader.cancel().catch(() => {});
    for (let attempt = 0; attempt < 100 && !cancelledStreamClosed; attempt += 1) await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(cancelledStreamClosed, true, 'Cancelling generation closes the forwarded remote HTTP stream without disconnecting the entire SSH session');
    await tunnel.close();
    tunnel = undefined;
    await assert.rejects(SshOllamaTunnel.open(profile, { password: 'fixture-only', verifyUnknownHost: async () => false }), /Host denied|verification|failed/i);
    let unknownPrompted = false;
    await assert.rejects(SshOllamaTunnel.open({ ...profile, hostFingerprint: 'bb'.repeat(32) }, { password: 'fixture-only', verifyUnknownHost: async () => { unknownPrompted = true; return true; } }), /Host denied|verification|failed/i);
    assert.equal(unknownPrompted, false);
    tunnel = await SshOllamaTunnel.open({ ...profile, hostFingerprint: approvedFingerprint }, { password: 'fixture-only', verifyUnknownHost: async () => { throw new Error('Pinned hosts must not ask again.'); } });
    const port = tunnel.port;
    const streamingAfterReconnect = await fetch(`http://127.0.0.1:${port}/stream`);
    const activeReader = streamingAfterReconnect.body.getReader();
    await activeReader.read();
    let closeEvents = 0;
    let closeReason;
    const closed = new Promise(resolve => tunnel.onDidClose(reason => { closeEvents += 1; closeReason = reason; resolve(); }));
    for (const client of clients) client.end();
    await Promise.race([closed, new Promise((_, reject) => setTimeout(() => reject(new Error('SSH closure was not reported')), 3000))]);
    assert.match(closeReason.message, /SSH connection/);
    assert.equal(tunnel.isConnected, false);
    assert.throws(() => tunnel.port, /not connected/);
    await Promise.race([tunnel.close(), new Promise((_, reject) => setTimeout(() => reject(new Error('Tunnel closure leaked a forwarded socket')), 1000))]);
    await activeReader.cancel().catch(() => {});
    await assert.rejects(fetch(`http://127.0.0.1:${port}`, { signal: AbortSignal.timeout(1000) }));
    assert.equal(closeEvents, 1);
  } finally {
    await tunnel?.close();
    for (const client of clients) client.end();
    httpServer.closeAllConnections();
    await Promise.all([new Promise(resolve => server.close(resolve)), new Promise(resolve => httpServer.close(resolve))]);
  }
});
