import { AgentState } from './agentLoop';
import { getEditRequestPolicy } from '../editing/editRequestPolicy';
import { positiveTaskRequirements } from './taskRequirements';

export function validateCodingCompletion(task: string, state: AgentState): string | undefined {
  if (/^\s*(?:please\s+)?(?:create|write)\s+(?:a\s+)?(?:new\s+)?file\b/i.test(task) && getEditRequestPolicy(task).onlyPath) return undefined;
  const requestedTask = positiveTaskRequirements(task);
  const website = /\b(?:website|web\s*site|landing\s*(?:website|page)|web\s*app|application|portfolio)\b/i.test(requestedTask);
  const machineLearning = /\b(?:machine[ -]learning|ML)\b/i.test(requestedTask) && /\bproject\b/i.test(requestedTask);
  const creation = /\b(?:build|create|implement|develop|make)\b/i.test(requestedTask);
  const launch = website && /\b(?:run|launch)\b/i.test(requestedTask);
  const verification = website && /\bverify\b/i.test(requestedTask);
  const requestedTests = /\b(?:run|execute)\s+(?:the\s+)?(?:actual\s+)?(?:node\s+--test|(?:npm|pnpm|yarn)\s+(?:run\s+)?test|(?:python(?:3)?|py(?:\s+-3)?)\s+-m\s+(?:unittest|pytest))\b/i.test(requestedTask);
  if ((!creation && !launch && !verification && !requestedTests) || !website && !machineLearning && !requestedTests) return undefined;
  const calls = state.steps.flatMap(step => step.toolCalls);
  const successful = calls.filter(call => call.status === 'success' && !(call.result as Record<string, unknown> | undefined)?.duplicateSuppressed);
  const writes = successful.filter(call => ['write_workspace_file', 'edit_workspace_file', 'write_file', 'create_file', 'replace_range'].includes(call.name));
  if (writes.some(call => (call.result as Record<string, unknown> | undefined)?.proposed === true)) return undefined;
  const appliedWrites = writes.filter(call => { const result = call.result as Record<string, unknown> | undefined; return result?.applied === true || result?.success === true && result?.proposed !== true; });
  const applied = appliedWrites.some(call => /\.(?:html?|css|scss|jsx?|tsx?|vue|svelte|astro|py|rs|go|cs|php|rb|java|kt|swift)$/i.test(String(call.args.path || (call.result as Record<string, unknown> | undefined)?.path || '')));
  const lastWrite = calls.reduce((latest, call, index) => appliedWrites.includes(call) ? index : latest, -1);
  const freshEvidence = successful.filter(call => calls.indexOf(call) > lastWrite);
  if (!website && !machineLearning && requestedTests) {
    const tested = freshEvidence.filter(call => {
      const result = call.result as Record<string, unknown> | undefined;
      return result?.exitCode === 0 && ['run_command', 'run_test'].includes(call.name) && /\b(?:node\s+--test|(?:npm|pnpm|yarn)\s+(?:run\s+)?test|(?:python(?:3)?|py(?:\s+-3)?)\s+-m\s+(?:unittest|pytest))\b/i.test(String(result.command || call.args.command || ''));
    });
    if (!tested.length) return 'No successful actual requested test execution exists after the latest applied edit. Run the requested test command, inspect its stdout/stderr, repair actual failures and rerun before claiming completion.';
    const minimum = /\bat least\s+(\d+)\s+(?:registered\s+)?(?:node:test\s+)?tests\b/i.exec(requestedTask);
    if (minimum && /\bnode(?::test|\s+--test)\b/i.test(requestedTask)) {
      const required = Number(minimum[1]);
      const count = (call: typeof tested[number]) => {
        const output = String((call.result as Record<string, unknown> | undefined)?.stdout ?? '').replace(/\x1b\[[0-9;]*m/g, '');
        const matches = [...output.matchAll(/(?:^|\n)\s*(?:#|ℹ)\s*tests\s+(\d+)\b/g)];
        return matches.length ? Number(matches.at(-1)![1]) : undefined;
      };
      if (!tested.some(call => (count(call) ?? -1) >= required)) return `The task explicitly requires at least ${required} registered Node tests, but no fresh successful runner output confirms that count. Import node:test and register the requested cases with test(); top-level assertions or a passing file alone do not satisfy this requirement. Save the corrected tests and rerun node --test --test-reporter=tap with the actual test file, then inspect the real count before concluding.`;
    }
    return undefined;
  }
  const missing: string[] = [];
  if (creation && !applied) missing.push(`No successful applied ${machineLearning ? 'project source' : 'website'} file edit exists. Use create_file or write_file with actual complete source text. A manifest/readme alone, or reading inspiration, is not implementing the project.`);
  if (machineLearning) {
    const executed = freshEvidence.filter(call => { const result = call.result as Record<string, unknown> | undefined; return result?.exitCode === 0 && ['run_command', 'run_test'].includes(call.name); });
    const command = (call: typeof executed[number]) => String((call.result as Record<string, unknown> | undefined)?.command || call.args.command || '');
    if (/\b(?:run|execute)\b[^.]*\btests\b/i.test(task) && !executed.some(call => /\b(?:unittest|pytest)\b/.test(command(call)))) missing.push('No successful actual machine-learning test command exists after the latest edit. Run the project tests and inspect their output.');
    if (/\b(?:run|execute)\b[^.]*\btraining\b/i.test(task) && !executed.some(call => /^\s*(?:python(?:3)?(?:\.exe)?|py(?:\.exe)?\s+-3)\s+.*\btrain(?:ing)?(?:\.py|\b)/i.test(command(call)))) missing.push('No successful actual training command exists after the latest edit. Run training and inspect the saved model and held-out metrics.');
  }
  if (/\bbuild\s+(?:the\s+)?project\b|\bbuild\s*,/i.test(requestedTask)) {
    const built = freshEvidence.some(call => { const result = call.result as Record<string, unknown> | undefined; return result?.exitCode === 0 && (call.name === 'run_build' || /\b(?:npm|pnpm|yarn)\s+(?:run\s+)?build\b/.test(String(result.command || call.args.command || ''))); });
    if (!built) missing.push('No successful real project build result exists. Create package.json and its build script if necessary, install dependencies, then execute the build.');
  }
  if (launch || website && /\bstart\s+(?:a|one|the)\s+(?:tracked\s+)?(?:\w+\s+){0,3}server\b/i.test(requestedTask)) {
    const started = successful.some(call => call.name === 'start_dev_server' && (call.result as Record<string, unknown> | undefined)?.status === 'running');
    if (!started) missing.push('No tracked development server was started. Use start_dev_server with the localhost-bound command and inspect its process_status output.');
  }
  if (website && /\bbrowser(?:_action)?\b.*\b(?:verif|inspect|check|click)|\b(?:verif|inspect|check|click)\w*\b.*\bbrowser(?:_action)?\b/i.test(task)) {
    const renders = freshEvidence.filter(call => { const result = call.result as Record<string, unknown> | undefined; return call.name === 'browser_action' && call.args.action !== 'close' && result?.rendered === true && result?.success === true; });
    const rendered = renders.length > 0;
    if (!rendered) missing.push('No real browser-rendered result exists. browser_action navigate only fetches HTML; use render, inspect, click, fill and viewport to verify the running site.');
    const latest = renders.at(-1)?.result as Record<string, unknown> | undefined;
    if (/\bbutton\b[\s\S]{0,200}\bchanges?\b[\s\S]{0,100}\b(?:text|status)\b/i.test(task)) {
      const changed = renders.some(call => call.args.action === 'click' && (call.result as Record<string, unknown>).visibleTextChanged === true);
      if (!changed) missing.push('No fresh button click verified a visible text change. Inspect and implement the requested handler, click the button, and verify the actual status/text changes before claiming completion. A successful click alone is not working interaction proof.');
    }
    if (Array.isArray(latest?.links) && latest.links.some(link => (link as { brokenFragment?: boolean })?.brokenFragment === true)) missing.push('The rendered page reports broken navigation targets. Repair the target IDs or links and render again.');
    if (Array.isArray(latest?.networkFailures) && latest.networkFailures.length) missing.push('The rendered page reports failed network requests. Inspect and repair them before claiming browser verification.');
    if (Array.isArray(latest?.navigationRoutes)) {
      const visited = new Map<string, Record<string, unknown>>();
      for (const call of renders) {
        const result = call.result as Record<string, unknown>;
        if (typeof result.url === 'string') visited.set(result.url.split('#')[0], result);
      }
      const unverified = latest.navigationRoutes.filter(route => {
        const result = typeof route === 'string' ? visited.get(route.split('#')[0]) : undefined;
        return !result || typeof result.httpStatus !== 'number' || result.httpStatus < 200 || result.httpStatus >= 300 || !Array.isArray(result.networkFailures) || result.networkFailures.length;
      });
      if (unverified.length) missing.push(`Internal navigation routes have not passed actual browser checks: ${unverified.slice(0, 4).join(', ')}. Click the links, inspect HTTP status and repair missing routes or use valid fragment targets.`);
    }
    if (/\bno console errors\b/i.test(task) && Array.isArray(latest?.consoleErrors) && latest.consoleErrors.length) missing.push('The latest rendered page reports console errors. Repair them and render the page again before claiming completion.');
    const viewports = new Map<number, Record<string, unknown>>();
    for (const call of renders) {
      const result = call.result as Record<string, unknown>;
      const width = (result.viewport as { width?: number } | undefined)?.width;
      if (typeof width === 'number') viewports.set(width, result);
    }
    if (/\b(?:responsive|mobile|tablet|desktop)\b/i.test(task) && rendered && (latest?.horizontalOverflow === true || [...viewports.values()].some(result => result.horizontalOverflow === true))) missing.push('The rendered page has horizontal overflow. Repair the responsive layout and verify again.');
    if (/\bmobile\b/i.test(task) && rendered && ![...viewports.keys()].some(width => width <= 480)) missing.push('No fresh mobile browser result exists. Verify the actual layout at a mobile viewport after the latest edit.');
    if (/\bdesktop\b/i.test(task) && rendered && ![...viewports.keys()].some(width => width >= 1024)) missing.push('No fresh desktop browser result exists. Verify the actual desktop layout after the latest edit.');
    const requestedWidths = /\b(?:inspect|verify|check|test)(?:\s+it)?(?:\s+at)?\s+widths?\s+(\d{3,4})(?:\s+(?:and|,)\s+(\d{3,4}))?/i.exec(task);
    for (const widthText of requestedWidths?.slice(1).filter(Boolean) ?? []) {
      const width = Number(widthText);
      if (width >= 320 && width <= 2560 && !viewports.has(width)) missing.push(`No fresh browser result exists at the explicitly requested width ${width}. Use action viewport, not inspect with ignored dimensions.`);
    }
    if (/\b(?:semantic|accessible|accessibility|(?:one|single)\s+main)\b/i.test(task) && typeof latest?.mainLandmarks === 'number' && latest.mainLandmarks !== 1) missing.push('The rendered page needs one main landmark. Repair the semantic page structure and inspect again.');
    if (/\bfavicon\b/i.test(task)) {
      if (typeof latest?.favicon !== 'string' || !latest.favicon.trim()) missing.push('The rendered page has no requested favicon. Add a real link rel="icon" and render again before claiming completion.');
      else if (latest.faviconSyntaxValid === false) missing.push('The rendered SVG data favicon is malformed. Fix its encoding/attribute quoting and render again.');
    }
  }
  return missing.length ? `The ${machineLearning ? 'machine-learning project' : 'website'} task is incomplete. ${missing.join(' ')}` : undefined;
}
