const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const vscode = require('vscode');
const { getGraduatedCase, verifyGraduatedCase } = require('./graduatedCases');

const websitePrompt = `Build a complete production-quality landing website for NexusFlow, an AI workflow orchestrator. Create original content, branding treatment, visuals and assets. Use https://toriiminds.com/ only as visual inspiration; do not copy its source code, branding, content or assets.
Requirements: premium dark SaaS UI; animated gradient hero badge; hero with CTA buttons; product/workflow visual; feature grid; use cases; workflow section; pricing tiers; interactive pricing calculator; testimonials clearly marked illustrative; FAQ; newsletter/contact form with client-side validation and honest local-demo feedback; responsive navbar and mobile menu; responsive desktop/tablet/mobile design; smooth animations and hover states with reduced-motion support; semantic accessible HTML; SEO metadata and favicon; clean project structure; no broken links; no console errors.
This workspace is completely empty. Create everything required, including package.json if missing. Install dependencies, build the project, run it bound to localhost, open it in the browser and verify the actual result. Do not stop because a file, directory, package, configuration or tool is missing: create or repair it. Use actual offered tools to write files and execute commands. Do not claim browser or interaction checks unless your tools actually performed them. Keep all changes inside this workspace.`;

const machineLearningPrompt = `Build a complete small machine learning project in this completely empty workspace. Choose and implement a real trainable binary logistic-regression model in Python using only the standard library, so it runs on a normal laptop without paid APIs or a GPU. Create all source files, tests and documentation yourself using the offered tools.
Generate deterministic synthetic two-feature data with labels based on x1+x2 plus small noise; split training and held-out test data before fitting normalization, and avoid data leakage. Implement actual gradient-based training, numerical stability and JSON model serialization with weights, bias and normalization parameters. Implement train.py with --seed and --output-dir options; save artifacts/model.json and artifacts/metrics.json including held-out accuracy and sample counts. Implement predict.py accepting --model and --features followed by two numbers; print JSON containing class and probability from the loaded trained model.
Create meaningful unittest tests for training, reproducibility, serialization/prediction and input errors, plus a README with exact commands. Run actual training with seed 42 and output directory artifacts, and run actual tests; verify saved model and held-out accuracy of at least 0.85. Run the prediction CLI for features 2 2 and -2 -2, and verify different sensible predictions. Inspect failures and repair them; do not claim success from source files alone. No Node/npm build or browser is needed for this project. Keep all changes inside this workspace.`;

const typedJson = { name: 'typed-json-agent-test', version: '1.0.0', private: true, scripts: { build: 'node -e "console.log(1)"' } };
const jsonAgentPrompt = `Create a file named package.json in the workspace root containing exactly this JSON object: ${JSON.stringify(typedJson)}. Use the offered create_file tool with its json object argument and omit content. Do not modify any other files or run any commands. If the file exists, stop and tell me. Confirm the saved file without claiming that an application was built.`;

const minimalWebsitePrompt = `Create a small minimal responsive landing website for Torii Demo in this empty workspace, then run the website and verify it in the browser. Keep it deliberately tiny: one index.html with inline CSS and JavaScript, at most 80 lines, no framework, no external assets, no npm, no dependencies and no build step. Include a clean heading, short description, two feature cards, a semantic navigation link to the features section, viewport/description metadata, a small inline favicon and one accessible button labelled Try demo. Give the button id demo-action and a visible status element id demo-status; clicking the button must change that status text. Use original content, not copied assets or source.
Use the actual create_file tool to save the complete index.html. Start a tracked localhost server with start_dev_server using Python's built-in http.server and a free port bound to 127.0.0.1. If a tool is not currently offered, discover its exact name. Open the running URL using browser_action render, actually click the button and inspect the result. Verify the actual result at mobile and desktop widths and check console errors. Keep the server running for inspection and report its real URL. Do not merely describe or paste source: create the file, launch the server and verify the browser result with actual tools.`;

const microWebsitePrompt = `Build and launch a truly tiny Torii Demo website in this empty workspace: ONE index.html, at most 25 lines including inline CSS/JavaScript. No dependencies, framework, build step or external assets. Include lang=en, title, viewport and description metadata, a percent-encoded SVG data favicon (never raw nested quotes), ONE main landmark, a heading, short paragraph, two brief features in a section with id features, nav linking to #features, and a Try demo button id demo-action that immediately changes visible status text id demo-status. Use border-box and a simple responsive centered layout. Create it with actual tools, not a code-only answer. Start ONE tracked Python localhost server with start_dev_server; inspect process_status. Render it with browser_action, click #demo-action, and inspect at width 375 and 1440. Fix actual errors with SMALL exact edits, never a full-page replacement. Keep the server running and report its URL only after verification.`;

async function run() {
  const graduated = getGraduatedCase(process.env.LOCALFORGE_LANDING_PHASE);
  const machineLearning = process.env.LOCALFORGE_LANDING_PHASE === 'machine-learning';
  const jsonAgent = process.env.LOCALFORGE_LANDING_PHASE === 'json-agent';
  const microRepair = process.env.LOCALFORGE_LANDING_PHASE === 'micro-repair';
  const minimalVerify = process.env.LOCALFORGE_LANDING_PHASE === 'minimal-verify';
  const minimalRepair = microRepair || process.env.LOCALFORGE_LANDING_PHASE === 'minimal-repair';
  const microWebsite = process.env.LOCALFORGE_LANDING_PHASE === 'micro-website';
  const minimalWebsite = minimalVerify || minimalRepair || microWebsite || process.env.LOCALFORGE_LANDING_PHASE === 'minimal-website';
  const repairPrompt = `Create a fixed version of this existing minimal Torii Demo landing website, run the website and verify the real result in the browser. Read index.html once, then use edit_workspace_file with exact unique target blocks for surgical fixes, not another full-page rewrite. Real browser QA found: the Features href is now the relative path features, which returns HTTP 404; it must be fragment navigation to a matching features ID on the existing content. The raw SVG favicon has nested attribute quotes that break HTML; replace that icon link with a valid encoded SVG data URL. There is no main landmark: wrap the existing page content in exactly one main without duplicating headings/cards. At mobile width 375, feature width plus padding causes horizontal overflow: fix box sizing/widths while preserving the desktop layout. Preserve the demo button id demo-action and status id demo-status; no framework, dependencies or additional files are needed.
Start one tracked Python server bound to 127.0.0.1 using start_dev_server; inspect process_status. Use browser_action render and inspect actual mainLandmarks, faviconSyntaxValid, links and errors. Actually click Features and confirm it stays on the valid page/section rather than an HTTP error. Actually click #demo-action and verify the status changes. Check mobile width 375 and desktop width 1440 after the latest edit; neither may overflow. If a check fails, repair the specific cause before claiming completion. Keep the server running and report its actual URL. A status label or proposed edit is not verification.`;
  const microRepairPrompt = `Repair this existing tiny Torii Demo website and run the website and verify it in the browser. Read index.html once. Fix ONLY the real defects: there is no main landmark; #demo-action has no JavaScript handler so clicking it leaves #demo-status unchanged; the bare CSS declaration border-box is invalid. Preserve the existing correct favicon, features ID/link, content and styles otherwise. Use SMALL unique exact edits with edit_workspace_file, not a full-page rewrite or duplicated page. Create exactly one main around the existing content, implement a button handler that immediately changes the visible status text, and use valid box-sizing CSS. No dependencies or additional files. Start ONE tracked Python localhost server, inspect process_status, render with browser_action, actually click #demo-action and verify visibleTextChanged and status text. Use action viewport (not inspect) to check mobile width 375 and desktop width 1440. Inspect mainLandmarks and faviconSyntaxValid. Fix failures before claiming completion; keep the server running and report its actual URL.`;
  const verificationPrompt = `Run and verify the existing Torii Demo website. Preserve index.html exactly; no file edits, added files or dependencies. Execute these five actual checks in order, one tool action at a time, without stopping at a written plan: (1) start_dev_server with python3 -m http.server 8080 --bind 127.0.0.1; (2) process_status using the opaque returned id (proc-...), NOT the numeric OS processId; (3) browser_action render the actual http://127.0.0.1:8080 URL with width 375 and height 812; (4) browser_action click selector #demo-action and confirm visibleTextChanged is true: the button changes visible status text; (5) browser_action viewport with width 1440 and height 900, confirming mainLandmarks is 1 and no consoleErrors or networkFailures. Verify mobile and desktop. Only after all five actual tool results, give a short summary and the actual running URL. Keep the tracked server running. This is a verification-only follow-up of an existing model-authored page.`;
  const threeDimensional = process.env.LOCALFORGE_LANDING_PHASE === '3d-website';
  const threeDimensionalPrompt = `${websitePrompt}\nAlso implement a real animated interactive 3D hero scene using WebGL or Three.js, with accessible HTML alternatives, reduced-motion handling and an intentional fallback if WebGL is unavailable. Create original geometry rather than downloading models or images. Verify the real canvas renders without JavaScript/network errors. Keep the implementation compact and organized, with a functional build script, then verify it through actual terminal and browser tools. Do not claim a plan or generated source is a verified running website.`;
  const basePrompt = graduated?.prompt || (threeDimensional ? threeDimensionalPrompt : minimalVerify ? verificationPrompt : microRepair ? microRepairPrompt : minimalRepair ? repairPrompt : jsonAgent ? jsonAgentPrompt : machineLearning ? machineLearningPrompt : microWebsite ? microWebsitePrompt : minimalWebsite ? minimalWebsitePrompt : websitePrompt);
  const allocatedPort = process.env.LOCALFORGE_LANDING_PORT;
  if (allocatedPort) assert.ok(/^\d{4,5}$/.test(allocatedPort) && Number(allocatedPort) >= 1024 && Number(allocatedPort) <= 65535, 'An allocated test port must be an unprivileged valid TCP port.');
  const prompt = allocatedPort && !machineLearning && !jsonAgent && !graduated ? `${basePrompt}\nTest isolation: run your own website at http://127.0.0.1:${allocatedPort}/, bound to 127.0.0.1. Port 8080 belongs to a separately retained user preview. Do not inspect, reuse or stop that unrelated preview. All source must be created by you in this empty workspace; verify your own server, not another website.` : basePrompt;
  const runRoot = process.env.LOCALFORGE_LANDING_RUN;
  assert.ok(runRoot && path.isAbsolute(runRoot));
  const workspace = process.env.LOCALFORGE_LANDING_WORKSPACE || path.join(runRoot, 'project');
  assert.equal(path.resolve(vscode.workspace.workspaceFolders[0].uri.fsPath).toLowerCase(), workspace.toLowerCase());
  assert.deepEqual(await fs.readdir(workspace), minimalRepair || minimalVerify ? ['index.html'] : []);
  if (process.env.LOCALFORGE_LANDING_CONTEXT_TOKENS) {
    const contextTokens = Number(process.env.LOCALFORGE_LANDING_CONTEXT_TOKENS);
    assert.ok(Number.isInteger(contextTokens) && contextTokens >= 2048 && contextTokens <= 1048576, 'Context tokens must be an explicit supported positive integer.');
    await vscode.workspace.getConfiguration('localforge.ollama').update('contextWindow', contextTokens, vscode.ConfigurationTarget.Global);
  }
  if (process.env.LOCALFORGE_LANDING_TEMPERATURE) {
    const temperature = Number(process.env.LOCALFORGE_LANDING_TEMPERATURE);
    assert.ok(Number.isFinite(temperature) && temperature >= 0 && temperature <= 2);
    await vscode.workspace.getConfiguration('localforge.ollama').update('temperature', temperature, vscode.ConfigurationTarget.Global);
  }
  await fs.writeFile(path.join(runRoot, 'prompt.txt'), prompt);
  if (process.env.LOCALFORGE_LANDING_THINKING) {
    assert.ok(['0', '1'].includes(process.env.LOCALFORGE_LANDING_THINKING), 'Thinking must explicitly be 0 or 1.');
    await vscode.workspace.getConfiguration('localforge.ollama').update('agentThinking', process.env.LOCALFORGE_LANDING_THINKING === '1', vscode.ConfigurationTarget.Global);
  }
  const result = { startedAt: new Date().toISOString(), prompt, workspace, approvals: [], activities: [], progress: [], tokens: [], errors: [] };
  result.agentThinking = vscode.workspace.getConfiguration('localforge.ollama').get('agentThinking', false);
  if (minimalRepair || minimalVerify) result.resume = { label: process.env.LOCALFORGE_LANDING_RESUME, originalHtmlSha256: crypto.createHash('sha256').update(await fs.readFile(path.join(workspace, 'index.html'))).digest('hex') };
  const writeEvidence = require('./evidenceWriter').createEvidenceWriter(path.join(runRoot, 'result.json'));
  const persist = () => writeEvidence(result);
  const persistProgress = () => { void persist().catch(error => console.error('[Evidence write failure]', error.message)); };
  result.stage = 'discovering_extension';
  await persist();
  const extension = vscode.extensions.getExtension('paladuguganeshnaidu.localforge-vscode');
  assert.ok(extension, 'Installed extension must be discoverable');
  result.extension = { path: extension.extensionPath, version: extension.packageJSON.version, vscode: vscode.version };
  result.extension.bundleSha256 = crypto.createHash('sha256').update(await fs.readFile(path.join(extension.extensionPath, 'dist/extension.bundle.js'))).digest('hex');
  result.stage = 'activating_extension';
  await persist();
  const api = await extension.activate();
  await api.engine.bootstrap();
  result.stage = 'configuring_providers';
  await persist();
  if (process.env.LOCALFORGE_LANDING_SSH_PROFILE) {
    try {
      const profile = JSON.parse(process.env.LOCALFORGE_LANDING_SSH_PROFILE);
      assert.ok(/^SHA256:[A-Za-z\d+/]{43}$/.test(profile.hostFingerprint), 'An independently verified pinned SSH fingerprint is required.');
      assert.equal(profile.authenticationMethod, 'privateKey');
      await api.engine.remoteManager.saveProfile(profile);
      const session = await api.engine.remoteManager.connect(profile.id);
      api.viewProvider.setRemoteSession({ tunnel: session.tunnel, providerId: session.providerId, profileName: session.profile.name });
      result.remote = { host: profile.host, username: profile.username, hostFingerprint: profile.hostFingerprint, providerId: session.providerId, tunnelPort: session.tunnel.port, gpuStatus: await api.engine.remoteManager.refreshGpuStatus() };
      assert.ok(result.remote.gpuStatus.length, 'A remote NVIDIA GPU must actually be detected.');
      await api.engine.modelRegistry.refresh();
      await persist();
    } catch (error) {
      result.errors.push(`SSH GPU setup failed: ${error.message}`);
      result.finishedAt = new Date().toISOString();
      await api.engine.remoteManager.disconnect();
      await persist();
      throw error;
    }
  }
  if (!api.engine.modelRegistry.getModels().length) await api.engine.modelRegistry.refresh();
  result.models = api.engine.modelRegistry.getModels();
  try { result.vscodeLanguageModels = (await vscode.lm.selectChatModels({})).map(model => ({ id: model.id, name: model.name, vendor: model.vendor, family: model.family })); }
  catch (error) { result.languageModelError = error.message; }
  result.gpt61SolAvailable = result.models.some(model => /gpt[- .]?6[. -]?1.*sol/i.test(model.name));
  result.tools = api.engine.toolRegistry.getAllTools().map(tool => ({ name: tool.name, description: tool.definition.function.description, parameters: tool.definition.function.parameters, executable: typeof tool.handler === 'function', policy: tool.descriptor }));
  result.registeredToolCount = result.tools.length;
  result.uniqueExecutableTools = new Set(result.tools.filter(tool => tool.executable).map(tool => tool.name)).size;
  result.hundredToolsGate = result.uniqueExecutableTools >= 100;
  result.stage = 'tools_discovered';
  await persist();
  if (process.env.LOCALFORGE_LANDING_PHASE === 'transport-smoke') {
    const http = require('node:http');
    const server = http.createServer((request, response) => {
      request.resume();
      if (request.url === '/api/chat') setTimeout(() => {
        if (!response.destroyed) response.writeHead(200, { 'Content-Type': 'application/x-ndjson' }).end('{"message":{"content":"NATIVE_DELAY_OK"},"done":true}\n');
      }, 310000);
      else if (request.url === '/api/version') response.end('{"version":"controlled-transport-fixture"}');
      else if (request.url === '/api/tags') response.end('{"models":[]}');
      else response.writeHead(404).end();
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
      await api.engine.updateProviderConfiguration({ ollamaEndpoint: `http://127.0.0.1:${server.address().port}`, openAiEndpoints: '' });
      const provider = api.engine.modelRegistry.getProvider('ollama');
      let text = '';
      const started = Date.now();
      await provider.streamChat('controlled-transport-fixture', [{ role: 'user', content: 'Transport check' }], delta => { text += delta; }, AbortSignal.timeout(360000));
      assert.equal(text, 'NATIVE_DELAY_OK');
      assert.ok(Date.now() - started >= 310000);
      result.transportSmokePassed = true;
      result.delayedHeaderMilliseconds = Date.now() - started;
      console.log('[TransportSmoke] Installed runtime survived more than five minutes without headers. Controlled HTTP fixture, NOT model or website acceptance.');
    } catch (error) { result.errors.push(error.stack || error.message); throw error; }
    finally { result.finishedAt = new Date().toISOString(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await persist(); }
    return;
  }
  if (process.env.LOCALFORGE_LANDING_PHASE === 'tool-smoke') {
    api.engine.permissionManager.setMode('always_proceed');
    let sabotage = false;
    const manifest = { name: 'agent-tool-smoke', version: '1.0.0', private: true, scripts: { build:'node build.cjs', lint:'node --check build.cjs' } };
    api.engine.permissionManager.setApprovalHandler(async request => {
      result.approvals.push({ tool: request.toolName, command: request.command, args: request.args, policy: request.policy });
      if (sabotage && request.toolName === 'run_build') await fs.writeFile(path.join(workspace, 'package.json'), JSON.stringify({ ...manifest, scripts:{ ...manifest.scripts, build:'node missing-malicious-file.cjs' } }));
      return true;
    });
    const execute = (name, args = {}) => api.engine.toolRegistry.executeTool(name, args, api.engine.permissionManager);
    try {
      await execute('create_directory', { path:'src/components' });
      assert.equal((await fs.stat(path.join(workspace,'src/components'))).isDirectory(), true);
      const written = await execute('create_file', { path:'package.json', content:JSON.stringify(manifest) });
      assert.equal(written.applied, true);
      await execute('create_file', { path:'build.cjs', content:'require("node:fs").writeFileSync("build-proof.txt","BUILD_OK"); console.log("BUILD_OK");' });
      assert.equal((await execute('file_stat',{ path:'package.json' })).exists,true);
      assert.equal((await execute('file_stat',{ path:'not-created.txt' })).exists,false);
      assert.equal((await execute('inspect_package_scripts')).scripts.build,manifest.scripts.build);
      assert.equal((await execute('install_packages', { packages: ['is-number@7.0.0'], dev: true })).exitCode, 0);
      assert.equal(JSON.parse(await fs.readFile(path.join(workspace, 'package.json'), 'utf8')).devDependencies['is-number'], '^7.0.0');
      const installedDependency = await execute('run_command', { command: 'node -e "if(!require(\'is-number\')(42))process.exit(1);console.log(\'INSTALLED_DEPENDENCY_VERIFIED\')"' });
      assert.equal(installedDependency.exitCode, 0);
      assert.match(installedDependency.stdout, /INSTALLED_DEPENDENCY_VERIFIED/);
      assert.equal((await execute('install_dependencies')).exitCode,0);
      assert.equal((await execute('run_build')).exitCode,0);
      assert.equal(await fs.readFile(path.join(workspace,'build-proof.txt'),'utf8'),'BUILD_OK');
      assert.equal((await execute('run_lint')).exitCode,0);
      sabotage=true;
      await assert.rejects(execute('run_build'), /changed after approval/);
      sabotage=false;
      await fs.writeFile(path.join(workspace,'package.json'),JSON.stringify(manifest));
      const fixtureHtml = '<!doctype html><html lang="en"><head><title>Native controlled fixture</title></head><body><h1>Native fixture</h1><button id="change" onclick="document.querySelector(\'h1\').textContent=\'Changed\'">Change</button><label for="email">Email</label><input id="email" type="email" required></body></html>';
      await execute('create_file', { path:'server.cjs', content:'const http=require("node:http"),fs=require("node:fs");const server=http.createServer((req,res)=>{res.setHeader("Content-Type","text/html");res.end(' + JSON.stringify(fixtureHtml) + ');});server.listen(0,"127.0.0.1",()=>fs.writeFileSync("port.txt",String(server.address().port)));' });
      const process = await execute('start_dev_server',{ command:'node server.cjs --host 127.0.0.1' });
      assert.equal(process.status,'running');
      const reused = await execute('start_dev_server',{ command:'node server.cjs --host 127.0.0.1' });
      assert.equal(reused.id, process.id);
      assert.equal(reused.reused, true);
      assert.equal(api.engine.terminalManager.getRunningProcesses().length, 1);
      let port;
      for(let attempt=0; attempt<100 && !port; attempt+=1){ try {port=Number(await fs.readFile(path.join(workspace,'port.txt'),'utf8'));} catch{} if(!port) await new Promise(resolve=>setTimeout(resolve,50)); }
      assert.ok(port);
      assert.equal((await execute('process_status',{process_id:process.id}))[0].status,'running');
      const rendered=await execute('browser_action',{action:'render',url:`http://127.0.0.1:${port}`});
      assert.equal(rendered.title,'Native controlled fixture');
      assert.equal(rendered.rendered,true);
      assert.equal((await execute('browser_action',{action:'click',selector:'#change'})).headings[0].text,'Changed');
      assert.equal((await execute('browser_action',{action:'fill',selector:'#email',value:'test@example.com'})).forms[0].valid,true);
      for(const width of [375,768,1440]) assert.equal((await execute('browser_action',{action:'viewport',width,height:900})).horizontalOverflow,false);
      assert.equal((await execute('stop_process',{process_id:process.id})).stopRequested,true);
      await assert.rejects(execute('stop_process',{process_id:'unowned-user-process'}),/Unknown tracked process/);
      const python = await execute('start_dev_server', { command: 'python3 -m http.server 0' });
      assert.equal(python.status, 'running');
      assert.equal(python.command, 'python3 -m http.server 0 --bind 127.0.0.1');
      assert.ok(result.approvals.some(approval => approval.tool === 'start_dev_server' && approval.command === python.command));
      assert.equal((await execute('stop_process', { process_id: python.id })).stopRequested, true);
      result.toolSmokePassed=true;
      console.log('[ToolSmoke] Native registered edits/directories/package install/build/lint/process/browser/approval-mutation checks passed. Controlled fixture, NOT a model-generated website.');
    } catch(error) { result.errors.push(error.stack || error.message); throw error; }
    finally { result.finishedAt=new Date().toISOString(); result.processes=api.engine.terminalManager.getAllProcesses(); await api.engine.browserTool.dispose(); for(const process of api.engine.terminalManager.getRunningProcesses()) api.engine.terminalManager.stopProcess(process.id); await persist(); }
    return;
  }
  const modelId = process.env.LOCALFORGE_LANDING_MODEL;
  if (process.env.LOCALFORGE_LANDING_EFFORT) {
    assert.ok(['low', 'medium', 'high', 'ultra'].includes(process.env.LOCALFORGE_LANDING_EFFORT));
    await api.engine.sessionManager.updateSession(api.engine.sessionManager.getActiveSession().id, { effort: process.env.LOCALFORGE_LANDING_EFFORT });
  }
  result.effort = api.engine.sessionManager.getActiveSession().effort ?? 'medium';
  const model = result.models.find(candidate => candidate.id === modelId || candidate.name === modelId);
  if (!model) { result.errors.push(`Requested model ${modelId} is not registered. No silent model substitution.`); result.finishedAt = new Date().toISOString(); await api.engine.remoteManager.disconnect(); await persist(); throw new Error(result.errors.at(-1)); }
  result.selectedModel = model;
  if (threeDimensional && result.remote) {
    try {
      result.remote.downloadTargets = await api.engine.compositeProvider.getDownloadTargets();
      assert.ok(result.remote.downloadTargets.some(target => target.id === result.remote.providerId), 'Exact remote host must be an executable download target.');
      result.remote.downloadProgress = [];
      await api.engine.compositeProvider.pullModelToProvider(result.remote.providerId, model.name, progress => result.remote.downloadProgress.push(progress), AbortSignal.timeout(120000));
      result.remote.existingModelPullVerified = true;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 120000);
      let characters = 0;
      try {
        await assert.rejects(api.engine.compositeProvider.streamChat(model.id, [{ role: 'user', content: 'For a streaming cancellation test, write a long numbered list of 1000 ordinary English words. Start the list immediately.' }], token => { characters += token.length; if (characters > 0) controller.abort(); }, controller.signal));
        assert.ok(characters > 0, 'Cancellation must interrupt actual visible model generation, not a connection timeout.');
        result.remote.cancellationAfterContentPassed = true;
      } finally { result.remote.cancellationProbeCharacters = characters; clearTimeout(timeout); }
      await persist();
    } catch (error) {
      result.errors.push(`Remote download/cancellation integration failed: ${error.stack || error.message}`);
      result.terminalStatus = 'failed_before_task';
      result.finishedAt = new Date().toISOString();
      await api.engine.remoteManager.disconnect();
      await persist();
      throw error;
    }
  }
  result.modelSmokeResponse = '';
  try {
    await api.engine.compositeProvider.streamChat(model.id, [{ role:'user', content:'Reply exactly: LOMVREN model connectivity verified.' }], token => { result.modelSmokeResponse += token; }, AbortSignal.timeout(120000));
  } catch (error) {
    result.errors.push(`Model connectivity smoke failed: ${error.stack || error.message}`);
    result.terminalStatus = 'failed_before_task';
    result.finishedAt = new Date().toISOString();
    await api.engine.remoteManager.disconnect();
    await persist();
    throw error;
  }
  result.ollamaGenerationConfiguration = { contextWindow: vscode.workspace.getConfiguration('localforge.ollama').get('contextWindow', 8192), maxOutputTokens: vscode.workspace.getConfiguration('localforge.ollama').get('maxOutputTokens', -1), temperature: vscode.workspace.getConfiguration('localforge.ollama').get('temperature', 0.1), agentThinking: vscode.workspace.getConfiguration('localforge.ollama').get('agentThinking', false) };
  if (result.remote) {
    const response = await fetch(`http://127.0.0.1:${result.remote.tunnelPort}/api/ps`, { signal: AbortSignal.timeout(10000) });
    assert.ok(response.ok, 'Actual remote loaded-model inspection must respond.');
    result.remote.loadedModelsAfterSmoke = await response.json();
  }
  api.engine.permissionManager.setMode('always_proceed');
  api.engine.permissionManager.setApprovalHandler(async request => {
    const command = request.command || '';
    const allowed = !/\b(?:publish|unpublish|login|shutdown|reboot|taskkill|format|sudo)\b|\bgit\s+(?:push|reset|clean)|\brm\s+-rf|\bdel\s+|\bRemove-Item\b|\.ssh|\.aws/i.test(command) && !['delete_file', 'rollback_changes', 'git_commit', 'read_machine_file', 'list_machine_directory'].includes(request.toolName);
    result.approvals.push({ tool: request.toolName, command, path: request.path, args: request.args, policy: request.policy, allowed, at: new Date().toISOString() });
    console.log(`[Landing approval] ${allowed ? 'allowed' : 'denied'} ${request.toolName}: ${command || request.path || ''}`);
    await persist();
    return allowed;
  });
  await vscode.commands.executeCommand('localforge.openAgent');
  await vscode.commands.executeCommand('localforge.setModel', model.id);
  await vscode.workspace.getConfiguration('localforge.agent').update('maxRounds', 0, vscode.ConfigurationTarget.Global);
  result.maxRounds = 0;
  const timeoutMinutes = Math.max(1, Math.min(240, Number(process.env.LOCALFORGE_LANDING_TIMEOUT_MINUTES) || 15));
  result.watchdogMinutes = timeoutMinutes;
  const watchdog = setTimeout(() => { result.errors.push(`Test watchdog cancelled the agent after ${timeoutMinutes} minutes; this is not completion.`); api.engine.cancelCurrentTask(); }, timeoutMinutes * 60 * 1000);
  const cancellation = setInterval(async () => { try { await fs.access(path.join(runRoot, 'stop-request')); if (!result.stopRequestedAt) { result.stopRequestedAt = new Date().toISOString(); await persist(); } api.engine.cancelCurrentTask(); } catch {} }, 1000);
  try {
    result.stage = 'executing_agent';
    await persist();
    const executeTask = api.engine.executeTask.bind(api.engine);
    api.engine.executeTask = async (task, mode, selectedModel, options = {}) => {
      const summary = await executeTask(task, mode, selectedModel, {
        ...options,
        onProgress: message => { options.onProgress?.(message); result.progress.push({ at: new Date().toISOString(), message }); if (result.progress.length > 4000) result.progress.shift(); persistProgress(); console.log(`[Landing agent] ${message}`); },
        onToken: token => { options.onToken?.(token); result.tokens.push(token); },
        onActivity: activity => { options.onActivity?.(activity); result.activities.push(structuredClone(activity)); persistProgress(); console.log(`[Landing activity] ${activity.status}: ${activity.title}`); }
      });
      result.summary = summary;
      return summary;
    };
    try { await api.viewProvider.sendUserPrompt(prompt, { mode: 'agent', strategy: 'fast' }); }
    finally { api.engine.executeTask = executeTask; }
    const running = api.engine.terminalManager.getRunningProcesses();
    const rendered = result.activities.filter(activity => activity.toolName === 'browser_action' && activity.status === 'success').map(activity => activity.outputSummary || '').reverse();
    const candidates = [...rendered, ...running.map(process => process.stdout)].flatMap(text => text.match(/https?:\/\/(?:localhost|127\.0\.0\.1):\d+[^\s"\\<>]*/g) || []);
    if (graduated) {
      result.independentTaskVerification = await verifyGraduatedCase(graduated.id, workspace);
    } else if (jsonAgent) {
      assert.deepEqual(JSON.parse(await fs.readFile(path.join(workspace, 'package.json'), 'utf8')), typedJson);
      assert.deepEqual(await fs.readdir(workspace), ['package.json']);
      assert.equal(result.summary.status, 'completed');
      assert.equal(api.engine.editEngine.getPendingProposals().length, 0);
      result.typedJsonAgentPassed = true;
      console.log('[TypedJsonAgent] Actual local model created exact typed JSON through the installed native edit engine. No application acceptance claimed.');
    } else if (machineLearning) {
      const { verifyAgentMachineLearning } = require('../../scripts/verify-agent-ml.cjs');
      result.independentMachineLearningVerification = await verifyAgentMachineLearning(workspace, path.join(runRoot, 'ml-verification'));
    } else if (running.length && candidates.length) {
      if (minimalVerify) {
        assert.deepEqual(await fs.readdir(workspace), ['index.html']);
        assert.equal(crypto.createHash('sha256').update(await fs.readFile(path.join(workspace, 'index.html'))).digest('hex'), result.resume.originalHtmlSha256);
        const browserResults = result.activities.filter(activity => activity.toolName === 'browser_action' && activity.status === 'success' && activity.outputSummary?.startsWith('Result\n')).map(activity => JSON.parse(activity.outputSummary.slice(7))).filter(output => output.rendered === true && output.success === true && !output.duplicateSuppressed);
        assert.ok(browserResults.some(output => output.viewport?.width === 375), 'Model must actually verify mobile.');
        assert.ok(browserResults.some(output => output.viewport?.width === 1440), 'Model must actually verify desktop.');
        assert.ok(browserResults.some(output => output.action === 'click' && output.visibleTextChanged === true), 'Model must actually verify the button effect.');
        assert.ok(result.activities.some(activity => activity.toolName === 'process_status' && activity.status === 'success'), 'Model must actually inspect the tracked process.');
        result.focusedExistingSiteVerificationPassed = result.summary.status === 'completed';
      }
      const { verifyAgentWebsite } = require('../../scripts/verify-agent-website.cjs');
      result.independentWebsiteVerification = await verifyAgentWebsite(candidates[0], path.join(runRoot, 'browser-verification'), { profile: minimalWebsite ? 'minimal' : 'full', require3D: threeDimensional });
      if (result.summary?.status === 'completed' && result.independentWebsiteVerification.passed && process.env.LOCALFORGE_KEEP_WEBSITE === '1') {
        clearTimeout(watchdog);
        clearInterval(cancellation);
        result.agentFinishedAt = new Date().toISOString();
        result.livePreview = { url: candidates[0], processIds: running.map(process => process.id), retainedUntilStopRequest: true };
        await persist();
        console.log(`[Live preview] Verified agent-built website retained at ${candidates[0]}. Write stop-request to this owned test run to close it.`);
        await new Promise(resolve => {
          const deadline = Date.now() + 2 * 60 * 60 * 1000;
          const poll = setInterval(async () => {
            let stop = Date.now() >= deadline;
            try { await fs.access(path.join(runRoot, 'stop-request')); stop = true; } catch {}
            if (stop) { clearInterval(poll); resolve(); }
          }, 1000);
        });
      }
    } else result.independentWebsiteVerification = { passed: false, blocker: 'No model-started running localhost website was available for independent browser QA.' };
  } catch (error) {
    result.errors.push(error.stack || error.message);
    result.transportErrorCode = error.cause?.cause?.code || error.cause?.code;
    if (error.cmd || error.stdout || error.stderr) result.independentExecutionFailure = { command: error.cmd, code: error.code, stdout: String(error.stdout || '').slice(-16000), stderr: String(error.stderr || '').slice(-16000) };
  }
  finally {
    clearTimeout(watchdog);
    clearInterval(cancellation);
    result.finishedAt = new Date().toISOString();
    result.terminalStatus = result.summary?.status || (result.stopRequestedAt ? 'cancelled' : 'failed');
    result.rootFiles = await fs.readdir(workspace);
    result.pendingProposals = api.engine.editEngine.getPendingProposals();
    result.processes = api.engine.terminalManager.getAllProcesses();
    await persist();
    await api.engine.browserTool.dispose();
    await api.engine.remoteManager.disconnect();
    try { await api.engine.terminalManager.stopAllProcesses(); result.processCleanupPassed = true; }
    catch (error) { result.processCleanupPassed = false; result.errors.push(`Owned process cleanup failed: ${error.message}`); }
    result.processesAfterCleanup = api.engine.terminalManager.getAllProcesses();
    await persist();
  }
  console.log(`[Landing result] ${result.summary?.status || 'failed'}; root files: ${result.rootFiles.join(', ')}; tool count ${result.uniqueExecutableTools}; GPT 6.1 SOL available ${result.gpt61SolAvailable}`);
  require('./acceptance').assertAgentAcceptance(result, process.env.LOCALFORGE_LANDING_PHASE);
}

async function runWithEvidence() {
  try { await run(); }
  catch (error) {
    const runRoot = process.env.LOCALFORGE_LANDING_RUN;
    if (runRoot && path.isAbsolute(runRoot)) {
      let recorded = {};
      try { recorded = JSON.parse(await fs.readFile(path.join(runRoot, 'result.json'), 'utf8')); } catch {}
      recorded.errors = [...(recorded.errors || []), error.stack || String(error)];
      recorded.terminalStatus ||= recorded.stage === 'executing_agent' ? 'failed' : 'failed_before_task';
      recorded.finishedAt ||= new Date().toISOString();
      await require('./evidenceWriter').createEvidenceWriter(path.join(runRoot, 'result.json'))(recorded);
    }
    console.error('[Native test failure]', error.stack || error);
    throw error;
  }
}

module.exports = { run: runWithEvidence };
