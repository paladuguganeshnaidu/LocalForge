const fs = require('node:fs');
const path = require('node:path');
const { fileURLToPath } = require('node:url');
const ts = require('typescript');

const projectRoot = path.resolve(__dirname, '..');
const coverageDirectory = process.argv[2];
if (!coverageDirectory) throw new Error('Provide the NODE_V8_COVERAGE directory produced by the test run.');

function filesUnder(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const filename = path.join(directory, entry.name);
    return entry.isDirectory() ? filesUnder(filename) : [filename];
  });
}

const counts = new Map();
for (const filename of filesUnder(path.resolve(coverageDirectory)).filter((filename) => filename.endsWith('.json'))) {
  const coverage = JSON.parse(fs.readFileSync(filename, 'utf8'));
  for (const script of coverage.result || []) {
    if (!script.url.startsWith('file:')) continue;
    const scriptPath = fileURLToPath(script.url);
    const relativePath = path.relative(projectRoot, scriptPath).replace(/\\/g, '/');
    if (!relativePath.startsWith('dist/') || relativePath.includes('extension.bundle')) continue;
    const sourcePath = relativePath.replace(/^dist\//, 'src/').replace(/\.js$/, '.ts');
    const functions = script.functions.filter((entry) => entry.functionName && entry.ranges.some((range) => range.count > 0));
    counts.set(sourcePath, (counts.get(sourcePath) || 0) + functions.length);
  }
}

const sourceFiles = filesUnder(path.join(projectRoot, 'src')).filter((filename) => filename.endsWith('.ts'));
const testFiles = filesUnder(path.join(projectRoot, 'tests')).filter((filename) => filename.endsWith('.js'));
const inspections = sourceFiles.map((filename) => {
  const sourceText = fs.readFileSync(filename, 'utf8');
  const relativePath = path.relative(projectRoot, filename).replace(/\\/g, '/');
  const source = ts.createSourceFile(filename, sourceText, ts.ScriptTarget.Latest, true);
  const exports = source.statements.filter((statement) => statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)).map((statement) => statement.name?.getText(source) || (ts.isVariableStatement(statement) ? statement.declarationList.declarations.map((declaration) => declaration.name.getText(source)).join(', ') : ts.SyntaxKind[statement.kind]));
  const imports = source.statements.filter(ts.isImportDeclaration).map((statement) => statement.moduleSpecifier.text);
  const generated = source.statements.every((statement) => ts.isImportDeclaration(statement) || ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement));
  const executedFunctions = counts.get(relativePath) || 0;
  return { path: relativePath, exports, imports, executedFunctions, classification: generated ? 'non-runtime types' : executedFunctions ? 'executed by tests; semantic reachability still requires review' : 'needs additional test/reachability inspection' };
});

const outputDirectory = path.join(projectRoot, 'scratch');
fs.mkdirSync(outputDirectory, { recursive: true });
const report = ['# Repair source coverage ledger', '', `Generated: ${new Date().toISOString()}`, '', `${sourceFiles.length} production TypeScript files and ${testFiles.length} JavaScript test files enumerated.`, '', 'All production sources were parsed for contracts/imports. Execution counts come from V8 counters, not test-name guesses. Loading or executing a module does not prove the advertised UI workflow or every branch. Deep semantic inspection remains tracked in IMPLEMENTATION_VERIFICATION.md.', '', '| Source | Classification | Executed named functions | Exports |', '| --- | --- | ---: | --- |', ...inspections.map((entry) => `| ${entry.path} | ${entry.classification} | ${entry.executedFunctions} | ${entry.exports.join(', ')} |`)];
fs.writeFileSync(path.join(outputDirectory, 'repair-source-coverage.md'), report.join('\n') + '\n');
fs.writeFileSync(path.join(outputDirectory, 'repair-source-coverage.json'), JSON.stringify({ inspections, testFiles: testFiles.map((filename) => path.relative(projectRoot, filename).replace(/\\/g, '/')) }, null, 2));
console.log(JSON.stringify({ sources: sourceFiles.length, tests: testFiles.length, runtimeSourcesExecuted: inspections.filter((entry) => entry.executedFunctions).length, ledger: 'scratch/repair-source-coverage.md' }));
