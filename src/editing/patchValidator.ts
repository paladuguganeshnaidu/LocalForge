import * as crypto from 'crypto';

export class PatchValidator {
  public static computeContentHash(content: string): string {
    return crypto.createHash('sha256').update(content, 'utf-8').digest('hex');
  }

  public static validatePrecondition(
    actualContent: string,
    expectedPreHash?: string
  ): { valid: boolean; actualHash: string; reason?: string } {
    const actualHash = this.computeContentHash(actualContent);

    if (expectedPreHash && expectedPreHash !== actualHash) {
      return {
        valid: false,
        actualHash,
        reason: `Precondition hash mismatch: file content has changed since inspection (expected ${expectedPreHash.slice(0, 12)}, actual ${actualHash.slice(0, 12)}).`
      };
    }

    return {
      valid: true,
      actualHash
    };
  }

  public static validateSingleTargetMatch(
    content: string,
    targetString: string
  ): { valid: boolean; matchCount: number; reason?: string } {
    if (!targetString) {
      return { valid: false, matchCount: 0, reason: 'Target string to replace cannot be empty.' };
    }

    let count = 0;
    let pos = 0;

    while ((pos = content.indexOf(targetString, pos)) !== -1) {
      count++;
      pos += targetString.length;
    }

    if (count === 0) {
      return {
        valid: false,
        matchCount: 0,
        reason: 'Target string not found in file content.'
      };
    }

    if (count > 1) {
      return {
        valid: false,
        matchCount: count,
        reason: `Target string matches ${count} locations in the file. Unique target context is required to avoid ambiguous edits.`
      };
    }

    return {
      valid: true,
      matchCount: 1
    };
  }
}
