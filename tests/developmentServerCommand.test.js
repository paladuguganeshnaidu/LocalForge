const assert = require('node:assert/strict');
const { test } = require('node:test');
const { prepareDevelopmentServerCommand } = require('../dist/terminal/developmentServerCommand');

test('plain built-in Python server requests become explicit loopback commands before approval', () => {
  assert.equal(prepareDevelopmentServerCommand('python3 -m http.server 8080'), 'python3 -m http.server 8080 --bind 127.0.0.1');
  assert.equal(prepareDevelopmentServerCommand('python -m http.server'), 'python -m http.server 8000 --bind 127.0.0.1');
  assert.equal(prepareDevelopmentServerCommand('py -3 -m http.server 9000'), 'py -3 -m http.server 9000 --bind 127.0.0.1');
  const explicit = 'python3 -m http.server 8080 --bind 127.0.0.1';
  assert.equal(prepareDevelopmentServerCommand(explicit), explicit);
});

test('normalization never repairs arbitrary shell syntax or a public interface', () => {
  for (const command of ['python3 -m http.server 8080 && echo unsafe', 'python3 -m http.server 8080 --directory ../other', 'python3 -m http.server 8080 --bind 0.0.0.0', 'npm run dev -- --host 0.0.0.0', 'python3 -m http.server 99999', 'python3 -m http.server\n8080']) assert.throws(() => prepareDevelopmentServerCommand(command));
  assert.equal(prepareDevelopmentServerCommand('npm run dev -- --host 127.0.0.1'), 'npm run dev -- --host 127.0.0.1');
});
