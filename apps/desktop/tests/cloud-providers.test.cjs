const { test } = require('node:test');
const assert = require('node:assert/strict');
const adapter = require('@zq/providers');
const key = 'fixture-secret-never-display';
const jpeg = '/9j/2Q==';
const png = 'iVBORw0KGgo=';
const bases = { openai: 'https://api.openai.com/v1', anthropic: 'https://api.anthropic.com/v1', google: 'https://generativelanguage.googleapis.com/v1beta', xai: 'https://api.x.ai/v1', vllm: 'http://127.0.0.1:8000/v1' };
function provider(name, options = {}) { assert.equal(typeof adapter.createProvider, 'function', 'native provider factory exists'); return adapter.createProvider(name, { apiKey: key, ...options }); }
function response(chunks, { status = 200, redirected = false, hang = false, cancel = () => {} } = {}) {
  return { status, redirected, body: new ReadableStream({ start(c) { for (const s of chunks) c.enqueue(typeof s === 'string' ? new TextEncoder().encode(s) : s); if (!hang) c.close(); }, cancel }) };
}
function event(data, name) { return `${name ? `event: ${name}\n` : ''}data: ${typeof data === 'string' ? data : JSON.stringify(data)}\n\n`; }
const openDelta = event({ type: 'response.output_text.delta', delta: 'Hello 🌍' });
const openDone = event({ type: 'response.completed', response: { status: 'completed' } });
function request(name = 'openai', extra = {}) { return { baseUrl: bases[name], model: 'fixture-chat', messages: [{ role: 'user', content: 'Hi' }], onDelta() {}, ...extra }; }

test('normalization fixes cloud destinations and validates local endpoints', () => {
  assert.equal(typeof adapter.normalizeConnection, 'function');
  for (const name of ['openai', 'anthropic', 'google', 'xai']) {
    assert.deepEqual(adapter.normalizeConnection({ provider: name }), { provider: name, baseUrl: bases[name] });
    assert.throws(() => adapter.normalizeConnection({ provider: name, baseUrl: 'https://attacker.example' }), { code: 'INVALID_ENDPOINT' });
  }
  assert.deepEqual(adapter.normalizeConnection({ provider: 'vllm', baseUrl: 'http://LOCALHOST:8000/' }), { provider: 'vllm', baseUrl: 'http://localhost:8000/v1' });
  assert.equal(adapter.normalizeConnection({ provider: 'vllm', baseUrl: 'https://host/proxy/v1/' }).baseUrl, 'https://host/proxy/v1');
  for (const baseUrl of ['http://u:p@host', 'http://host/?x', 'http://host/#', 'file:///tmp/a', 'http:\\host']) assert.throws(() => adapter.normalizeConnection({ provider: 'vllm', baseUrl }), { code: 'INVALID_ENDPOINT' });
  assert.throws(() => adapter.normalizeConnection({ provider: 'unknown' }), { code: 'INVALID_PROVIDER' });
});

test('OpenAI serializes Responses history and image MIME, disables storage, streams fragmented UTF-8', async () => {
  const deltas = []; let sent;
  const p = provider('openai', { fetchImpl: async (url, options) => { sent = { url, ...options }; return response(Array.from(new TextEncoder().encode(': keepalive\r\n\r\n' + openDelta + openDone), b => Uint8Array.of(b))); } });
  await p.streamChat(request('openai', { messages: [{ role: 'system', content: 'Brief' }, { role: 'user', content: 'Image', images: [jpeg, png] }, { role: 'assistant', content: 'Earlier answer' }, { role: 'user', content: 'Continue' }], onDelta: d => deltas.push(d) }));
  assert.equal(sent.url, 'https://api.openai.com/v1/responses');
  assert.equal(sent.headers.Authorization, `Bearer ${key}`); assert.equal(sent.redirect, 'manual'); assert.equal(sent.credentials, 'omit');
  const body = JSON.parse(sent.body); assert.equal(body.store, false); assert.equal(body.stream, true);
  assert.deepEqual(body.input, [{ role: 'system', content: 'Brief' }, { role: 'user', content: [{ type: 'input_text', text: 'Image' }, { type: 'input_image', image_url: `data:image/jpeg;base64,${jpeg}` }, { type: 'input_image', image_url: `data:image/png;base64,${png}` }] }, { role: 'assistant', content: 'Earlier answer' }, { role: 'user', content: 'Continue' }]);
  assert.deepEqual(deltas, [{ content: 'Hello 🌍', thinking: '' }]);
});

test('Anthropic separates system instructions and emits thinking and text deltas', async () => {
  let sent; const deltas = [];
  const p = provider('anthropic', { fetchImpl: async (url, options) => { sent = { url, ...options }; return response([event({ type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: 'Considering' } }) + event({ type: 'content_block_delta', delta: { type: 'text_delta', text: 'Answer' } }) + event({ type: 'message_delta', delta: { stop_reason: 'end_turn' } }) + event({ type: 'message_stop' })]); } });
  await p.streamChat(request('anthropic', { messages: [{ role: 'system', content: 'Brief' }, { role: 'user', content: 'Image', images: [jpeg] }, { role: 'assistant', content: 'Prior' }, { role: 'user', content: 'Next' }], onDelta: d => deltas.push(d) }));
  assert.equal(sent.url, bases.anthropic + '/messages'); assert.equal(sent.headers['x-api-key'], key); assert.equal(sent.headers['anthropic-version'], '2023-06-01');
  const body = JSON.parse(sent.body); assert.equal(body.system, 'Brief'); assert.equal(body.max_tokens, 8192);
  assert.deepEqual(body.messages[0], { role: 'user', content: [{ type: 'text', text: 'Image' }, { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: jpeg } }] });
  assert.equal(body.messages[1].role, 'assistant'); assert.deepEqual(deltas, [{ content: '', thinking: 'Considering' }, { content: 'Answer', thinking: '' }]);
});

test('Gemini uses native system, model role, inline images, header key and candidate finish', async () => {
  let sent; const deltas = [];
  const p = provider('google', { fetchImpl: async (url, options) => { sent = { url, ...options }; return response([event({ candidates: [{ index: 0, content: { role: 'model', parts: [{ text: 'Hmm', thought: true }, { text: 'Answer' }] } }] }) + event({ candidates: [{ index: 0, finishReason: 'STOP' }] })]); } });
  await p.streamChat(request('google', { model: 'models/fixture-chat', messages: [{ role: 'system', content: 'Brief' }, { role: 'assistant', content: 'Prior' }, { role: 'user', content: 'Image', images: [png] }], onDelta: d => deltas.push(d) }));
  assert.equal(sent.url, bases.google + '/models/fixture-chat:streamGenerateContent?alt=sse'); assert.equal(sent.headers['x-goog-api-key'], key); assert.ok(!sent.url.includes(key));
  const body = JSON.parse(sent.body); assert.deepEqual(body.systemInstruction, { parts: [{ text: 'Brief' }] }); assert.equal(body.contents[0].role, 'model');
  assert.deepEqual(body.contents[1].parts, [{ text: 'Image' }, { inlineData: { mimeType: 'image/png', data: png } }]);
  assert.deepEqual(deltas, [{ content: '', thinking: 'Hmm' }, { content: 'Answer', thinking: '' }]);
});

for (const name of ['xai', 'vllm']) test(`${name} uses compatible chat with images and reasoning deltas`, async () => {
  let sent; const deltas = [];
  const p = provider(name, { fetchImpl: async (url, options) => { sent = { url, ...options }; return response([event({ choices: [{ index: 0, delta: { content: 'A', reasoning_content: 'B' }, finish_reason: null }] }) + event({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }) + event('[DONE]')]); } });
  await p.streamChat(request(name, { messages: [{ role: 'user', content: 'Image', images: [jpeg] }], onDelta: d => deltas.push(d) }));
  assert.equal(sent.url, bases[name] + '/chat/completions'); assert.equal(sent.headers.Authorization, `Bearer ${key}`);
  assert.deepEqual(JSON.parse(sent.body).messages[0].content, [{ type: 'text', text: 'Image' }, { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${jpeg}` } }]);
  assert.deepEqual(deltas, [{ content: 'A', thinking: 'B' }]);
});

test('OpenAI model discovery excludes embedding, audio, images and legacy non-chat models', async () => {
  const ids = ['gpt-4.1', 'gpt-4o-mini', 'o3', 'text-embedding-3-small', 'gpt-image-1', 'gpt-4o-audio-preview', 'gpt-4o-realtime-preview', 'dall-e-3', 'whisper-1', 'tts-1', 'davinci-002', 'gpt-4.1'];
  const p = provider('openai', { fetchImpl: async () => response([JSON.stringify({ data: ids.map(id => ({ id })) })]) });
  assert.deepEqual(await p.listModels(bases.openai), ['gpt-4.1', 'gpt-4o-mini', 'o3']);
});

test('Anthropic and Google paginate with bounded cursors and filter unsupported generation', async () => {
  for (const name of ['anthropic', 'google']) {
    const urls = [];
    const pages = name === 'anthropic' ? [{ data: [{ id: 'claude-a', capabilities: { image_input: { supported: true } } }], has_more: true, last_id: 'claude-a' }, { data: [{ id: 'claude-b' }], has_more: false }] : [{ models: [{ name: 'models/gemini-a', supportedGenerationMethods: ['generateContent'] }, { name: 'models/embed', supportedGenerationMethods: ['embedContent'] }, { name: 'models/gemini-image-preview', supportedGenerationMethods: ['generateContent'] }], nextPageToken: 'cursor/&' }, { models: [{ name: 'models/gemini-b', supportedGenerationMethods: ['generateContent'] }] }];
    const p = provider(name, { fetchImpl: async url => { urls.push(url); return response([JSON.stringify(pages[urls.length - 1])]); } });
    assert.deepEqual(await p.listModels(bases[name]), name === 'anthropic' ? ['claude-a', 'claude-b'] : ['gemini-a', 'gemini-b']);
    assert.equal(urls.length, 2); assert.ok(urls[1].includes(name === 'anthropic' ? 'after_id=claude-a' : 'pageToken=cursor%2F%26'));
    if (name === 'anthropic') assert.equal(await p.supportsImages(bases[name], 'claude-a'), true);
  }
});

test('xAI discovers language models with image capability metadata', async () => {
  const p = provider('xai', { fetchImpl: async url => { assert.equal(url, bases.xai + '/language-models'); return response([JSON.stringify({ models: [{ id: 'chat', input_modalities: ['text', 'image'], output_modalities: ['text'] }, { id: 'image', output_modalities: ['image'] }] })]); } });
  assert.deepEqual(await p.listModels(bases.xai), ['chat']); assert.equal(await p.supportsImages(bases.xai, 'chat'), true);
});

for (const [label, chunks, code] of [
  ['early EOF', [openDelta], 'EARLY_EOF'], ['malformed JSON', ['data: {bad}\n\n'], 'INVALID_RESPONSE'],
  ['invalid UTF-8', [Uint8Array.of(255)], 'INVALID_RESPONSE'],
  ['provider error', [event({ type: 'error', error: { message: key } })], 'PROVIDER_ERROR'],
  ['failed response', [event({ type: 'response.failed', response: { error: { message: key } } })], 'PROVIDER_ERROR'],
  ['incomplete response', [event({ type: 'response.incomplete', response: { status: 'incomplete' } })], 'INCOMPLETE'],
  ['invalid delta', [event({ type: 'response.output_text.delta', delta: {} })], 'INVALID_RESPONSE'],
  ['wire limit', [' '.repeat(4 * 1024 * 1024 + 1)], 'RESPONSE_LIMIT'],
  ['text limit', [event({ type: 'response.output_text.delta', delta: 'a'.repeat(2 * 1024 * 1024 + 1) })], 'RESPONSE_LIMIT'],
]) test(`cloud stream rejects ${label} without secret details`, async () => {
  const p = provider('openai', { fetchImpl: async () => response(chunks) });
  await assert.rejects(p.streamChat(request()), e => e.code === code && !e.message.includes(key));
});

for (const name of Object.keys(bases)) test(`${name} rejects redirects, HTTP errors and transport messages without leaking secrets`, async () => {
  for (const [status, redirected, code] of [[307, false, 'REDIRECT'], [200, true, 'REDIRECT'], [401, false, 'HTTP_ERROR'], [429, false, 'HTTP_ERROR']]) {
    const p = provider(name, { fetchImpl: async (_url, options) => { assert.equal(options.redirect, 'manual'); return response([key], { status, redirected }); } });
    await assert.rejects(p.listModels(bases[name]), e => e.code === code && !e.message.includes(key));
    await assert.rejects(p.streamChat(request(name)), e => e.code === code && !e.message.includes(key));
  }
  const p = provider(name, { fetchImpl: async () => { throw new Error(key); } });
  await assert.rejects(p.streamChat(request(name)), e => e.code === 'NETWORK_ERROR' && !e.message.includes(key));
});

test('pre-abort avoids fetch; abort from callback stops same-chunk deltas', async () => {
  let calls = 0; const c = new AbortController(); c.abort();
  const p = provider('openai', { fetchImpl: async () => { calls++; return response([openDelta + openDelta + openDone]); } });
  await assert.rejects(p.streamChat(request('openai', { signal: c.signal })), { code: 'ABORTED' }); assert.equal(calls, 0);
  const c2 = new AbortController(); let deltas = 0;
  await assert.rejects(p.streamChat(request('openai', { signal: c2.signal, onDelta() { deltas++; c2.abort(); } })), { code: 'ABORTED' }); assert.equal(deltas, 1);
});

test('abort cancels stalled reader and late fetch bodies', async () => {
  let cancelled = false; const c = new AbortController();
  const p = provider('openai', { fetchImpl: async () => response([], { hang: true, cancel() { cancelled = true; } }) });
  const pending = p.streamChat(request('openai', { signal: c.signal })); await new Promise(setImmediate); c.abort();
  await assert.rejects(pending, { code: 'ABORTED' }); assert.equal(cancelled, true);
  let resolveFetch; cancelled = false; const c2 = new AbortController();
  const p2 = provider('openai', { fetchImpl: () => new Promise(resolve => { resolveFetch = resolve; }) });
  const pending2 = p2.streamChat(request('openai', { signal: c2.signal })); c2.abort(); await assert.rejects(pending2, { code: 'ABORTED' });
  resolveFetch(response([], { hang: true, cancel() { cancelled = true; } })); await new Promise(setImmediate); assert.equal(cancelled, true);
});

for (const [options, code] of [[{ idleMs: 15, totalMs: 500 }, 'IDLE_TIMEOUT'], [{ idleMs: 500, totalMs: 15 }, 'TOTAL_TIMEOUT']]) test(`${code} bounds abort-insensitive fetch`, async () => {
  const p = provider('openai', { ...options, fetchImpl: () => new Promise(() => {}) });
  await assert.rejects(p.streamChat(request()), { code });
});

test('terminal event cancels connection without waiting for EOF', async () => {
  let cancelled = false; const p = provider('openai', { fetchImpl: async () => response([openDone], { hang: true, cancel() { cancelled = true; } }) });
  await p.streamChat(request()); assert.equal(cancelled, true);
});

test('model discovery rejects loops and oversized metadata', async () => {
  let calls = 0;
  const p = provider('anthropic', { fetchImpl: async () => { calls++; return response([JSON.stringify({ data: [{ id: 'same' }], has_more: true, last_id: 'same' })]); } });
  await assert.rejects(p.listModels(bases.anthropic), { code: 'INVALID_RESPONSE' }); assert.ok(calls <= 10);
  const huge = provider('openai', { fetchImpl: async () => response([' '.repeat(1024 * 1024 + 1)]) });
  await assert.rejects(huge.listModels(bases.openai), { code: 'RESPONSE_LIMIT' });
});

test('cloud credentials and message/image size validation occur before transport', async () => {
  assert.throws(() => adapter.createProvider('openai'), { code: 'MISSING_API_KEY' });
  let calls = 0; const p = provider('openai', { fetchImpl: async () => { calls++; return response([openDone]); } });
  for (const messages of [[{ role: 'tool', content: 'bad' }], [{ role: 'assistant', content: 'bad', images: [jpeg] }], [{ role: 'user', content: 'bad', images: ['YWJjZA=='] }], [{ role: 'user', content: 'a'.repeat(12 * 1024 * 1024) }]]) await assert.rejects(p.streamChat(request('openai', { messages })), { code: 'INVALID_REQUEST' });
  assert.equal(calls, 0);
});

for (const [name, chunks, code] of [
  ['anthropic', [event({ type: 'content_block_delta', delta: { type: 'text_delta', text: 'Partial' } })], 'EARLY_EOF'],
  ['anthropic', [event({ type: 'message_stop' })], 'EARLY_EOF'],
  ['anthropic', [event({ type: 'message_delta', delta: { stop_reason: 'max_tokens' } })], 'INCOMPLETE'],
  ['anthropic', [event({ type: 'content_block_start', content_block: { type: 'tool_use' } })], 'UNSUPPORTED_OUTPUT'],
  ['google', [event({ candidates: [{ content: { parts: [{ text: 'Partial' }] } }] })], 'EARLY_EOF'],
  ['google', [event({ candidates: [{ finishReason: 'MAX_TOKENS' }] })], 'INCOMPLETE'],
  ['google', [event({ promptFeedback: { blockReason: 'SAFETY' } })], 'PROVIDER_ERROR'],
  ['google', [event({ candidates: [{ content: { parts: [{ functionCall: { name: 'run' } }] } }] })], 'UNSUPPORTED_OUTPUT'],
  ['xai', [event('[DONE]')], 'EARLY_EOF'],
  ['vllm', [event({ choices: [{ index: 0, delta: {}, finish_reason: 'length' }] })], 'INCOMPLETE'],
  ['vllm', [event({ choices: [{ index: 0, delta: { tool_calls: [] }, finish_reason: null }] })], 'UNSUPPORTED_OUTPUT'],
  ['openai', [event({ type: 'response.output_item.added', item: { type: 'function_call' } })], 'UNSUPPORTED_OUTPUT'],
]) test(`${name} reports ${code} for ${chunks[0].trim().slice(0, 80)}`, async () => {
  const p = provider(name, { fetchImpl: async () => response(chunks) });
  await assert.rejects(p.streamChat(request(name)), { code });
});

test('SSE supports multiline data and CR delimiters; refuses partial frames and post-completion data', async () => {
  const deltas = [];
  const p = provider('openai', { fetchImpl: async () => response(['event: response.output_text.delta\rdata: {"type":"response.output_text.delta",\rdata: "delta":"OK"}\r\r', openDone]) });
  await p.streamChat(request('openai', { onDelta: d => deltas.push(d) })); assert.equal(deltas[0].content, 'OK');
  for (const [chunks, code] of [[[openDone.trimEnd()], 'EARLY_EOF'], [[openDone + openDelta], 'INVALID_RESPONSE']]) {
    await assert.rejects(provider('openai', { fetchImpl: async () => response(chunks) }).streamChat(request()), { code });
  }
});

test('body idle deadline, fixed total deadline and thrown reads release resources', async () => {
  const idle = provider('openai', { idleMs: 15, totalMs: 500, fetchImpl: async () => response([openDelta], { hang: true }) });
  await assert.rejects(idle.streamChat(request()), { code: 'IDLE_TIMEOUT' });
  let interval, cancelled = false;
  const total = provider('openai', { idleMs: 100, totalMs: 35, fetchImpl: async () => ({ status: 200, body: new ReadableStream({ start(c) { interval = setInterval(() => c.enqueue(new TextEncoder().encode(': heartbeat\n\n')), 5); }, cancel() { clearInterval(interval); cancelled = true; } }) }) });
  try { await assert.rejects(total.streamChat(request()), { code: 'TOTAL_TIMEOUT' }); assert.equal(cancelled, true); } finally { clearInterval(interval); }
  const broken = provider('openai', { fetchImpl: async () => ({ status: 200, body: { getReader() { return { read() { throw Error(key); }, async cancel() { cancelled = true; } }; } } }) });
  cancelled = false; await assert.rejects(broken.streamChat(request()), e => e.code === 'NETWORK_ERROR' && !e.message.includes(key)); assert.equal(cancelled, true);
});

test('discovery rejects malformed capabilities and missing names', async () => {
  for (const [name, payload] of [['google', { models: [{ name: 'models/gemini-a', supportedGenerationMethods: 'generateContent' }] }], ['xai', { models: [{ id: 'a', output_modalities: 'text' }] }], ['openai', { data: [{ id: '' }] }], ['vllm', { data: [{ id: 'a', capabilities: {} }] }]]) {
    await assert.rejects(provider(name, { fetchImpl: async () => response([JSON.stringify(payload)]) }).listModels(bases[name]), { code: 'INVALID_RESPONSE' });
  }
});

test('vLLM discovers served chat models without requiring a key and only advertises known vision', async () => {
  const p = adapter.createProvider('vllm', { fetchImpl: async (url, options) => { assert.equal(url, bases.vllm + '/models'); assert.equal(options.headers.Authorization, undefined); return response([JSON.stringify({ data: [{ id: 'local/chat' }, { id: 'local/vision', capabilities: ['completion', 'vision'] }, { id: 'local/embed', capabilities: ['embedding'] }] })]); } });
  assert.deepEqual(await p.listModels(bases.vllm), ['local/chat', 'local/vision']); assert.equal(await p.supportsImages(bases.vllm, 'local/chat'), null); assert.equal(await p.supportsImages(bases.vllm, 'local/vision'), true);
});

test('cloud generation leaves room for reasoning and respects known model output limits', async () => {
  let sent;
  const p = provider('openai', { fetchImpl: async (_url, options) => { sent = JSON.parse(options.body); return response([openDone]); } });
  await p.streamChat(request()); assert.equal(sent.max_output_tokens, 8192);
  const a = provider('anthropic', { fetchImpl: async (url, options) => {
    if (url.includes('/models')) return response([JSON.stringify({ data: [{ id: 'fixture-chat', max_tokens: 4096 }], has_more: false })]);
    sent = JSON.parse(options.body); return response([event({ type: 'message_delta', delta: { stop_reason: 'end_turn' } }) + event({ type: 'message_stop' })]);
  } });
  await a.listModels(bases.anthropic); await a.streamChat(request('anthropic')); assert.equal(sent.max_tokens, 4096);
});

test('OpenAI discovery excludes legacy completion variants and retains full supported fine-tune IDs', async () => {
  const ids = ['gpt-3.5-turbo-instruct', 'gpt-3.5-turbo-instruct-0914', 'ft:gpt-3.5-turbo-instruct-0914:org:custom:id', 'gpt-4-base', 'gpt-4-code-completion', 'gpt-oss-20b', 'davinci-002', 'code-davinci-002', 'gpt-4o', 'gpt-4-turbo', 'gpt-3.5-turbo', 'chat-latest', 'ft:gpt-4o-2024-08-06:org:image-search:id'];
  const p = provider('openai', { fetchImpl: async () => response([JSON.stringify({ data: ids.map(id => ({ id })) })]) });
  assert.deepEqual(await p.listModels(bases.openai), ['gpt-4o', 'gpt-4-turbo', 'gpt-3.5-turbo', 'chat-latest', 'ft:gpt-4o-2024-08-06:org:image-search:id']);
});

test('OpenAI image support follows base model capabilities through aliases and fine-tunes', async () => {
  const p = provider('openai', { fetchImpl: async () => { throw Error('No network needed'); } });
  for (const model of ['gpt-4-turbo', 'gpt-4-turbo-2024-04-09', 'gpt-4-1106-vision-preview', 'gpt-4o', 'gpt-4.5-preview', 'ft:gpt-4o-2024-08-06:org:custom:id', 'chatgpt-4o-latest', 'chat-latest']) assert.equal(await p.supportsImages(bases.openai, model), true, model);
  for (const model of ['gpt-3.5-turbo', 'ft:gpt-3.5-turbo-0125:org:vision:id', 'gpt-4', 'gpt-4-turbo-preview', 'gpt-4-0125-preview', 'gpt-4-1106-preview', 'o3-mini', 'o1-mini', 'gpt-4o-audio-preview']) assert.equal(await p.supportsImages(bases.openai, model), false, model);
});

test('OpenAI legacy chat models use compatible endpoint and output limits; modern models keep Responses', async () => {
  for (const [model, expectedCap] of [['gpt-3.5-turbo', 4096], ['gpt-4', 8192], ['gpt-4-turbo', 4096], ['gpt-4-turbo-preview', 4096], ['chatgpt-4o-latest', 8192], ['ft:gpt-3.5-turbo-0125:org:custom:id', 4096]]) {
    let sent; const deltas = [];
    const p = provider('openai', { fetchImpl: async (url, options) => { sent = { url, body: JSON.parse(options.body) }; return response([event({ choices: [{ index: 0, delta: { content: 'OK' }, finish_reason: 'stop' }] }) + event('[DONE]')]); } });
    await p.streamChat(request('openai', { model, onDelta: d => deltas.push(d) }));
    assert.equal(sent.url, bases.openai + '/chat/completions'); assert.equal(sent.body.model, model); assert.equal(sent.body.max_tokens, expectedCap); assert.equal(sent.body.store, false); assert.equal(deltas[0].content, 'OK');
  }
  for (const model of ['gpt-4o', 'gpt-4.1', 'chat-latest', 'ft:gpt-4o-2024-08-06:org:custom:id']) {
    const p = provider('openai', { fetchImpl: async (url, options) => { assert.equal(url, bases.openai + '/responses'); assert.equal(JSON.parse(options.body).model, model); return response([openDone]); } });
    await p.streamChat(request('openai', { model }));
  }
});
