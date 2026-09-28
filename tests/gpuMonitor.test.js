const assert = require('node:assert/strict');
const { test } = require('node:test');

const { parseNvidiaSmiOutput, estimateGpuModelFit } = require('../dist/remote/gpuMonitor.js');

test('parseNvidiaSmiOutput correctly parses nvidia-smi CSV rows', () => {
  const csv = '0, NVIDIA GeForce RTX 4090, 24576, 6144, 45\n1, NVIDIA A100-SXM4-80GB, 81920, 20480, 80';
  const gpus = parseNvidiaSmiOutput(csv);

  assert.equal(gpus.length, 2);
  assert.equal(gpus[0].index, 0);
  assert.equal(gpus[0].model, 'NVIDIA GeForce RTX 4090');
  assert.equal(gpus[0].vramTotalGb, 24);
  assert.equal(gpus[0].vramUsedGb, 6);
  assert.equal(gpus[0].utilizationPercent, 45);
  assert.match(gpus[0].displayText, /VRAM 6 \/ 24 GB/);

  assert.equal(gpus[1].index, 1);
  assert.equal(gpus[1].vramTotalGb, 80);
});

test('estimateGpuModelFit predicts fitting within free and total VRAM', () => {
  const gpu = {
    index: 0,
    model: 'RTX 4090',
    vramTotalMb: 24576,
    vramUsedMb: 6144,
    vramTotalGb: 24,
    vramUsedGb: 6,
    utilizationPercent: 20,
    displayText: 'RTX 4090'
  };

  // 7B model (~4.5 GB) should fit comfortably in 18 GB free
  const smallModel = estimateGpuModelFit(gpu, 4.5 * 1024 * 1024 * 1024);
  assert.equal(smallModel.status, 'Likely fits');

  // 70B model (~40 GB) exceeds total 24 GB
  const largeModel = estimateGpuModelFit(gpu, 40 * 1024 * 1024 * 1024);
  assert.equal(largeModel.status, 'Exceeds available VRAM');
});
