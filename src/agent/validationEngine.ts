import * as vscode from 'vscode';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

export type ProjectType = 'node' | 'python' | 'rust' | 'go' | 'java' | 'cpp' | 'unknown';

export interface ProjectInfo {
  type: ProjectType;
  testCommand: string;
  buildCommand?: string;
  lintCommand?: string;
}

export interface ValidationResult {
  command: string;
  passed: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
}

export interface ValidationAttempt {
  attemptNumber: number;
  action: string;
  result: ValidationResult;
}

export class ValidationEngine {
  /**
   * Detect the workspace project type and standard commands by inspecting files in the root.
   */
  public async detectProject(workspaceRoot: vscode.Uri): Promise<ProjectInfo> {
    const files = await this.listRootFiles(workspaceRoot);

    if (files.has('package.json')) {
      let testCmd = 'npm test';
      let buildCmd: string | undefined;
      let lintCmd: string | undefined;
      try {
        const pkgUri = vscode.Uri.joinPath(workspaceRoot, 'package.json');
        const bytes = await vscode.workspace.fs.readFile(pkgUri);
        const pkg = JSON.parse(new TextDecoder().decode(bytes)) as { scripts?: Record<string, string> };
        if (pkg.scripts) {
          if (pkg.scripts.test) testCmd = 'npm test';
          if (pkg.scripts.build) buildCmd = 'npm run build';
          if (pkg.scripts.lint) lintCmd = 'npm run lint';
        }
      } catch {}
      return { type: 'node', testCommand: testCmd, buildCommand: buildCmd, lintCommand: lintCmd };
    }

    if (files.has('Cargo.toml')) {
      return { type: 'rust', testCommand: 'cargo test', buildCommand: 'cargo build', lintCommand: 'cargo clippy' };
    }

    if (files.has('pyproject.toml') || files.has('pytest.ini') || files.has('requirements.txt') || files.has('setup.py')) {
      return { type: 'python', testCommand: 'pytest', lintCommand: 'flake8' };
    }

    if (files.has('go.mod')) {
      return { type: 'go', testCommand: 'go test ./...', buildCommand: 'go build ./...' };
    }

    if (files.has('pom.xml')) {
      return { type: 'java', testCommand: 'mvn test', buildCommand: 'mvn package' };
    }

    if (files.has('build.gradle') || files.has('build.gradle.kts')) {
      return { type: 'java', testCommand: './gradlew test', buildCommand: './gradlew build' };
    }

    if (files.has('CMakeLists.txt')) {
      return { type: 'cpp', testCommand: 'ctest', buildCommand: 'cmake --build .' };
    }

    if (files.has('Makefile')) {
      return { type: 'cpp', testCommand: 'make test', buildCommand: 'make' };
    }

    return { type: 'unknown', testCommand: 'npm test' };
  }

  /**
   * Run a validation command inside the workspace directory safely.
   */
  public async runValidation(
    workspaceRoot: vscode.Uri,
    command: string,
    timeoutMs = 60000
  ): Promise<ValidationResult> {
    const startTime = Date.now();
    try {
      const { stdout, stderr } = await execAsync(command, {
        cwd: workspaceRoot.fsPath,
        timeout: timeoutMs,
        maxBuffer: 1024 * 1024
      });
      return {
        command,
        passed: true,
        exitCode: 0,
        stdout: (stdout || '').trim().slice(0, 10000),
        stderr: (stderr || '').trim().slice(0, 5000),
        durationMs: Date.now() - startTime
      };
    } catch (error: any) {
      return {
        command,
        passed: false,
        exitCode: typeof error.code === 'number' ? error.code : 1,
        stdout: (error.stdout || '').toString().trim().slice(0, 10000),
        stderr: (error.stderr || error.message || '').toString().trim().slice(0, 5000),
        durationMs: Date.now() - startTime
      };
    }
  }

  private async listRootFiles(root: vscode.Uri): Promise<Set<string>> {
    try {
      const entries = await vscode.workspace.fs.readDirectory(root);
      return new Set(entries.map(([name]) => name));
    } catch {
      return new Set();
    }
  }
}
