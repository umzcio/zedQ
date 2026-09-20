const { createOllamaProvider, normalizeBaseUrl } = require('./ollama.cjs');
const { createCloudProvider } = require('./native.cjs');
const { failure } = require('./transport.cjs');

const PROVIDERS = Object.freeze({
  ollama: Object.freeze({ name: 'Ollama', baseUrl: 'http://127.0.0.1:11434', local: true }),
  vllm: Object.freeze({ name: 'vLLM', baseUrl: 'http://127.0.0.1:8000/v1', local: true }),
  openai: Object.freeze({ name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', local: false }),
  anthropic: Object.freeze({ name: 'Anthropic', baseUrl: 'https://api.anthropic.com/v1', local: false }),
  google: Object.freeze({ name: 'Google', baseUrl: 'https://generativelanguage.googleapis.com/v1beta', local: false }),
  xai: Object.freeze({ name: 'xAI', baseUrl: 'https://api.x.ai/v1', local: false }),
  perplexity: Object.freeze({ name: 'Perplexity', baseUrl: 'https://api.perplexity.ai', local: false }),
  openrouter: Object.freeze({ name: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', local: false }),
  groq: Object.freeze({ name: 'Groq', baseUrl: 'https://api.groq.com/openai/v1', local: false }),
  bedrock: Object.freeze({ name: 'AWS Bedrock', baseUrl: 'https://bedrock-runtime.us-east-1.amazonaws.com', local: false }),
});

function normalizeConnection({ provider = 'ollama', baseUrl } = {}) {
  if (typeof provider !== 'string' || !Object.hasOwn(PROVIDERS, provider)) throw failure('INVALID_PROVIDER', 'Choose a supported model provider.');
  const definition = PROVIDERS[provider]; let normalized;
  try { normalized = normalizeBaseUrl(baseUrl === undefined || baseUrl === '' ? definition.baseUrl : baseUrl); }
  catch { throw failure('INVALID_ENDPOINT', 'Enter an HTTP or HTTPS endpoint without credentials, query, or fragment.'); }
  if (provider === 'bedrock') {
    if (!/^https:\/\/bedrock-runtime\.[a-z]{2}(?:-[a-z]+){1,2}-[1-9]\.amazonaws\.com$/.test(normalized)) throw failure('INVALID_ENDPOINT', 'Choose an AWS Bedrock region.');
  } else if (!definition.local && normalized !== definition.baseUrl) throw failure('INVALID_ENDPOINT', 'Cloud providers use their official HTTPS endpoint.');
  if (provider === 'vllm' && !normalized.endsWith('/v1')) normalized += '/v1';
  return { provider, baseUrl: normalized };
}

function createProvider(provider, options = {}) {
  normalizeConnection({ provider });
  if (provider === 'ollama') return createOllamaProvider(options);
  if (provider === 'perplexity') return require('./perplexity.cjs').createPerplexityProvider(options, baseUrl => normalizeConnection({ provider, baseUrl }).baseUrl);
  if (provider === 'bedrock') return require('./bedrock.cjs').createBedrockProvider(options, baseUrl => normalizeConnection({ provider, baseUrl }).baseUrl);
  return createCloudProvider(provider, options, baseUrl => normalizeConnection({ provider, baseUrl }).baseUrl);
}

module.exports = { ...require('./hosted-tools.cjs'), researchCapabilities: require('./research.cjs').researchCapabilities, createProvider, normalizeConnection, PROVIDERS, createOllamaProvider, normalizeBaseUrl };
