const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

// Mock 'vscode' runtime module for pure unit testing outside of the VS Code host
const Module = require('node:module');
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'vscode') {
    return {
      workspace: { isTrusted: true, fs: { readFile: async () => Buffer.from(''), writeFile: async () => {} } },
      Uri: {
        file: (p) => ({ fsPath: p, scheme: 'file' }),
        joinPath: (base, ...segments) => ({ fsPath: [base.fsPath, ...segments].join('/'), scheme: 'file' }),
        parse: (str) => ({ fsPath: str, scheme: 'file', query: '' })
      }
    };
  }
  return originalLoad.apply(this, arguments);
};

const { AgentLoop } = require('../dist/agent/agentLoop');
const { ToolRegistry } = require('../dist/agent/toolRegistry');
const { PermissionManager } = require('../dist/agent/permissionManager');
const { EditEngine } = require('../dist/editing/editEngine');
const { TerminalManager } = require('../dist/terminal/terminalManager');

test('End-to-End Smoke: Create Node.js hello program and run it in terminal', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'localforge-smoke-'));

  try {
    const editEngine = new EditEngine();
    const terminalManager = new TerminalManager();
    const permissionManager = new PermissionManager('allow_safe_auto');
    const toolRegistry = new ToolRegistry();

    // Register write tool backed by proposal and auto-applied in test harness
    toolRegistry.registerTool(
      {
        type: 'function',
        function: {
          name: 'write_workspace_file',
          description: 'Write file',
          parameters: {
            type: 'object',
            properties: { path: { type: 'string' }, content: { type: 'string' } },
            required: ['path', 'content']
          }
        }
      },
      async (args) => {
        const filePath = path.join(tmpDir, args.path);
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, args.content, 'utf8');
        return { success: true, path: args.path, bytesWritten: args.content.length };
      }
    );

    // Register terminal tool
    toolRegistry.registerTool(
      {
        type: 'function',
        function: {
          name: 'run_command',
          description: 'Run shell command',
          parameters: {
            type: 'object',
            properties: { command: { type: 'string' } },
            required: ['command']
          }
        }
      },
      async (args) => {
        const proc = await terminalManager.runCommand(args.command, tmpDir);
        return {
          command: proc.command,
          exitCode: proc.exitCode,
          stdout: proc.stdout,
          stderr: proc.stderr,
          duration: proc.duration
        };
      }
    );

    let round = 0;
    const provider = {
      id: 'mock-qwen-coder',
      async chatWithTools(model, messages, tools) {
        round += 1;
        if (round === 1) {
          // Model emits text-fenced tool call (reproducing local model pattern)
          return {
            role: 'assistant',
            content: `\`\`\`json
{
  "name": "write_workspace_file",
  "arguments": {
    "path": "src/hello.js",
    "content": "console.log('LocalForge working');"
  }
}
\`\`\``
          };
        }

        if (round === 2) {
          // Model emits package.json
          return {
            role: 'assistant',
            content: `LOCALFORGE_TOOL_CALL: {
              "tool": "write_workspace_file",
              "arguments": {
                "path": "package.json",
                "content": "{\\"name\\": \\"localforge-smoke\\", \\"version\\": \\"1.0.0\\", \\"scripts\\": {\\"start\\": \\"node src/hello.js\\"}}"
              }
            }`
          };
        }

        if (round === 3) {
          // Model runs command
          return {
            role: 'assistant',
            content: `\`\`\`json
{
  "name": "run_command",
  "arguments": {
    "command": "node src/hello.js"
  }
}
\`\`\``
          };
        }

        // Final assistant walkthrough response
        return {
          role: 'assistant',
          content: 'Created `src/hello.js` and `package.json`. Successfully executed `node src/hello.js`. The output is LocalForge working with exit code 0.'
        };
      }
    };

    const loop = new AgentLoop(provider, toolRegistry, permissionManager);
    const result = await loop.run('qwen2.5-coder:1.5b', [
      { role: 'user', content: 'Create a simple Node.js program in this workspace that prints LocalForge working, then run it in the terminal.' }
    ]);

    // 1. Verify files exist on disk with correct content
    const helloFile = path.join(tmpDir, 'src', 'hello.js');
    assert.ok(fs.existsSync(helloFile), 'src/hello.js must exist on disk');
    const helloContent = fs.readFileSync(helloFile, 'utf8');
    assert.equal(helloContent, "console.log('LocalForge working');");

    const pkgFile = path.join(tmpDir, 'package.json');
    assert.ok(fs.existsSync(pkgFile), 'package.json must exist on disk');

    // 2. Verify state and status
    assert.equal(result.state.status, 'completed');
    assert.equal(result.state.errors.length, 0);

    // 3. Verify no raw tool JSON was leaked into visible text
    assert.ok(!result.response.includes('LOCALFORGE_TOOL_CALL'), 'Must not contain raw tool protocol text');
    assert.ok(!result.response.includes('"write_workspace_file"'), 'Must not contain raw tool JSON');
    assert.ok(result.response.includes('src/hello.js'), 'Response must reference created file');
    assert.ok(result.response.includes('node src/hello.js'), 'Response must reference executed command');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
