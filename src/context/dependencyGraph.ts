import * as path from 'path';

export class DependencyGraph {
  // file -> dependencies (files imported by this file)
  private readonly fileDependencies = new Map<string, Set<string>>();
  // file -> dependents (files that import this file)
  private readonly fileDependents = new Map<string, Set<string>>();

  public indexFile(filePath: string, content: string): void {
    const normFile = this.normalize(filePath);
    this.removeFile(normFile);

    const deps = new Set<string>();
    const dir = path.dirname(normFile);

    // Regex for ES6 imports: import ... from './rel/path'
    const importRegex = /(?:import|export)\s+(?:[\s\S]*?from\s+)?['"](\.[^'"]+)['"]/g;
    let match: RegExpExecArray | null;

    while ((match = importRegex.exec(content)) !== null) {
      const relTarget = match[1];
      const resolved = this.resolvePath(dir, relTarget);
      deps.add(resolved);
    }

    // Regex for CommonJS require: require('./rel/path')
    const requireRegex = /require\s*\(\s*['"](\.[^'"]+)['"]\s*\)/g;
    while ((match = requireRegex.exec(content)) !== null) {
      const relTarget = match[1];
      const resolved = this.resolvePath(dir, relTarget);
      deps.add(resolved);
    }

    this.fileDependencies.set(normFile, deps);

    for (const dep of deps) {
      const dependents = this.fileDependents.get(dep) ?? new Set<string>();
      dependents.add(normFile);
      this.fileDependents.set(dep, dependents);
    }
  }

  public removeFile(filePath: string): void {
    const normFile = this.normalize(filePath);
    const oldDeps = this.fileDependencies.get(normFile);

    if (oldDeps) {
      for (const dep of oldDeps) {
        const dependents = this.fileDependents.get(dep);
        if (dependents) {
          dependents.delete(normFile);
          if (dependents.size === 0) {
            this.fileDependents.delete(dep);
          }
        }
      }
      this.fileDependencies.delete(normFile);
    }
  }

  public getDependencies(filePath: string): string[] {
    const normFile = this.normalize(filePath);
    return Array.from(this.fileDependencies.get(normFile) ?? []);
  }

  public getDependents(filePath: string): string[] {
    const normFile = this.normalize(filePath);
    return Array.from(this.fileDependents.get(normFile) ?? []);
  }

  public getBlastRadius(filePath: string, depth = 2): string[] {
    const affected = new Set<string>();
    const queue: Array<{ file: string; d: number }> = [{ file: this.normalize(filePath), d: 0 }];

    while (queue.length > 0) {
      const { file, d } = queue.shift()!;
      if (d >= depth) continue;

      const dependents = this.getDependents(file);
      for (const dep of dependents) {
        if (!affected.has(dep)) {
          affected.add(dep);
          queue.push({ file: dep, d: d + 1 });
        }
      }
    }

    return Array.from(affected);
  }

  private resolvePath(dir: string, relTarget: string): string {
    const combined = path.join(dir, relTarget);
    return this.normalize(combined);
  }

  private normalize(p: string): string {
    return p.replace(/\\/g, '/').replace(/\.(ts|js|tsx|jsx)$/, '');
  }
}
