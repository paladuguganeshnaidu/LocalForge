import * as fs from 'node:fs/promises';
import * as path from 'node:path';

export interface WorkspacePathResult {
  input: string;
  relativePath: string;
  absolutePath: string;
  exists: boolean;
}

const WINDOWS_DEVICE = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;

export function normalizeWorkspaceRelativePath(input: string): string {
  if (typeof input !== 'string') throw new Error('Path must be a string.');
  let value = input.replace(/\\/g, '/').trim();
  while (value.startsWith('./')) value = value.slice(2);
  if (!value || value.includes('\0') || /[\u0000-\u001f]/.test(value)) {
    throw new Error('Invalid workspace path.');
  }
  if (value.startsWith('//') || value.startsWith('/') || /^[A-Za-z]:/.test(value)) {
    throw new Error('Workspace paths must be relative and cannot be UNC or absolute paths.');
  }
  const segments = value.split('/');
  if (segments.some((segment) => !segment || segment === '.' || segment === '..')) {
    throw new Error('Path traversal is not permitted.');
  }
  if (segments.some((segment) => WINDOWS_DEVICE.test(segment))) {
    throw new Error('Windows device paths are not permitted.');
  }
  if (segments.some((segment) => segment.endsWith(' ') || segment.endsWith('.'))) {
    throw new Error('Ambiguous Windows path segments are not permitted.');
  }
  return segments.join('/');
}

function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === '' || (relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative));
}

export async function assertWorkspacePath(
  workspaceRoot: string,
  input: string,
  options: { allowMissing?: boolean; allowVirtualRoot?: boolean } = {}
): Promise<WorkspacePathResult> {
  const relativePath = normalizeWorkspaceRelativePath(input);

  let root: string;
  try {
    root = await fs.realpath(workspaceRoot);
  } catch (error: any) {
    if (options.allowVirtualRoot && error?.code === 'ENOENT') {
      const lexicalRoot = path.resolve(workspaceRoot);
      const lexicalCandidate = path.resolve(lexicalRoot, ...relativePath.split('/'));
      if (!isInside(lexicalRoot, lexicalCandidate)) throw new Error('Resolved path escapes the workspace root.');
      return { input, relativePath, absolutePath: lexicalCandidate, exists: false };
    }
    throw error;
  }

  const absolutePath = path.resolve(root, ...relativePath.split('/'));
  if (!isInside(root, absolutePath)) throw new Error('Resolved path escapes the workspace root.');

  try {
    const realCandidate = await fs.realpath(absolutePath);
    if (!isInside(root, realCandidate)) throw new Error('Resolved path escapes the workspace root through a symlink or junction.');
    return { input, relativePath, absolutePath: realCandidate, exists: true };
  } catch (error: any) {
    if (!options.allowMissing || error?.code !== 'ENOENT') throw error;

    let ancestor = path.dirname(absolutePath);
    while (ancestor !== root) {
      try {
        const realAncestor = await fs.realpath(ancestor);
        if (!isInside(root, realAncestor)) throw new Error('Parent directory escapes the workspace root.');
        return { input, relativePath, absolutePath, exists: false };
      } catch (ancestorError: any) {
        if (ancestorError?.code !== 'ENOENT') throw ancestorError;
        const next = path.dirname(ancestor);
        if (next === ancestor) break;
        ancestor = next;
      }
    }

    return { input, relativePath, absolutePath, exists: false };
  }
}

export function assertWorkspacePathSync(workspaceRoot: string, input: string): string {
  const relativePath = normalizeWorkspaceRelativePath(input);
  const root = path.resolve(workspaceRoot);
  const absolute = path.resolve(root, ...relativePath.split('/'));
  if (!isInside(root, absolute)) throw new Error('Resolved path escapes the workspace root.');
  return absolute;
}
