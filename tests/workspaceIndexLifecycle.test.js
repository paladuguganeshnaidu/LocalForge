const assert = require('node:assert/strict');
const { test } = require('node:test');
const Module = require('node:module');
const { performance } = require('node:perf_hooks');
const files = new Map();
const settings = new Map();
const watchers = [];
let version = 0;
let beforeRead;
let discoveryError;
let reads = 0;
const uri = (name) => ({ path: name, fsPath: name, scheme: 'memfs', toString: () => 'memfs:' + name });
const root = uri('/workspace');
const missing = () => Object.assign(new Error('Missing file'), { code: 'FileNotFound' });
const makeEvent = () => {
  const listeners = new Set();
  return { subscribe: (callback) => { listeners.add(callback); return { dispose: () => listeners.delete(callback) }; }, fire: (target) => { for (const callback of listeners) callback(target); } };
};
const configurationEvent = makeEvent();
const vscode = {
  FileType: { File: 1, Directory: 2 }, CancellationError: class extends Error { constructor() { super('Cancelled'); } },
  Uri: { parse: (value) => uri(value.slice('memfs:'.length)), joinPath: (base, ...segments) => uri([base.path, ...segments].join('/')) },
  workspace: {
    isTrusted: true, workspaceFolders: [{ uri: root, name: 'fixture' }],
    getWorkspaceFolder: (target) => target.path.startsWith('/workspace/') ? { uri: root } : undefined,
    asRelativePath: (target) => target.path.slice('/workspace/'.length),
    getConfiguration: (section) => ({ get: (key, fallback) => settings.get(section + '.' + key) ?? fallback }),
    onDidChangeConfiguration: configurationEvent.subscribe,
    fs: {
      stat: async (target) => { const file = files.get(target.path); if (!file) throw missing(); return { type: 1, size: file.bytes.length, mtime: file.version }; },
      readFile: async (target) => { if (beforeRead) await beforeRead(target); const file = files.get(target.path); if (!file) throw missing(); reads += 1; return Buffer.from(file.bytes); }
    },
    findFiles: async (include, _exclude, maximum) => {
      if (discoveryError) throw discoveryError;
      return [...files.keys()].filter((name) => include.includes('.gitignore') ? /\/\.(?:gitignore|ignore)$/.test(name) : true).map(uri).slice(0, maximum);
    },
    createFileSystemWatcher: () => {
      const created = makeEvent(); const changed = makeEvent(); const deleted = makeEvent();
      const watcher = { onDidCreate: created.subscribe, onDidChange: changed.subscribe, onDidDelete: deleted.subscribe, created, changed, deleted, disposed: false, dispose() { this.disposed = true; } };
      watchers.push(watcher); return watcher;
    }
  }
};
const originalLoad = Module._load;
Module._load = function (request, ...rest) { return request === 'vscode' ? vscode : originalLoad.call(this, request, ...rest); };
const { WorkspaceIndexer, readWorkspaceIndexLimits } = require('../dist/context/workspaceIndexer');
const { LexicalRetrievalEngine, createDocumentChunks } = require('../dist/context/retrieval');
const { isWebviewMessage } = require('../dist/ui/webviewMessages');
const write = (name, text) => { const target = '/workspace/' + name; files.set(target, { bytes: Buffer.from(text), version: ++version }); return uri(target); };
const deferred = () => { let resolve; const promise = new Promise((complete) => { resolve = complete; }); return { promise, resolve }; };
function fixture(context) {
  files.clear(); settings.clear(); watchers.length = 0; beforeRead = undefined; discoveryError = undefined; reads = 0; vscode.workspace.isTrusted = true;
  const index = new WorkspaceIndexer(); context.after(() => index.dispose()); return index;
}

test('atomic rebuild removes missing entries and keeps hash/range/chunk metadata accurate', async (context) => {
  const index = fixture(context); const target = write('alpha.txt', 'RAG_ALPHA_918273');
  await index.indexWorkspace();
  const matches = await index.search('RAG_ALPHA_918273');
  assert.equal(matches[0].path, 'alpha.txt'); assert.equal(matches[0].startLine, 1); assert.equal(matches[0].endLine, 1);
  assert.equal(matches[0].chunkId.length, 64); assert.equal(matches[0].fileHash.length, 64);
  files.delete(target.path); await index.indexWorkspace();
  assert.equal(index.getStats().fileCount, 0); assert.deepEqual(await index.search('RAG_ALPHA_918273'), []);
});

test('real watcher callbacks coalesce create/change/delete/move and never return stale content', async (context) => {
  const index = fixture(context); index.startWatching(); await index.indexWorkspace();
  const watcher = watchers[0]; let target = write('nested/file with spaces.txt', 'RAG_ALPHA_918273'); watcher.created.fire(target);
  await index.whenIdle(); assert.equal((await index.search('RAG_ALPHA_918273'))[0].path, 'nested/file with spaces.txt');
  const readCount = reads;
  for (let update = 0; update < 20; update += 1) { target = write('nested/file with spaces.txt', 'RAG_ALPHA_CHANGED_192837'); watcher.changed.fire(target); }
  await index.whenIdle(); assert.equal(reads - readCount, 1, 'Burst updates must read the latest file once');
  assert.deepEqual(await index.search('RAG_ALPHA_918273'), []); assert.match((await index.search('RAG_ALPHA_CHANGED_192837'))[0].text, /CHANGED/);
  files.delete(target.path); const moved = write('moved.txt', 'RAG_ALPHA_CHANGED_192837'); watcher.deleted.fire(target); watcher.created.fire(moved);
  await index.whenIdle(); assert.deepEqual((await index.search('RAG_ALPHA_CHANGED_192837')).map((match) => match.path), ['moved.txt']);
  files.delete(moved.path); watcher.deleted.fire(moved); await index.whenIdle(); assert.deepEqual(await index.search('RAG_ALPHA_CHANGED_192837'), []);
});

test('binary, oversized and invalid UTF-8 conversions invalidate old cached source', async (context) => {
  const index = fixture(context); const target = write('alpha.txt', 'CACHE_OLD_TOKEN'); await index.indexWorkspace();
  write('alpha.txt', Buffer.from([0, 10])); await index.indexFile(target); assert.equal(index.getDocuments().length, 0);
  write('alpha.txt', 'CACHE_OLD_TOKEN'); await index.indexFile(target);
  write('alpha.txt', 'x'.repeat(262145)); await index.indexFile(target); assert.equal(index.getDocuments().length, 0);
  write('alpha.txt', 'CACHE_OLD_TOKEN'); await index.indexFile(target);
  write('alpha.txt', Buffer.from([0xff, 0xff])); await index.indexFile(target); assert.equal(index.getDocuments().length, 0);
  assert.equal(index.getStats().error, undefined);
});

test('root/nested ignore rules, negations, configured globs, generated files and secrets stay out of retrieval', async (context) => {
  const index = fixture(context);
  write('.gitignore', '*.secret\nignored/\n!allowed.secret\nsub/private.txt\n'); write('sub/.gitignore', '!private.txt\n');
  for (const name of ['hidden.secret', 'allowed.secret', 'ignored/hidden.txt', 'sub/private.txt', 'sub/normal.txt', '.env', 'node_modules/package/code.ts', 'dist/code.ts', 'temporary.tmp', 'data.png']) write(name, 'IGNORE_TEST_TOKEN');
  settings.set('files.exclude', { '**/*.tmp': true });
  await index.indexWorkspace(); assert.deepEqual(index.getDocuments().map((document) => document.path).sort(), ['allowed.secret', 'sub/normal.txt', 'sub/private.txt']);
  index.startWatching(); write('.gitignore', '**/*\n'); watchers[0].changed.fire(uri('/workspace/.gitignore'));
  await index.whenIdle(); assert.equal(index.getStats().fileCount, 0);
});

test('concurrent rebuilds await one complete transaction and cancel without publishing a partial map', async (context) => {
  const index = fixture(context); write('old.txt', 'ORIGINAL_TOKEN'); await index.indexWorkspace();
  const entered = deferred(); const release = deferred(); const token = { isCancellationRequested: false };
  write('new.txt', 'NEW_TOKEN'); beforeRead = async (target) => { if (target.path.endsWith('new.txt')) { entered.resolve(); await release.promise; } };
  const first = index.indexWorkspace(token); const second = index.indexWorkspace(); assert.equal(first, second);
  await entered.promise; assert.deepEqual(index.getDocuments().map((document) => document.path), ['old.txt']);
  token.isCancellationRequested = true; release.resolve(); await assert.rejects(first, /Cancelled/); await assert.rejects(second, /Cancelled/);
  assert.deepEqual(index.getDocuments().map((document) => document.path), ['old.txt']);
  beforeRead = undefined; await index.indexWorkspace(); assert.equal(index.getStats().fileCount, 2);
});

test('conditional exclude rules honor sibling existence and excessive brace expansion fails closed', async (context) => {
  const index = fixture(context); write('pair.js', 'PAIR_TOKEN'); write('pair.ts', 'PAIR_TS_TOKEN'); write('standalone.js', 'STANDALONE_TOKEN');
  settings.set('files.exclude', { '**/*.js': { when: '$(basename).ts' } });
  await index.indexWorkspace(); assert.deepEqual(index.getDocuments().map((document) => document.path).sort(), ['pair.ts', 'standalone.js']);
  settings.set('files.exclude', { '**/{1..1000000}.txt': true });
  await assert.rejects(index.indexWorkspace(), /brace-expansion limit/); assert.equal(index.getStats().state, 'error');
  assert.deepEqual(index.getDocuments().map((document) => document.path).sort(), ['pair.ts', 'standalone.js']);
  settings.set('files.exclude', { '**/{1..128}.txt': true });
  await index.indexWorkspace(); assert.equal(index.getStats().state, 'ready');
  settings.set('files.exclude', Object.fromEntries(Array.from({ length: 32 }, (_, position) => [`group${position}/{1..128}.txt`, true])));
  await assert.rejects(index.indexWorkspace(), /brace-expansion limit/);
});

test('watch events during a rebuild reconcile after atomic replacement and disposal prevents late repopulation', async (context) => {
  const index = fixture(context); index.startWatching(); const target = write('race.txt', 'BEFORE_TOKEN');
  const entered = deferred(); const release = deferred(); beforeRead = async () => { entered.resolve(); await release.promise; };
  const scan = index.indexWorkspace(); await entered.promise; write('race.txt', 'AFTER_TOKEN'); watchers[0].changed.fire(target); release.resolve(); await scan;
  beforeRead = undefined; await index.whenIdle(); assert.match(index.getDocuments()[0].content, /AFTER_TOKEN/);
  const lateEntered = deferred(); const lateRelease = deferred(); beforeRead = async () => { lateEntered.resolve(); await lateRelease.promise; };
  const pending = index.indexFile(target); await lateEntered.promise; index.dispose(); lateRelease.resolve(); await pending;
  assert.deepEqual(index.getDocuments(), []); assert.equal(watchers[0].disposed, true); assert.equal(index.getStats().state, 'disposed');
});

test('discovery errors are visible, preserve the old snapshot and recover only after a successful rebuild', async (context) => {
  const index = fixture(context); write('safe.txt', 'SAFE_TOKEN'); await index.indexWorkspace();
  discoveryError = new Error('Provider unavailable'); await assert.rejects(index.indexWorkspace(), /Provider unavailable/);
  assert.equal(index.getStats().state, 'error'); assert.match(index.getStats().error, /Provider unavailable/);
  assert.equal(index.getDocuments().length, 1); await assert.rejects(index.ensureReady(), /needs attention/);
  discoveryError = undefined; await index.indexWorkspace(); assert.equal(index.getStats().state, 'ready');
});

test('limits are explicit, validated, bounded and config changes rebuild without stale entries', async (context) => {
  const index = fixture(context); index.startWatching(); settings.set('tuxnest.context.maxIndexedFiles', 1);
  write('first.txt', 'FIRST_TOKEN'); write('second.txt', 'SECOND_TOKEN'); await index.indexWorkspace();
  assert.equal(index.getStats().fileCount, 1); assert.equal(index.getStats().limitReached, true);
  settings.set('tuxnest.context.maxIndexedFiles', 2); configurationEvent.fire({ affectsConfiguration: (section) => section === 'tuxnest.context' }); await index.whenIdle();
  assert.equal(index.getStats().fileCount, 2); assert.equal(index.getStats().limitReached, false);
  settings.set('tuxnest.context.maxIndexedFiles', NaN); assert.equal(readWorkspaceIndexLimits().maxFiles, 2000);
  for (const [key, value] of [['context.maxIndexedFiles', 0], ['context.maxFileBytes', 10], ['context.maxIndexCharacters', Infinity]]) assert.equal(isWebviewMessage({ type: 'updateSettings', settings: { [key]: value } }), false);
  assert.equal(isWebviewMessage({ type: 'reindexWorkspace' }), true);
});

test('trust loss and independent snapshot mutation cannot expose indexed documents', async (context) => {
  const index = fixture(context); write('safe.txt', 'SAFE_TOKEN'); await index.indexWorkspace();
  const snapshot = index.getDocuments(); snapshot[0].content = 'CORRUPTED'; snapshot[0].chunks[0].text = 'CORRUPTED';
  assert.equal(index.getDocuments()[0].content, 'SAFE_TOKEN');
  vscode.workspace.isTrusted = false; assert.deepEqual(index.getDocuments(), []); await index.indexWorkspace(); assert.equal(index.getStats().state, 'disabled');
});

test('retrieval is bounded, diverse, traceable and does not return an irrelevant active-file boost', async () => {
  const document = (name, text) => ({ uri: 'memfs:/workspace/' + name, path: name, content: text, lines: text.split('\n') });
  const relevant = document('one.ts', Array.from({ length: 90 }, (_, line) => line === 65 ? 'UNIQUE_QUERY_TOKEN' : 'unrelated line').join('\n'));
  const chunks = createDocumentChunks(relevant); assert.ok(chunks.length >= 3); assert.ok(chunks.every((chunk) => chunk.endLine - chunk.startLine < 40 && chunk.text.length <= 4000));
  const retriever = new LexicalRetrievalEngine();
  const matches = await retriever.retrieve('UNIQUE_QUERY_TOKEN', [relevant, document('two.ts', 'UNIQUE_QUERY_TOKEN extra detail'), document('three.ts', 'UNIQUE_QUERY_TOKEN extra detail'), document('active.ts', 'unrelated')], { activeFileUri: 'memfs:/workspace/active.ts', maxChars: 130 });
  assert.ok(matches.length >= 1); assert.ok(matches.every((match) => match.path !== 'active.ts')); assert.ok(matches.reduce((total, match) => total + match.text.length, 0) <= 130);
  assert.match(matches[0].text, /UNIQUE_QUERY_TOKEN/); assert.equal(new Set(matches.map((match) => match.text)).size, matches.length);
  assert.deepEqual(await retriever.retrieve('absent-token', [document('active.ts', 'unrelated')], { activeFileUri: 'memfs:/workspace/active.ts' }), []);
});

test('a large bounded workspace yields during scanning and returns live metadata', async (context) => {
  const index = fixture(context); for (let number = 0; number < 1200; number += 1) write('source-' + number + '.ts', 'export const VALUE_' + number + ' = "SCALE_QUERY_TOKEN";');
  let yielded = false; setImmediate(() => { yielded = true; }); const start = performance.now(); await index.indexWorkspace();
  assert.equal(index.getStats().fileCount, 1200); assert.equal(yielded, true); const results = await index.search('VALUE_1199'); assert.equal(results[0].path, 'source-1199.ts');
  console.log('[WorkspaceIndexScale] 1200 files, index and query ' + (performance.now() - start).toFixed(1) + 'ms');
});
