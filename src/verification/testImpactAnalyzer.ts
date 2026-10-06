import * as path from 'path';

export class TestImpactAnalyzer {
  public static selectImpactedTests(
    changedFiles: string[],
    availableTestFiles: string[]
  ): { selectedTests: string[]; isComprehensiveFallback: boolean } {
    if (changedFiles.length === 0) {
      return { selectedTests: [], isComprehensiveFallback: false };
    }

    const selected = new Set<string>();
    const testMap = new Map<string, string>(); // baseName -> testFile

    for (const testFile of availableTestFiles) {
      const base = path.basename(testFile).replace(/\.(test|spec)\.(js|ts)$/, '').toLowerCase();
      testMap.set(base, testFile);
    }

    for (const changed of changedFiles) {
      // 1. If changed file is itself a test, include it directly
      if (changed.includes('.test.') || changed.includes('.spec.')) {
        selected.add(changed);
        continue;
      }

      // 2. Match by basename (e.g. accessPolicy.ts -> accessPolicy.test.js)
      const baseName = path.basename(changed).replace(/\.(ts|js|tsx|jsx)$/, '').toLowerCase();
      const matchedTest = testMap.get(baseName);
      if (matchedTest) {
        selected.add(matchedTest);
      }

      // 3. Partial matching (e.g. runStateMachine.ts matching runStateMachine.test.js)
      for (const [tBase, tFile] of testMap.entries()) {
        if (tBase.includes(baseName) || baseName.includes(tBase)) {
          selected.add(tFile);
        }
      }
    }

    // If critical core files changed or no tests matched, fallback to comprehensive suite
    const coreFiles = ['package.json', 'tsconfig.json', 'src/extension.ts'];
    const affectsCore = changedFiles.some((f) => coreFiles.some((c) => f.endsWith(c)));

    if (affectsCore || selected.size === 0) {
      return {
        selectedTests: availableTestFiles,
        isComprehensiveFallback: true
      };
    }

    return {
      selectedTests: Array.from(selected),
      isComprehensiveFallback: false
    };
  }
}
