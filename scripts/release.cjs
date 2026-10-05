const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline/promises');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const { planPackage } = require('./package-extension.cjs');

function parseReleaseInputs(args) {
  const input = { install: false, publish: false };
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    if (flag === '--install' || flag === '--publish') input[flag.slice(2)] = true;
    else if (flag === '--version' || flag === '--output') {
      const value = args[++index];
      if (!value || value.startsWith('--') || input[flag.slice(2)] !== undefined) throw new Error(`Provide one value for ${flag}.`);
      input[flag.slice(2)] = value;
    } else throw new Error(`Unknown release option: ${flag}`);
  }
  if (input.version !== undefined && !/^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/.test(input.version)) throw new Error('Use a stable version such as 0.3.3; no paths or shell syntax.');
  if (input.output !== undefined && !/^[a-zA-Z0-9][a-zA-Z0-9.-]*\.vsix$/.test(input.output)) throw new Error('Output must be a simple new .vsix filename, not a path or command.');
  return input;
}

function findWindowsCodeInstallation(roots) {
  for (const root of roots) {
    const binary = path.join(root, 'Code.exe');
    const command = path.join(root, 'bin/code.cmd');
    if (!fs.existsSync(binary) || !fs.existsSync(command)) continue;
    const cliRelative = fs.readFileSync(command, 'utf8').match(/"%~dp0([^"\r\n]*[\\/]resources[\\/]app[\\/]out[\\/]cli\.js)"/i)?.[1];
    if (!cliRelative) continue;
    const cli = path.resolve(path.dirname(command), cliRelative.replace(/\\/g, path.sep));
    const relative = path.relative(path.resolve(root), cli);
    if (relative.startsWith('..') || path.isAbsolute(relative) || !fs.existsSync(cli)) continue;
    return { binary, cli };
  }
  throw new Error('VS Code user installation not found. Install the preserved VSIX manually through Extensions: Install from VSIX.');
}

async function main() {
  const root = path.resolve(__dirname, '..');
  let input = parseReleaseInputs(process.argv.slice(2));
  if (!input.version) {
    if (!process.stdin.isTTY) throw new Error('Provide --version for noninteractive releases.');
    const prompt = readline.createInterface({ input: process.stdin, output: process.stdout });
    try { input = parseReleaseInputs([...process.argv.slice(2), '--version', (await prompt.question('New extension version (for example 0.3.3): ')).trim()]); }
    finally { prompt.close(); }
  }
  const manifestPath = path.join(root, 'package.json');
  const lockPath = path.join(root, 'package-lock.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
  if (manifest.name !== 'localforge-vscode' || manifest.publisher !== 'paladuguganeshnaidu' || lock.version !== manifest.version || lock.packages?.['']?.version !== manifest.version) throw new Error('Extension identity and lock versions must match before release.');
  const output = planPackage(root, input.output || `${manifest.name}-${input.version}.vsix`);
  const npm = path.join(path.dirname(process.env.npm_execpath || ''), 'npm-cli.js');
  if (!fs.existsSync(npm)) throw new Error('Run this helper through npm run release.');
  const run = (binary, args, environment = process.env) => execFileSync(binary, args, { cwd: root, stdio: 'inherit', windowsHide: true, env: environment });
  manifest.version = input.version;
  lock.version = input.version;
  lock.packages[''].version = input.version;
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  fs.writeFileSync(lockPath, JSON.stringify(lock, null, 2) + '\n');
  run(process.execPath, [npm, 'test']);
  run(process.execPath, [path.join(root, 'scripts/package-extension.cjs'), output]);
  const digest = createHash('sha256').update(fs.readFileSync(output)).digest('hex');
  console.log(`Verified package: ${output}\nSHA256: ${digest}\nAutomated packaging is not real-model/GPU acceptance or production certification.`);
  if (input.install) {
    if (process.platform === 'win32') {
      const { binary, cli } = findWindowsCodeInstallation([path.join(process.env.LOCALAPPDATA || '', 'Programs/Microsoft VS Code'), path.join(os.homedir(), 'AppData/Local/Programs/Microsoft VS Code')]);
      run(binary, [cli, '--install-extension', output, '--force'], { ...process.env, VSCODE_DEV: '', ELECTRON_RUN_AS_NODE: '1' });
    } else run('code', ['--install-extension', output, '--force']);
  }
  if (input.publish) {
    if (!process.stdin.isTTY) throw new Error('Marketplace publishing requires interactive confirmation after real acceptance checks.');
    const prompt = readline.createInterface({ input: process.stdin, output: process.stdout });
    let confirmed;
    try { confirmed = await prompt.question(`After real GPU/task tests, type PUBLISH ${input.version} to upload this exact VSIX: `); }
    finally { prompt.close(); }
    if (confirmed !== `PUBLISH ${input.version}`) throw new Error('Publish cancelled; the local package is preserved.');
    run(process.execPath, [path.join(root, 'node_modules/@vscode/vsce/vsce'), 'publish', '--packagePath', output]);
  }
}

module.exports = { parseReleaseInputs, findWindowsCodeInstallation };
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
