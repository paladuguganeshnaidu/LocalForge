export interface GpuStatusInfo {
  index: number;
  model: string;
  vramTotalMb: number;
  vramUsedMb: number;
  vramTotalGb: number;
  vramUsedGb: number;
  utilizationPercent: number;
  displayText: string;
}

export type MemoryFitEstimation = 'Likely fits' | 'May be memory constrained' | 'Exceeds available VRAM' | 'Unknown';

/**
 * Parse the CSV output of nvidia-smi:
 * index, name, memory.total, memory.used, utilization.gpu
 */
export function parseNvidiaSmiOutput(csvOutput: string): GpuStatusInfo[] {
  if (!csvOutput || !csvOutput.trim()) {
    return [];
  }

  const lines = csvOutput.trim().split(/\r?\n/);
  const results: GpuStatusInfo[] = [];

  for (const line of lines) {
    const parts = line.split(',').map((p) => p.trim());
    if (parts.length < 5) continue;

    const index = parseInt(parts[0], 10) || 0;
    const model = parts[1] || 'Unknown GPU';
    const totalMb = parseFloat(parts[2]) || 0;
    const usedMb = parseFloat(parts[3]) || 0;
    const utilization = parseFloat(parts[4]) || 0;

    const totalGb = Math.round((totalMb / 1024) * 10) / 10;
    const usedGb = Math.round((usedMb / 1024) * 10) / 10;

    const displayText = `NVIDIA ${model.replace(/^NVIDIA\s+/i, '')} · VRAM ${usedGb} / ${totalGb} GB · Util ${utilization}%`;

    results.push({
      index,
      model,
      vramTotalMb: totalMb,
      vramUsedMb: usedMb,
      vramTotalGb: totalGb,
      vramUsedGb: usedGb,
      utilizationPercent: utilization,
      displayText
    });
  }

  return results;
}

/**
 * Estimate if a model likely fits into the GPU VRAM.
 * Note: Never claim that a model definitely fits unless authoritative.
 */
export function estimateGpuModelFit(
  gpu: GpuStatusInfo,
  modelSizeBytes?: number
): { status: MemoryFitEstimation; reason: string } {
  if (!modelSizeBytes || modelSizeBytes <= 0) {
    return { status: 'Unknown', reason: 'Model size information unavailable.' };
  }

  const modelSizeGb = modelSizeBytes / (1024 * 1024 * 1024);
  const freeVramGb = Math.max(0, gpu.vramTotalGb - gpu.vramUsedGb);

  // Overhead multiplier for context KV cache and inference runtime
  const requiredEstGb = modelSizeGb * 1.25;

  if (requiredEstGb > gpu.vramTotalGb) {
    return {
      status: 'Exceeds available VRAM',
      reason: `Model estimated ${Math.round(requiredEstGb * 10) / 10}GB exceeds total GPU VRAM (${gpu.vramTotalGb}GB).`
    };
  }

  if (requiredEstGb > freeVramGb) {
    return {
      status: 'May be memory constrained',
      reason: `Model estimated ${Math.round(requiredEstGb * 10) / 10}GB may be memory constrained under current usage (${gpu.vramUsedGb}GB used / ${gpu.vramTotalGb}GB total).`
    };
  }

  return {
    status: 'Likely fits',
    reason: `Model estimated ${Math.round(requiredEstGb * 10) / 10}GB fits comfortably in free VRAM (${Math.round(freeVramGb * 10) / 10}GB free).`
  };
}
