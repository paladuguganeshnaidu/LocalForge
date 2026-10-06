export type PrivacyMode = 'air_gapped_local' | 'local_only' | 'hybrid' | 'cloud_preferred';
export type TaskKind = 'planning' | 'coding' | 'review' | 'quick';

export interface ModelMetadata {
  id: string;
  name: string;
  isLocal: boolean;
  contextWindow: number;
  supportsTools: boolean;
  supportsStreaming: boolean;
}

export class AdaptiveRouter {
  constructor(private privacyMode: PrivacyMode = 'local_only') {}

  public getPrivacyMode(): PrivacyMode {
    return this.privacyMode;
  }

  public setPrivacyMode(mode: PrivacyMode): void {
    this.privacyMode = mode;
  }

  public selectModel(taskKind: TaskKind, availableModels: ModelMetadata[]): ModelMetadata {
    if (availableModels.length === 0) {
      throw new Error('No available models to route to.');
    }

    // 1. Filter by privacy mode
    let candidates = availableModels;
    if (this.privacyMode === 'air_gapped_local' || this.privacyMode === 'local_only') {
      candidates = candidates.filter((m) => m.isLocal);
      if (candidates.length === 0) {
        throw new Error(
          `Privacy mode is "${this.privacyMode}", but no local models were found. Cloud endpoints are strictly blocked.`
        );
      }
    }

    // 2. Score candidates based on taskKind
    const scored = candidates.map((m) => {
      let score = 0;

      // Base local preference in hybrid mode
      if (this.privacyMode === 'hybrid' && m.isLocal) {
        score += 20;
      }

      // Base cloud preference in cloud_preferred mode
      if (this.privacyMode === 'cloud_preferred' && !m.isLocal) {
        score += 20;
      }

      // Tool support requirement
      if (m.supportsTools) {
        score += 50;
      }

      switch (taskKind) {
        case 'planning':
          // Prioritize large context window
          score += Math.min(50, (m.contextWindow / 32768) * 30);
          if (m.id.toLowerCase().includes('qwen') || m.id.toLowerCase().includes('llama3') || m.id.toLowerCase().includes('deepseek')) {
            score += 20;
          }
          break;

        case 'coding':
          // Prioritize coding specialized models
          if (m.id.toLowerCase().includes('coder') || m.id.toLowerCase().includes('code')) {
            score += 40;
          }
          score += Math.min(30, (m.contextWindow / 16384) * 20);
          break;

        case 'review':
          if (m.contextWindow >= 16384) score += 25;
          break;

        case 'quick':
          // Small parameter models
          if (m.id.includes(':1.5b') || m.id.includes(':3b') || m.id.includes(':7b') || m.id.includes(':8b')) {
            score += 40;
          }
          break;
      }

      return { model: m, score };
    });

    scored.sort((a, b) => b.score - a.score);
    return scored[0].model;
  }
}
