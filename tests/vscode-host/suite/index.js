const path = require('node:path');
const Mocha = require('mocha');

module.exports.run = function run() {
  const mocha = new Mocha({
    ui: 'tdd',
    color: false,
    timeout: 30000
  });
  mocha.addFile(path.resolve(__dirname, 'extension.test.js'));
  return new Promise((resolve, reject) => {
    mocha.run((failures) => {
      if (failures > 0) {
        reject(new Error('LocalForge extension-host suite failed with ' + failures + ' failure(s).'));
        return;
      }
      resolve();
    });
  });
};
