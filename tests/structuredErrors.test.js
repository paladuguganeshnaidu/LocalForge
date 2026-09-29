const assert = require('node:assert/strict');
const { test } = require('node:test');

const {
  LocalForgeError,
  ModelError,
  ProviderError,
  ToolError,
  TerminalError,
  FileError,
  PermissionError,
  ParseError,
  TimeoutError,
  CancellationError,
  AgentError,
  WorkspaceError,
  GitError
} = require('../dist/agent/orchestration/errors.js');

test('Structured error hierarchy initializes with codes, recoverability, and JSON serialization', () => {
  const errClasses = [
    { cls: ModelError, defaultCode: 'MODEL_ERROR' },
    { cls: ProviderError, defaultCode: 'PROVIDER_ERROR' },
    { cls: ToolError, defaultCode: 'TOOL_ERROR' },
    { cls: TerminalError, defaultCode: 'TERMINAL_ERROR' },
    { cls: FileError, defaultCode: 'FILE_ERROR' },
    { cls: PermissionError, defaultCode: 'PERMISSION_ERROR' },
    { cls: ParseError, defaultCode: 'PARSE_ERROR' },
    { cls: TimeoutError, defaultCode: 'TIMEOUT_ERROR' },
    { cls: CancellationError, defaultCode: 'CANCELLATION_ERROR' },
    { cls: AgentError, defaultCode: 'AGENT_ERROR' },
    { cls: WorkspaceError, defaultCode: 'WORKSPACE_ERROR' },
    { cls: GitError, defaultCode: 'GIT_ERROR' }
  ];

  for (const { cls, defaultCode } of errClasses) {
    const err = new cls({
      message: `Test error message for ${defaultCode}`,
      details: { foo: 'bar' },
      userMessage: 'User friendly explanation'
    });

    assert.ok(err instanceof Error);
    assert.ok(err instanceof LocalForgeError);
    assert.equal(err.code, defaultCode);
    assert.equal(err.userMessage, 'User friendly explanation');
    assert.deepEqual(err.details, { foo: 'bar' });

    const json = err.toJSON();
    assert.equal(json.code, defaultCode);
    assert.equal(json.userMessage, 'User friendly explanation');
  }

  // Timeout is retryable
  const timeoutErr = new TimeoutError({ message: 'Request timed out' });
  assert.equal(timeoutErr.retryable, true);

  // Cancellation is non-retryable and non-recoverable
  const cancelErr = new CancellationError({ message: 'Task cancelled by user' });
  assert.equal(cancelErr.recoverable, false);
  assert.equal(cancelErr.retryable, false);
});
