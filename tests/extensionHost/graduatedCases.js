const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const execute = promisify(execFile);
function executionOptions(workspace) {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  return { cwd: workspace, env, timeout: 30000, maxBuffer: 1024 * 1024 };
}
const cases = [
  {
    id: 'graduated-file',
    prompt: 'Create exactly one file agent-edit-test.md in this completely empty workspace. Its exact content must be two lines: "# Agent Edit Test" then "LOMVREN successfully created this file." End with a newline. Use actual file tools, save it, then read the saved file once to verify. Do not include these instructions in the file. Do not create or modify any other file. No commands, dependencies or website are needed. Report the actual outcome.'
  },
  {
    id: 'graduated-node',
    prompt: 'In this empty workspace create exactly math.cjs and math.test.cjs. Implement and export add(a,b) in math.cjs using CommonJS. Both arguments must be finite numbers; otherwise throw TypeError. Add at least 6 registered node:test tests in math.test.cjs: import node:test and use test() for separate positive, negative and fractional sums plus strings, NaN and Infinity rejection. Top-level assertions alone are not registered tests. No npm, dependencies, package.json, build or browser is required. Run node --test math.test.cjs using the real command tool, inspect the actual test count, repair any failures and report actual test results. Save both files with real editing tools; do not respond with source code only.'
  },
  {
    id: 'graduated-data',
    prompt: 'Create clean.cjs in this empty workspace using only Node standard-library APIs. When run as node clean.cjs it must trim these embedded rows [{name:" Ada ",score:"10"},{name:"Lin",score:"20"},{name:"Bad",score:"invalid"},{name:" ",score:"5"},{name:"Grace",score:"30"}], keep only nonempty names and finite numeric scores, and write cleaned.csv with header name,score and rows Ada,10 then Lin,20 then Grace,30. Write summary.json containing exactly {"validCount":3,"invalidCount":2,"total":60,"mean":20}. Here total is the SUM of valid scores (10+20+30), not the input row count; mean is total/validCount. Compare both actual saved outputs with these exact expected values and repair any mismatch before completion. Keep all data and output inside the workspace. Execute the actual script, read both saved outputs, and report the real result. No dependencies, package.json, website or build is required. Create no other files.'
  }
];

function getGraduatedCase(id) { return cases.find(candidate => candidate.id === id); }

async function verifyGraduatedCase(id, workspace) {
  assert.ok(getGraduatedCase(id), 'Unknown graduated task');
  const rootFiles = (await fs.readdir(workspace)).sort();
  if (id === 'graduated-file') {
    assert.deepEqual(rootFiles, ['agent-edit-test.md']);
    assert.equal((await fs.readFile(path.join(workspace, rootFiles[0]), 'utf8')).replace(/\r\n/g, '\n'), '# Agent Edit Test\nLOMVREN successfully created this file.\n');
    return { passed: true, kind: 'Exact independently read saved file; not application acceptance' };
  }
  if (id === 'graduated-node') {
    assert.deepEqual(rootFiles, ['math.cjs', 'math.test.cjs']);
    const independent = `const assert=require('node:assert/strict');const {add}=require('./math.cjs');assert.equal(add(2,3),5);assert.equal(add(-5,3),-2);assert.equal(add(.5,.25),.75);for(const invalid of ['2',NaN,Infinity,null,undefined]){assert.throws(()=>add(invalid,1),TypeError);assert.throws(()=>add(1,invalid),TypeError);}console.log('INDEPENDENT_NODE_CHECK_OK');`;
    const node = process.env.LOCALFORGE_AGENT_NODE_BINARY || process.execPath;
    const checked = await execute(node, ['-e', independent], executionOptions(workspace));
    assert.match(checked.stdout, /INDEPENDENT_NODE_CHECK_OK/);
    const tests = await execute(node, ['--test', '--test-reporter=tap', 'math.test.cjs'], executionOptions(workspace));
    assert.match(tests.stdout, /# pass [1-9]/);
    assert.match(tests.stdout, /# fail 0/);
    const executedTests = Number(tests.stdout.match(/# tests (\d+)/)?.[1]);
    assert.ok(executedTests >= 6, 'The requested positive, negative, fractional and invalid-input cases need real registered tests; a passing file alone is not enough.');
    return { passed: true, kind: 'Generated Node program and generated tests executed independently', independentStdout: checked.stdout, testStdout: tests.stdout };
  }
  assert.deepEqual(rootFiles, ['clean.cjs', 'cleaned.csv', 'summary.json']);
  const firstCsv = await fs.readFile(path.join(workspace, 'cleaned.csv'), 'utf8');
  const firstSummary = await fs.readFile(path.join(workspace, 'summary.json'), 'utf8');
  assert.equal(firstCsv.replace(/\r\n/g, '\n').trim(), 'name,score\nAda,10\nLin,20\nGrace,30');
  assert.deepEqual(JSON.parse(firstSummary), { validCount: 3, invalidCount: 2, total: 60, mean: 20 });
  const rerun = await execute(process.env.LOCALFORGE_AGENT_NODE_BINARY || process.execPath, ['clean.cjs'], executionOptions(workspace));
  assert.equal(await fs.readFile(path.join(workspace, 'cleaned.csv'), 'utf8'), firstCsv);
  assert.equal(await fs.readFile(path.join(workspace, 'summary.json'), 'utf8'), firstSummary);
  assert.deepEqual((await fs.readdir(workspace)).sort(), rootFiles);
  return { passed: true, kind: 'Actual CSV/JSON outputs and deterministic independent program rerun', stdout: rerun.stdout };
}

module.exports = { cases, getGraduatedCase, verifyGraduatedCase };
