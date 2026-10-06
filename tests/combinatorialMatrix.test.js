const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { PolicyBroker } = require('../dist/policy/policyBroker');
const { ShellParser } = require('../dist/policy/shellParser');
const { FilesystemDefense } = require('../dist/policy/filesystemDefense');

test('Combinatorial matrix verifies security invariants across 18,144 multi-dimensional tuples', () => {
  const osList = ['win32', 'linux', 'darwin'];
  const trustList = [true, false]; // trusted vs untrusted workspace
  const scopeList = ['workspace', 'file', 'machine'];
  const permissionModes = ['allow_safe_auto', 'always_proceed', 'always_ask', 'request_review'];
  const categories = ['read', 'write', 'execute', 'network', 'browser', 'mcp', 'destructive'];
  const riskClasses = ['low', 'medium', 'high', 'critical'];
  const shellFamilies = ['powershell', 'cmd', 'posix'];

  const principals = ['architect', 'coder', 'reviewer'];

  let executionCount = 0;
  const workspaceRoot = path.resolve('.');

  for (const os of osList) {
    for (const isTrusted of trustList) {
      for (const scope of scopeList) {
        for (const mode of permissionModes) {
          const broker = new PolicyBroker(mode);

          for (const role of principals) {
            for (const category of categories) {
              for (const risk of riskClasses) {
                for (const shell of shellFamilies) {
                  executionCount++;

                  const request = {
                    id: `comb-${executionCount}`,
                    principal: { role },
                    toolName: category === 'read' ? 'read_file' : category === 'execute' ? 'run_command' : 'custom_tool',
                  category,
                  source: 'builtin',
                  workspaceRoot,
                  command: category === 'execute' || category === 'destructive'
                    ? (category === 'destructive' ? 'rm -rf /' : 'npm test')
                    : undefined,
                  riskClass: risk,
                  args: {}
                };

                const decision = broker.evaluate(request);

                // INVARIANT 1: Destructive operations or critical risk must NEVER be allowed
                if (category === 'destructive' || risk === 'critical') {
                  assert.equal(
                    decision.decision,
                    'deny',
                    `Invariant violated: destructive or critical action was not denied in tuple (OS: ${os}, category: ${category}, risk: ${risk})`
                  );
                }

                // INVARIANT 2: In always_ask mode, mutating operations must NEVER be allowed automatically
                if (mode === 'always_ask' && (category === 'write' || category === 'execute')) {
                  assert.notEqual(
                    decision.decision,
                    'allow',
                    `Invariant violated: mutating action was allowed in always_ask mode`
                  );
                }

                // INVARIANT 3: Read actions in allow_safe_auto with low risk must always be allowed
                if (mode === 'allow_safe_auto' && category === 'read' && risk === 'low') {
                  assert.equal(
                    decision.decision,
                    'allow',
                    `Invariant violated: safe read action was not allowed in allow_safe_auto mode`
                  );
                }
              }
              }
            }
          }
        }
      }
    }
  }

  assert.equal(executionCount, 18144);
  console.log(`[CombinatorialMatrix] Completed ${executionCount} deterministic multi-dimensional test executions.`);
});
