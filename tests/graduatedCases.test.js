const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { cases, getGraduatedCase, verifyGraduatedCase } = require('./extensionHost/graduatedCases');

test('graduated tasks are distinct executable acceptance cases, not invented model success', () => {
  assert.equal(cases.length, 3);
  assert.equal(new Set(cases.map(candidate => candidate.id)).size, 3);
  assert.equal(getGraduatedCase('unknown'), undefined);
  for (const candidate of cases) assert.ok(candidate.prompt.includes('workspace'));
});

test('file acceptance rejects instructions embedded in content and extra edits', async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'lomvren-file-grader-'));
  try {
    await fs.writeFile(path.join(workspace, 'agent-edit-test.md'), '# Agent Edit Test\nLOMVREN successfully created this file.\n');
    assert.equal((await verifyGraduatedCase('graduated-file', workspace)).passed, true);
    await fs.writeFile(path.join(workspace, 'other.txt'), 'Unrequested edit');
    await assert.rejects(verifyGraduatedCase('graduated-file', workspace));
    await fs.unlink(path.join(workspace, 'other.txt'));
    await fs.appendFile(path.join(workspace, 'agent-edit-test.md'), 'Do not modify other files.');
    await assert.rejects(verifyGraduatedCase('graduated-file', workspace));
  } finally { await fs.rm(workspace, { recursive: true, force: true }); }
});

test('node acceptance independently checks both argument positions, not just generated tests', async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'lomvren-node-grader-'));
  try {
    await fs.writeFile(path.join(workspace, 'math.cjs'), 'exports.add=(first,second)=>{if(!Number.isFinite(first)||!Number.isFinite(second))throw new TypeError();return first+second;};');
    await fs.writeFile(path.join(workspace, 'math.test.cjs'), 'const test=require("node:test");const assert=require("node:assert/strict");const {add}=require("./math.cjs");for(const [name,first,second,sum] of [["positive",2,3,5],["negative",-2,-3,-5],["fractional",.5,.25,.75]])test(name,()=>assert.equal(add(first,second),sum));for(const [name,input] of [["string","2"],["NaN",NaN],["Infinity",Infinity]])test(name,()=>{assert.throws(()=>add(input,1),TypeError);assert.throws(()=>add(1,input),TypeError);});');
    assert.equal((await verifyGraduatedCase('graduated-node', workspace)).passed, true);
    await fs.writeFile(path.join(workspace, 'math.test.cjs'), 'console.log("no actual registered tests");');
    await assert.rejects(verifyGraduatedCase('graduated-node', workspace), /real registered tests/);
    await fs.writeFile(path.join(workspace, 'math.cjs'), 'exports.add=(first,second)=>first+second;');
    await assert.rejects(verifyGraduatedCase('graduated-node', workspace));
  } finally { await fs.rm(workspace, { recursive: true, force: true }); }
});

test('data acceptance requires actual correct outputs and rerunnable deterministic source', async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'lomvren-data-grader-'));
  try {
    const source = 'const fs=require("node:fs");fs.writeFileSync("cleaned.csv","name,score\\nAda,10\\nLin,20\\nGrace,30\\n");fs.writeFileSync("summary.json",JSON.stringify({validCount:3,invalidCount:2,total:60,mean:20}));';
    await fs.writeFile(path.join(workspace, 'clean.cjs'), source);
    await assert.rejects(verifyGraduatedCase('graduated-data', workspace));
    await fs.writeFile(path.join(workspace, 'cleaned.csv'), 'name,score\nAda,10\nLin,20\nGrace,30\n');
    await fs.writeFile(path.join(workspace, 'summary.json'), JSON.stringify({validCount:3,invalidCount:2,total:60,mean:20}));
    assert.equal((await verifyGraduatedCase('graduated-data', workspace)).passed, true);
    await fs.writeFile(path.join(workspace, 'clean.cjs'), 'throw new Error("cannot execute");');
    await assert.rejects(verifyGraduatedCase('graduated-data', workspace));
  } finally { await fs.rm(workspace, { recursive: true, force: true }); }
});
