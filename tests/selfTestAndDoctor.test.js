const assert = require('node:assert/strict');
const { test } = require('node:test');

// Mock 'vscode'
const Module = require('node:module');
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'vscode') {
    return {
      version: '1.106.0',
      workspace: {
        isTrusted: true,
        workspaceFolders: [{ uri: { fsPath: process.cwd() } }],
        getConfiguration: () => ({ get: () => undefined }),
        fs: { readDirectory: async () => [['package.json', 1]] }
      },
      languages: { getDiagnostics: () => [] }
    };
  }
  return originalLoad.apply(this, arguments);
};

const { DiagnosticsService } = require('../dist/core/diagnosticsService.js');
const { LocalForgeSelfTest } = require('../dist/core/selfTest.js');
const { ToolRegistry } = require('../dist/agent/toolRegistry.js');
const { registerAllCoreTools } = require('../dist/agent/coreTools.js');

test('DiagnosticsService (Doctor) evaluates platform, workspace, git, and tool health', async () => {
  const mockRegistry = {
    refresh: async () => {},
    getProviders: () => [{ id: 'ollama', endpoint: 'http://127.0.0.1:11434', healthy: true }],
    getAllModels: () => [{ name: 'qwen2.5-coder:7b', capabilities: { toolCalling: true } }]
  };

  const mockRemote = {
    getActiveSession: () => undefined,
    getProfiles: () => []
  };

  const mockIndexer = {
    getStats: () => ({ fileCount: 15, totalChars: 45000 })
  };

  const toolRegistry = new ToolRegistry();
  registerAllCoreTools(toolRegistry, {});

  const doctor = new DiagnosticsService(mockRegistry, mockRemote, mockIndexer, toolRegistry);
  const report = await doctor.runDiagnostics();

  assert.ok(report.items.length >= 6);
  assert.equal(report.overallStatus, 'green');

  const md = doctor.formatReportMarkdown(report);
  assert.ok(md.includes('# LocalForge Doctor Report'));
  assert.ok(md.includes('Host Environment'));
  assert.ok(md.includes('Workspace State'));
  assert.ok(md.includes('Git Integration'));
  assert.ok(md.includes('Tool Registry'));
});

test('LocalForgeSelfTest runs 13 automated checks and produces machine-readable report', async () => {
  const toolRegistry = new ToolRegistry();
  registerAllCoreTools(toolRegistry, {});

  const mockEngine = {
    modelRegistry: {
      refresh: async () => {},
      getModels: () => [{ name: 'test-model' }],
      getProviders: () => [{ id: 'local' }]
    },
    toolRegistry,
    terminalManager: {
      runCommand: async (cmd, cwd) => ({ exitCode: 0, stdout: 'v22.0.0', stderr: '', duration: 15 })
    },
    orchestrator: {
      decomposeGoal: () => ({ getAllNodes: () => [{ id: 'n1' }] })
    },
    events: {
      on: () => {},
      off: () => {},
      emit: () => {}
    },
    sessionManager: {
      getActiveSession: () => ({ id: 'session-test-1' })
    }
  };

  const selfTest = new LocalForgeSelfTest(mockEngine);
  const report = await selfTest.runSelfTest();

  assert.equal(report.results.length, 13);
  assert.ok(report.totalDurationMs >= 0);

  const md = selfTest.formatReportMarkdown(report);
  assert.ok(md.includes('# LocalForge Automated Self-Test Report'));
  assert.ok(md.includes('`activation`'));
  assert.ok(md.includes('`tool_registry`'));
  assert.ok(md.includes('`terminal_execution`'));
});
