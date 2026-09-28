export interface DiffStats {
  additions: number;
  deletions: number;
  totalLines: number;
}

export interface DiffResult {
  patch: string;
  stats: DiffStats;
}

/**
 * Generate a unified diff representation between original and modified text.
 */
export function createUnifiedDiff(
  filePath: string,
  originalText: string,
  modifiedText: string
): DiffResult {
  const oldLines = originalText.split(/\r?\n/);
  const newLines = modifiedText.split(/\r?\n/);

  // Simple and robust LCS-based diff for lines
  const lcs = computeLCS(oldLines, newLines);

  const diffLines: string[] = [
    `--- a/${filePath}`,
    `+++ b/${filePath}`,
    `@@ -1,${oldLines.length} +1,${newLines.length} @@`
  ];

  let additions = 0;
  let deletions = 0;

  let i = 0;
  let j = 0;

  for (const match of lcs) {
    while (i < match.oldIdx) {
      diffLines.push(`-${oldLines[i]}`);
      deletions += 1;
      i += 1;
    }
    while (j < match.newIdx) {
      diffLines.push(`+${newLines[j]}`);
      additions += 1;
      j += 1;
    }
    diffLines.push(` ${oldLines[i]}`);
    i += 1;
    j += 1;
  }

  while (i < oldLines.length) {
    diffLines.push(`-${oldLines[i]}`);
    deletions += 1;
    i += 1;
  }
  while (j < newLines.length) {
    diffLines.push(`+${newLines[j]}`);
    additions += 1;
    j += 1;
  }

  return {
    patch: diffLines.join('\n'),
    stats: {
      additions,
      deletions,
      totalLines: Math.max(oldLines.length, newLines.length)
    }
  };
}

interface Match {
  oldIdx: number;
  newIdx: number;
}

function computeLCS(oldLines: string[], newLines: string[]): Match[] {
  const m = oldLines.length;
  const n = newLines.length;

  // For very large files, limit matrix size to prevent OOM
  if (m * n > 500000) {
    return [];
  }

  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));

  for (let i = 0; i < m; i += 1) {
    for (let j = 0; j < n; j += 1) {
      if (oldLines[i] === newLines[j]) {
        dp[i + 1][j + 1] = dp[i][j] + 1;
      } else {
        dp[i + 1][j + 1] = Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
  }

  const matches: Match[] = [];
  let i = m;
  let j = n;

  while (i > 0 && j > 0) {
    if (oldLines[i - 1] === newLines[j - 1]) {
      matches.unshift({ oldIdx: i - 1, newIdx: j - 1 });
      i -= 1;
      j -= 1;
    } else if (dp[i - 1][j] >= dp[i][j - 1]) {
      i -= 1;
    } else {
      j -= 1;
    }
  }

  return matches;
}
