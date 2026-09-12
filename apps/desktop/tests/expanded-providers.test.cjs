const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createCloudProvider } = require('../../../packages/providers/native.cjs');
const bases = { openrouter: 'https://openrouter.ai/api/v1', groq: 'https://api.groq.com/openai/v1', perplexity: 'https://api.perplexity.ai' };
const key = 'fixture-secret-never-display';
const png = 'iVBORw0KGgo=';
const event = data => `data: ${typeof data === 'string' ? data : JSON.stringify(data)}\n\n`;
const stop = event({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] });
function response(value, status = 200) {
  return { status, body: new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(value)); c.close(); } }) };
}
function provider(name, fetchImpl) { return createCloudProvider(name, { apiKey: key, fetchImpl }, base => base || bases[name]); }
function request(name, extra = {}) { return { baseUrl: bases[name], model: 'fixture-chat', messages: [{ role: 'user', content: 'Hi' }], onDelta() {}, ...extra }; }
function routerModel(id, input = ['text'], output = ['text']) { return { id, architecture: { input_modalities: input, output_modalities: output } }; }

test('OpenRouter authenticates the key before discovering text-chat models and image capabilities', async () => {
  const calls = [];
  const p = provider('openrouter', async (url, options) => {
    calls.push({ url, options });
    return response(JSON.stringify(url.endsWith('/key') ? { data: { label: 'fixture', is_free_tier: true } } : { data: [routerModel('text'), routerModel('vision', ['text', 'image']), routerModel('image-output', ['text'], ['image']), routerModel('audio-input', ['audio']), routerModel('text')] }));
  });
  assert.deepEqual(await p.listModels(bases.openrouter), ['text', 'vision']);
  assert.deepEqual(calls.map(c => c.url), [bases.openrouter + '/key', bases.openrouter + '/models']);
  assert.ok(calls.every(c => c.options.headers.Authorization === `Bearer ${key}` && c.options.method === 'GET'));
  assert.equal(await p.supportsImages(bases.openrouter, 'vision'), true);
  assert.equal(await p.supportsImages(bases.openrouter, 'text'), false);
  assert.equal(calls.length, 2);
});

test('OpenRouter rejects failed and malformed key validation before reading the public catalog', async () => {
  for (const [payload, status, code] of [[{ error: { message: key } }, 401, 'HTTP_ERROR'], [{ error: { message: key } }, 200, 'PROVIDER_ERROR'], [{ data: [] }, 200, 'INVALID_RESPONSE']]) {
    const urls = []; const p = provider('openrouter', async url => { urls.push(url); return response(JSON.stringify(payload), status); });
    await assert.rejects(p.listModels(bases.openrouter), e => e.code === code && !e.message.includes(key));
    assert.deepEqual(urls, [bases.openrouter + '/key']);
  }
});

test('OpenRouter excludes asynchronous batch variants and prevents sending them as live chats', async () => {
  let generated = false;
  const p = provider('openrouter', async (url, options) => {
    if (options.method === 'POST') generated = true;
    return response(JSON.stringify(url.endsWith('/key') ? { data: {} } : { data: [routerModel('openai/gpt-4-turbo:batch'), routerModel('openai/gpt-4-turbo')] }));
  });
  assert.deepEqual(await p.listModels(bases.openrouter), ['openai/gpt-4-turbo']);
  await assert.rejects(p.streamChat(request('openrouter', { model: 'openai/gpt-4-turbo:batch' })), { code: 'INVALID_REQUEST' });
  assert.equal(generated, false);
});

test('Groq discovers active chat models and only advertises documented or explicit vision support', async () => {
  const ids = ['llama-3.3-70b-versatile', 'openai/gpt-oss-120b', 'qwen/qwen3.6-27b', 'qwen/qwen3.8-27b', 'whisper-large-v3', 'distil-whisper-large-v3-en', 'playai-tts', 'canopylabs/orpheus-v1-english', 'meta-llama/llama-prompt-guard-2-22m', 'llama-guard-3-8b', 'openai/gpt-oss-safeguard-20b', 'text-embedding-3-small'];
  const p = provider('groq', async url => {
    assert.equal(url, bases.groq + '/models');
    return response(JSON.stringify({ data: [...ids.map(id => ({ id, active: true })), { id: 'inactive-chat', active: false }, { id: 'future-vision', active: true, input_modalities: ['text', 'image'], output_modalities: ['text'] }, { id: 'speech', active: true, output_modalities: ['audio'] }] }));
  });
  assert.deepEqual(await p.listModels(bases.groq), [...ids.slice(0, 4), 'future-vision']);
  assert.equal(await p.supportsImages(bases.groq, 'qwen/qwen3.6-27b'), true);
  assert.equal(await p.supportsImages(bases.groq, 'qwen/qwen3.8-27b'), true);
  assert.equal(await p.supportsImages(bases.groq, 'future-vision'), true);
  assert.equal(await p.supportsImages(bases.groq, 'llama-3.3-70b-versatile'), false);
});

for (const name of ['openrouter', 'groq']) {
  test(`${name} fixes credential destinations and rejects upstream authentication failures`, async () => {
    const adapter = require('@zq/providers');
    assert.deepEqual(adapter.normalizeConnection({ provider: name }), { provider: name, baseUrl: bases[name] });
    assert.throws(() => adapter.normalizeConnection({ provider: name, baseUrl: 'https://attacker.example' }), { code: 'INVALID_ENDPOINT' });
    assert.throws(() => adapter.createProvider(name), { code: 'MISSING_API_KEY' });
    for (const status of [307, 401, 403, 429]) {
      const p = adapter.createProvider(name, { apiKey: key, fetchImpl: async () => response(key, status) });
      await assert.rejects(p.listModels(bases[name]), e => e.code === (status === 307 ? 'REDIRECT' : 'HTTP_ERROR') && !e.message.includes(key));
      await assert.rejects(p.streamChat(request(name)), e => e.code === (status === 307 ? 'REDIRECT' : 'HTTP_ERROR') && !e.message.includes(key));
    }
  });
  test(`${name} sends compatible chat, image MIME and reasoning deltas through DONE`, async () => {
    let sent; const deltas = [];
    const p = provider(name, async (url, options) => { sent = { url, ...options }; return response(': keepalive\n\n' + event({ choices: [{ index: 0, delta: { content: 'Answer', reasoning: 'Thinking' }, finish_reason: null }] }) + stop + event('[DONE]')); });
    await p.streamChat(request(name, { messages: [{ role: 'system', content: 'Brief' }, { role: 'user', content: 'Image', images: [png] }], onDelta: d => deltas.push(d) }));
    assert.equal(sent.url, bases[name] + '/chat/completions');
    assert.equal(sent.headers.Authorization, `Bearer ${key}`);
    const body = JSON.parse(sent.body);
    assert.equal(body.stream, true);
    assert.equal(body.max_completion_tokens, undefined);
    assert.equal(body.max_tokens, undefined);
    if (name === 'openrouter') assert.deepEqual(body.modalities, ['text']);
    assert.deepEqual(body.messages[1].content, [{ type: 'text', text: 'Image' }, { type: 'image_url', image_url: { url: `data:image/png;base64,${png}` } }]);
    assert.deepEqual(deltas, [{ content: 'Answer', thinking: 'Thinking' }]);
  });
  test(`${name} rejects truncated streams, upstream errors and unsupported output without secrets`, async () => {
    for (const [wire, code] of [[event('[DONE]'), 'EARLY_EOF'], [stop, 'EARLY_EOF'], [event({ error: { message: key } }), 'PROVIDER_ERROR'], [event({ choices: [{ delta: {}, finish_reason: 'length' }] }), 'INCOMPLETE'], [event({ choices: [{ delta: { tool_calls: [] } }] }), 'UNSUPPORTED_OUTPUT']]) {
      await assert.rejects(provider(name, async () => response(wire)).streamChat(request(name)), e => e.code === code && !e.message.includes(key));
    }
  });
  test(`${name} validates capabilities and bounds catalog data`, async () => {
    for (const data of [Array.from({ length: 1001 }, (_, n) => ({ id: String(n) })), [{ id: 'bad', ...(name === 'openrouter' ? { architecture: { input_modalities: 'text', output_modalities: ['text'] } } : { active: 'true' }) }]]) {
      const p = provider(name, async url => response(JSON.stringify(url.endsWith('/key') ? { data: {} } : { data })));
      await assert.rejects(p.listModels(bases[name]), { code: 'INVALID_RESPONSE' });
    }
    const p = provider(name, async url => response(url.endsWith('/key') ? '{"data":{}}' : ' '.repeat(1024 * 1024 + 1)));
    await assert.rejects(p.listModels(bases[name]), { code: 'RESPONSE_LIMIT' });
  });
  test(`${name} respects discovered output-token caps`, async () => {
    let sent;
    const p = provider(name, async (url, options) => {
      if (options.method === 'POST') { sent = JSON.parse(options.body); return response(stop + event('[DONE]')); }
      return response(JSON.stringify(url.endsWith('/key') ? { data: {} } : { data: [{ ...routerModel('fixture-chat'), active: true, top_provider: { max_completion_tokens: 1024 }, max_completion_tokens: 1024 }] }));
    });
    await p.listModels(bases[name]);
    await p.streamChat(request(name));
    assert.equal(name === 'groq' ? sent.max_completion_tokens : sent.max_tokens, 1024);
  });
}

test('Perplexity finishes on clean EOF and persists safe numbered citations arriving after stop', async () => {
  let sent; const deltas = [];
  const citations = ['https://example.com/a', 'javascript:alert(1)', 'https://example.com/b?q=<x>', 'https://example.com/a'];
  const p = provider('perplexity', async (url, options) => { sent = { url, ...options }; return response(event({ choices: [{ delta: { content: 'Fact[1], more[3].' } }], citations }) + stop + event({ choices: [], citations })); });
  await p.streamChat(request('perplexity', { onDelta: d => deltas.push(d) }));
  assert.equal(sent.url, bases.perplexity + '/v1/sonar');
  const output = deltas.map(d => d.content).join('');
  assert.ok(output.includes('[1]: <https://example.com/a>'));
  assert.ok(output.includes('[3]: <https://example.com/b?q=%3Cx%3E>'));
  assert.ok(output.includes('[4]: <https://example.com/a>'));
  assert.ok(!output.includes('javascript:'));
  assert.equal(output.split('Sources').length, 2);
});

test('Perplexity requires successful completion before appending citations', async () => {
  for (const suffix of ['', event({ error: { message: key } })]) {
    const deltas = []; const p = provider('perplexity', async () => response(event({ choices: [{ delta: { content: 'Partial' } }], citations: ['https://example.com'] }) + suffix));
    await assert.rejects(p.streamChat(request('perplexity', { onDelta: d => deltas.push(d) })));
    assert.deepEqual(deltas, [{ content: 'Partial', thinking: '' }]);
  }
});

test('Perplexity accepts DONE while bounding sources and rejecting malformed final frames', async () => {
  const citations = Array.from({ length: 101 }, (_, i) => `https://example.com/${i + 1}`);
  citations[1] = 'https://example.com/' + 'a'.repeat(8192);
  citations[2] = 'https://example.com/\n[bad]';
  const deltas = [];
  await provider('perplexity', async () => response(event({ choices: [], citations }) + stop + event('[DONE]'))).streamChat(request('perplexity', { onDelta: d => deltas.push(d) }));
  const output = deltas.map(d => d.content).join('');
  assert.ok(output.includes('[100]: <https://example.com/100>'));
  assert.ok(!output.includes('[101]:'));
  assert.ok(!output.includes('[2]:'));
  assert.ok(!output.includes('[3]:'));
  await assert.rejects(provider('perplexity', async () => response(stop + 'data: {')).streamChat(request('perplexity')), { code: 'EARLY_EOF' });
});

test('Perplexity falls back to final search-result URLs and prefers explicit citation ordering', async () => {
  for (const explicit of [false, true]) {
    const deltas = [];
    const wire = event({ choices: [{ delta: { content: 'Fact[1].' } }], ...(explicit ? { citations: ['https://citation.example/'] } : {}) }) +
      event({ object: 'chat.completion.done', choices: [{ delta: { content: '' }, message: { content: 'Fact[1].' }, finish_reason: 'stop' }], search_results: [{ title: 'First', url: 'https://search.example/first' }, { url: 'javascript:bad' }, { url: 'https://search.example/third' }] });
    await provider('perplexity', async () => response(wire)).streamChat(request('perplexity', { onDelta: d => deltas.push(d) }));
    const output = deltas.map(d => d.content).join('');
    assert.equal(output.split('Fact[1].').length, 2);
    assert.ok(output.includes(explicit ? '[1]: <https://citation.example/>' : '[1]: <https://search.example/first>'));
    assert.equal(output.includes('[3]: <https://search.example/third>'), !explicit);
  }
});
