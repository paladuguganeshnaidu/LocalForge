import * as fs from 'fs';
import * as path from 'path';
import { PatchValidator } from './patchValidator';
import { LineEndingPreserver } from './lineEndingPreserver';

export interface FileEditOperation {
  filePath: string;
  newContent: string;
  expectedPreHash?: string;
}

export interface PreparedEdit {
  filePath: string;
  originalContent: string | null; // null if creating a new file
  finalContent: string;
}

export interface TransactionResult {
  transactionId: string;
  filesModified: string[];
  rollback: () => Promise<void>;
}

export class TransactionalEditEngine {
  public static async applyTransaction(operations: FileEditOperation[]): Promise<TransactionResult> {
    const transactionId = `tx_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const preparedEdits: PreparedEdit[] = [];

    // Phase 1: Prepare & Validate all preconditions
    for (const op of operations) {
      const fullPath = path.resolve(op.filePath);
      let originalContent: string | null = null;

      if (fs.existsSync(fullPath)) {
        originalContent = await fs.promises.readFile(fullPath, 'utf-8');

        // Check precondition hash
        if (op.expectedPreHash) {
          const preCheck = PatchValidator.validatePrecondition(originalContent, op.expectedPreHash);
          if (!preCheck.valid) {
            throw new Error(`Transaction aborted for "${op.filePath}": ${preCheck.reason}`);
          }
        }

        // Preserve line endings
        const formatted = LineEndingPreserver.preserveOriginalFormat(originalContent, op.newContent);
        preparedEdits.push({
          filePath: fullPath,
          originalContent,
          finalContent: formatted
        });
      } else {
        // Creating new file
        preparedEdits.push({
          filePath: fullPath,
          originalContent: null,
          finalContent: op.newContent
        });
      }
    }

    // Phase 2: Commit writes with automatic rollback on error
    const writtenFiles: PreparedEdit[] = [];

    try {
      for (const edit of preparedEdits) {
        // Ensure parent directory exists
        const parentDir = path.dirname(edit.filePath);
        if (!fs.existsSync(parentDir)) {
          await fs.promises.mkdir(parentDir, { recursive: true });
        }

        await fs.promises.writeFile(edit.filePath, edit.finalContent, 'utf-8');
        writtenFiles.push(edit);
      }
    } catch (writeErr) {
      // Rollback all already-written files in reverse order
      writtenFiles.reverse();
      for (const written of writtenFiles) {
        try {
          if (written.originalContent === null) {
            // It was a new file, remove it
            await fs.promises.unlink(written.filePath);
          } else {
            // Restore original content
            await fs.promises.writeFile(written.filePath, written.originalContent, 'utf-8');
          }
        } catch {
          // Continue best-effort rollback
        }
      }

      throw new Error(`Transaction failed and was rolled back: ${(writeErr as Error).message}`);
    }

    const rollback = async () => {
      const toRestore = [...preparedEdits].reverse();
      for (const edit of toRestore) {
        if (edit.originalContent === null) {
          if (fs.existsSync(edit.filePath)) {
            await fs.promises.unlink(edit.filePath);
          }
        } else {
          await fs.promises.writeFile(edit.filePath, edit.originalContent, 'utf-8');
        }
      }
    };

    return {
      transactionId,
      filesModified: preparedEdits.map((e) => e.filePath),
      rollback
    };
  }
}
