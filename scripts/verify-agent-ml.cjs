const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const execute = promisify(execFile);

async function verifyAgentMachineLearning(workspace, outputDirectory) {
  const root = await fs.realpath(workspace);
  const output = path.resolve(outputDirectory);
  await fs.mkdir(output, { recursive: true });
  const result = { startedAt: new Date().toISOString(), workspace: root, checks: {}, commands: [], passed: false };
  const run = async args => {
    const record = { executable: 'python', args, startedAt: new Date().toISOString() };
    try {
      const process = await execute('python', args, { cwd: root, windowsHide: true, timeout: 120000, maxBuffer: 1024 * 1024 });
      Object.assign(record, process, { exitCode: 0 });
    } catch (error) {
      Object.assign(record, { stdout: error.stdout, stderr: error.stderr, exitCode: error.code, error: error.message });
    }
    result.commands.push(record);
    return record;
  };
  const read = async relative => {
    const target = await fs.realpath(path.join(root, relative));
    if (path.relative(root, target).startsWith('..') || path.isAbsolute(path.relative(root, target))) throw new Error('Generated artifact resolves outside the test project.');
    const stat = await fs.stat(target);
    if (!stat.isFile() || stat.size > 512 * 1024) throw new Error('Expected a bounded regular generated artifact.');
    return fs.readFile(target, 'utf8');
  };
  try {
    await read('train.py');
    await read('predict.py');
    const modelText = await read('artifacts/model.json');
    const model = JSON.parse(modelText);
    const metrics = JSON.parse(await read('artifacts/metrics.json'));
    result.modelSha256 = crypto.createHash('sha256').update(modelText).digest('hex');
    result.metrics = metrics;
    result.checks.savedTrainableModel = Array.isArray(model.weights) && model.weights.length === 2 && model.weights.every(Number.isFinite) && model.weights.some(weight => Math.abs(weight) > 0.001) && Number.isFinite(model.bias);
    const accuracy = metrics.test_accuracy ?? metrics.held_out_accuracy ?? metrics.accuracy;
    result.checks.heldOutAccuracy = Number.isFinite(accuracy) && accuracy >= 0.85 && accuracy <= 1;
    const syntax = await run(['-m', 'compileall', '-q', '.']);
    result.checks.syntax = syntax.exitCode === 0;
    const tests = await run(['-m', 'unittest', 'discover', '-s', 'tests', '-v']);
    const testCount = Number((`${tests.stdout}\n${tests.stderr}`.match(/Ran (\d+) tests?/) || [])[1]);
    result.testCount = testCount || 0;
    result.checks.meaningfulTestsExecuted = tests.exitCode === 0 && testCount >= 4;
    const negative = await run(['predict.py', '--model', 'artifacts/model.json', '--features', '-2', '-2']);
    const positive = await run(['predict.py', '--model', 'artifacts/model.json', '--features', '2', '2']);
    if (negative.exitCode === 0 && positive.exitCode === 0) {
      const low = JSON.parse(negative.stdout.trim());
      const high = JSON.parse(positive.stdout.trim());
      result.predictions = { negative: low, positive: high };
      result.checks.actualPrediction = low.class === 0 && high.class === 1 && Number.isFinite(low.probability) && Number.isFinite(high.probability) && low.probability >= 0 && high.probability <= 1 && high.probability - low.probability > 0.3;
    } else result.checks.actualPrediction = false;
    result.checks.modelNotMutatedByPrediction = result.modelSha256 === crypto.createHash('sha256').update(await read('artifacts/model.json')).digest('hex');
    result.passed = Object.values(result.checks).every(Boolean);
  } catch (error) { result.error = error.stack || error.message; }
  finally {
    result.finishedAt = new Date().toISOString();
    result.limitations = 'Checks execute agent-generated code and inspect existing training artifacts; this verifier does not create model source or run training in place of the agent. Passing shape/CLI/tests/recorded metrics alone is not proof of data provenance, absence of leakage or production model quality; source review is still required.';
    await fs.writeFile(path.join(output, 'verification.json'), JSON.stringify(result, null, 2));
  }
  return result;
}

module.exports = { verifyAgentMachineLearning };
if (require.main === module) verifyAgentMachineLearning(process.argv[2], process.argv[3]).then(result => { console.log(JSON.stringify(result, null, 2)); process.exitCode = result.passed ? 0 : 1; }).catch(error => { console.error(error); process.exitCode = 1; });
