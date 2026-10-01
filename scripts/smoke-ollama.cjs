const baseUrl = (process.env.LOCALFORGE_OLLAMA_URL || 'http://127.0.0.1:11434').replace(/\/$/, '');
const model = process.env.LOCALFORGE_OLLAMA_MODEL || 'qwen2.5-coder:1.5b';

async function request(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    signal: AbortSignal.timeout(120000)
  });
  if (!response.ok) throw new Error(`${path} returned HTTP ${response.status}`);
  return response.json();
}

async function main() {
  const tags = await request('/api/tags');
  const models = Array.isArray(tags.models) ? tags.models : [];
  console.log(`Ollama is reachable at ${baseUrl}; discovered ${models.length} installed model(s).`);
  if (!models.some((item) => item.name === model || item.model === model)) {
    throw new Error(`Model "${model}" is not installed. Set LOCALFORGE_OLLAMA_MODEL to an installed model.`);
  }

  const result = await request('/api/generate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model, prompt: 'Reply with exactly: LOMVREN_OK', stream: false, options: { num_predict: 24 } })
  });
  if (typeof result.response !== 'string' || !result.response.trim()) {
    throw new Error(`Model "${model}" returned an empty response.`);
  }
  console.log(`Generation succeeded with ${model}: ${JSON.stringify(result.response.trim())}`);
}

main().catch((error) => {
  console.error(`Ollama smoke test failed: ${error.message}`);
  process.exitCode = 1;
});
