import { lstat, readlink, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';

export function validateWorkspaceRelativePath(inputPath: string): string[] {
  const normalized = inputPath.replace(/\\/g, '/').trim();
  if (!normalized || normalized.startsWith('/') || /^[A-Za-z]:/.test(normalized)) {
    throw new Error('Provide a normalized relative path inside the workspace.');
  }
  const segments = normalized.split('/');
  const reservedDevices = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;
  for (const segment of segments) {
    if (!segment || segment === '.' || segment === '..' || /[\x00-\x1f<>:"|?*]/.test(segment) || /[. ]$/.test(segment)) {
      throw new Error('Provide a normalized relative path inside the workspace.');
    }
    if (reservedDevices.test(segment)) {
      throw new Error(`Provide a normalized relative path inside the workspace (Windows reserved device name "${segment}" is not allowed).`);
    }
  }
  return segments;
}

function assertWithinRoot(rootPath: string, targetPath: string): void {
  const relativePath = relative(rootPath, targetPath);
  if (relativePath === '..' || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath)) {
    throw new Error('The requested file resolves outside the workspace folder.');
  }
}

export async function assertWorkspaceFilePath(rootPath: string, targetPath: string, allowMissing = false): Promise<void> {
  assertWithinRoot(resolve(rootPath), resolve(targetPath));
  const realRoot = await realpath(rootPath);
  let candidate = resolve(targetPath);
  for (let attempt = 0; attempt < 128; attempt += 1) {
    try {
      assertWithinRoot(realRoot, await realpath(candidate));
      return;
    } catch (error) {
      if (!allowMissing || (error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    try {
      const entry = await lstat(candidate);
      if (!entry.isSymbolicLink()) throw new Error('The requested workspace path cannot be resolved safely.');
      candidate = resolve(dirname(candidate), await readlink(candidate));
      assertWithinRoot(realRoot, candidate);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      const parent = dirname(candidate);
      if (parent === candidate) throw new Error('The requested workspace path cannot be resolved safely.');
      candidate = parent;
    }
  }
  throw new Error('The requested workspace path contains too many unresolved links or directories.');
}
