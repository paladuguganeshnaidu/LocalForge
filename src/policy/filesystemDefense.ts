import * as fs from 'fs';
import * as path from 'path';

const WINDOWS_RESERVED_NAMES = new Set([
  'con', 'prn', 'aux', 'nul',
  'com1', 'com2', 'com3', 'com4', 'com5', 'com6', 'com7', 'com8', 'com9',
  'lpt1', 'lpt2', 'lpt3', 'lpt4', 'lpt5', 'lpt6', 'lpt7', 'lpt8', 'lpt9'
]);

const realpathCache = new Map<string, string>();

export class FilesystemDefense {
  public static clearCache(): void {
    realpathCache.clear();
  }

  public static validatePathSafety(targetPath: string, workspaceRoot?: string): { safe: boolean; reason?: string } {
    if (!targetPath || typeof targetPath !== 'string') {
      return { safe: false, reason: 'Empty or invalid path.' };
    }

    // 1. Check null bytes
    if (targetPath.includes('\0') || targetPath.includes('%00')) {
      return { safe: false, reason: 'Null byte injection detected in path.' };
    }

    // 2. Check NTFS Alternate Data Streams
    // e.g. path.txt:secret
    const parts = targetPath.split(/[/\\]/);
    for (const part of parts) {
      if (process.platform === 'win32' && /^[a-zA-Z]:/.test(part)) {
        // Drive letter like C: is valid
        continue;
      }
      if (part.includes(':')) {
        return { safe: false, reason: `NTFS Alternate Data Stream detected in "${part}".` };
      }
    }

    // 3. Check Windows UNC and device namespace paths
    if (targetPath.startsWith('\\\\?\\') || targetPath.startsWith('\\\\.\\') || targetPath.startsWith('//?/')) {
      return { safe: false, reason: 'Windows device namespace paths (\\\\?\\ or \\\\.\\) are forbidden.' };
    }

    // UNC network share: \\server\share
    if (/^[/\\]{2}[^/\\]+[/\\]+/.test(targetPath)) {
      return { safe: false, reason: 'UNC network share paths are forbidden.' };
    }

    // 4. Check Windows reserved device names
    for (const part of parts) {
      const baseName = part.split('.')[0].toLowerCase();
      if (WINDOWS_RESERVED_NAMES.has(baseName)) {
        return { safe: false, reason: `Windows reserved device name "${part}" is forbidden.` };
      }
    }

    // 5. If workspace root is provided, check containment and symlink escape
    if (workspaceRoot) {
      // Cross-platform normalization: convert backslashes to forward slashes before resolving
      // so traversal patterns like "..\..\..\..\Windows\System32" resolve correctly on POSIX as well as Windows
      const normalizedPath = targetPath.replace(/\\/g, '/');
      const normRoot = path.resolve(workspaceRoot);
      const isTargetAbsolute = path.isAbsolute(normalizedPath) || /^[a-zA-Z]:[/\\]/.test(targetPath);
      const normTarget = isTargetAbsolute ? path.resolve(targetPath) : path.resolve(normRoot, normalizedPath);

      const isInside = (parent: string, child: string) => {
        const p = process.platform === 'win32' ? parent.toLowerCase() : parent;
        const c = process.platform === 'win32' ? child.toLowerCase() : child;
        return c === p || c.startsWith(p + path.sep);
      };

      if (!isInside(normRoot, normTarget)) {
        return { safe: false, reason: `Path "${targetPath}" resolves outside the workspace boundary.` };
      }

      // Check realpath if workspace root exists on disk
      try {
        let realRoot = realpathCache.get(normRoot);
        if (!realRoot) {
          if (fs.existsSync(normRoot)) {
            realRoot = fs.realpathSync(normRoot);
            if (realpathCache.size > 500) realpathCache.clear();
            realpathCache.set(normRoot, realRoot);
          }
        }

        if (realRoot) {
          let existingAncestor = normTarget;
          while (
            existingAncestor.length >= normRoot.length &&
            !fs.existsSync(existingAncestor) &&
            path.dirname(existingAncestor) !== existingAncestor
          ) {
            existingAncestor = path.dirname(existingAncestor);
          }

          if (fs.existsSync(existingAncestor)) {
            let realExisting = realpathCache.get(existingAncestor);
            if (!realExisting) {
              realExisting = fs.realpathSync(existingAncestor);
              if (realpathCache.size > 500) realpathCache.clear();
              realpathCache.set(existingAncestor, realExisting);
            }
            if (!isInside(realRoot, realExisting)) {
              return { safe: false, reason: `Path "${targetPath}" escapes workspace via symlink or junction.` };
            }
          }
        }
      } catch {
        // If filesystem error during realpath resolution, fail closed
        return { safe: false, reason: `Filesystem resolution error checking path "${targetPath}".` };
      }
    }

    return { safe: true };
  }
}
