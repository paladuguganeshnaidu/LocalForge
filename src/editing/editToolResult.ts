import { EditApplyResult } from './editEngine';

export function editToolResult(result: EditApplyResult, details: Record<string, unknown>): Record<string, unknown> {
  return {
    ...details,
    success: result.success,
    applied: result.success && result.appliedCount > 0,
    proposalId: result.proposalId,
    recoveryId: result.recoveryId,
    editorChanged: result.editorChanged === true,
    savedFiles: result.savedFiles ?? result.appliedFiles,
    requiresUserAction: !result.success && result.editorChanged === true,
    errors: result.errors,
    error: result.success ? undefined : result.errors.map((item) => item.error).join('; ') || 'The edit could not be verified.'
  };
}
