const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

function createEvidenceWriter(filename, fileSystem = fs) {
  let pending = Promise.resolve();
  return value => {
    const snapshot = JSON.stringify(value, null, 2);
    const write = async () => {
      const temporary = path.join(path.dirname(filename), `.${path.basename(filename)}.${randomUUID()}.tmp`);
      try {
        await fileSystem.writeFile(temporary, snapshot, { flag: 'wx' });
        await fileSystem.rename(temporary, filename);
      } finally {
        await fileSystem.unlink(temporary).catch(() => {});
      }
    };
    const result = pending.then(write);
    pending = result.catch(() => {});
    return result;
  };
}

module.exports = { createEvidenceWriter };
