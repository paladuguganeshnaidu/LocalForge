export function packageInstallCommand(args: Record<string, unknown>): string {
  if (!Array.isArray(args.packages) || !args.packages.length || args.packages.length > 20) throw new Error('packages must contain between 1 and 20 registry package names, optionally with exact versions or tags.');
  if (args.dev !== undefined && typeof args.dev !== 'boolean') throw new Error('dev must be boolean.');
  const packageName = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*(?:@(?:[a-zA-Z0-9][a-zA-Z0-9.+_-]*|[~^]\d[a-zA-Z0-9.+_-]*))?$/;
  for (const name of args.packages) {
    if (typeof name !== 'string' || name.length > 256 || !packageName.test(name)) throw new Error('Use registry package names with optional versions/tags, not flags, paths, URLs, shell syntax or version ranges containing spaces.');
  }
  return `npm install ${args.dev ? '--save-dev' : '--save-prod'} -- ${[...new Set(args.packages)].map(name => `"${name}"`).join(' ')}`;
}
