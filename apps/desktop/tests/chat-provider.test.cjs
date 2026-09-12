const { test } = require('node:test');
const assert = require('node:assert/strict');
let adapter;
try { adapter = require('@zq/providers'); } catch (error) { if (error.code !== 'MODULE_NOT_FOUND') throw error; }
const endpoint = 'http://127.0.0.1:11434';
const encoder = new TextEncoder();
function provider(options = {}) {
  assert.ok(adapter?.createOllamaProvider, 'Ollama provider is implemented');
  return adapter.createOllamaProvider(options);
}
function response(chunks, { status = 200, redirected = false, hang = false, cancel = () => {} } = {}) {
  return { status, redirected, body: new ReadableStream({
    start(controller) { for (const chunk of chunks) controller.enqueue(typeof chunk === 'string' ? encoder.encode(chunk) : chunk); if (!hang) controller.close(); },
    cancel,
  }) };
}
function line(content, thinking = '') { return JSON.stringify({ message: { role: 'assistant', content, thinking }, done: false }) + '\n'; }
const done = '{"done":true}\n';
function request(extra = {}) { return { baseUrl: endpoint, model: 'local:small', messages: [{ role: 'user', content: 'Hi' }], onDelta() {}, ...extra }; }

test('normalizes endpoint slashes while rejecting credentials, query, fragment and non-http URLs', () => {
  assert.ok(adapter?.normalizeBaseUrl, 'endpoint normalization is implemented');
  assert.equal(adapter.normalizeBaseUrl('http://LOCALHOST:11434///'), 'http://localhost:11434');
  assert.equal(adapter.normalizeBaseUrl('https://example.com/ollama///'), 'https://example.com/ollama');
  for (const value of ['', null, {}, 'file:///tmp/model', 'ftp://host', 'http://u:p@host', 'http://@host', 'http:////host', 'http://host/?x=1', 'http://host/#a', 'http://host/?', 'http://host/#', ' host ', 'http:\\host']) {
    assert.throws(() => adapter.normalizeBaseUrl(value), { code: 'INVALID_ENDPOINT' });
  }
});

test('lists unique models at the base path with redirects and credentials disabled', async () => {
  const p = provider({ fetchImpl: async (url, options) => {
    assert.equal(url, 'https://example.com/ollama/api/tags');
    assert.equal(options.method, 'GET'); assert.equal(options.redirect, 'manual'); assert.equal(options.credentials, 'omit');
    return response(['{"models":[{"name":"local:a"},{"name":"local:a"},{"name":"local:b"}]}']);
  } });
  assert.deepEqual(await p.listModels('https://example.com/ollama/'), ['local:a', 'local:b']);
});

test('lists completion-capable and legacy models while excluding explicit embedding-only capabilities', async () => {
  const models = [
    { name: 'chat:small', capabilities: ['completion', 'tools'] },
    { name: 'embed:small', capabilities: ['embedding'] },
    { name: 'legacy:small' },
    { name: 'empty:small', capabilities: [] },
  ];
  const p = provider({ fetchImpl: async () => response([JSON.stringify({ models })]) });
  assert.deepEqual(await p.listModels(endpoint), ['chat:small', 'legacy:small']);
});

test('reassembles fragmented JSON and UTF-8 into content and thinking deltas', async () => {
  const bytes = encoder.encode(line('Hello 你好 🌍', 'Reasoning ✓') + done);
  const chunks = Array.from(bytes, (byte) => Uint8Array.of(byte)); const deltas = [];
  const p = provider({ fetchImpl: async (url, options) => {
    assert.equal(url, endpoint + '/api/chat');
    assert.equal(options.method, 'POST'); assert.equal(options.redirect, 'manual'); assert.equal(options.credentials, 'omit');
    assert.deepEqual(options.headers, { 'Content-Type': 'application/json' });
    assert.deepEqual(JSON.parse(options.body), { model: 'local:small', messages: [{ role: 'user', content: 'Hi' }], stream: true, options: { num_predict: 2048 } });
    return response(chunks);
  } });
  await p.streamChat(request({ onDelta: (delta) => deltas.push(delta) }));
  assert.deepEqual(deltas, [{ content: 'Hello 你好 🌍', thinking: 'Reasoning ✓' }]);
});

test('accepts CRLF and a final done record without a newline', async () => {
  const deltas = [];
  const p = provider({ fetchImpl: async () => response([line('ok').replace('\n', '\r\n'), '{"done":true}']) });
  await p.streamChat(request({ onDelta: (delta) => deltas.push(delta) }));
  assert.deepEqual(deltas, [{ content: 'ok', thinking: '' }]);
});

for (const [name, chunks, code] of [
  ['early EOF', [line('partial')], 'EARLY_EOF'],
  ['payload errors', ['{"error":"model missing"}\n'], 'PROVIDER_ERROR'],
  ['malformed JSON', ['{bad}\n'], 'INVALID_RESPONSE'],
  ['invalid UTF-8', [Uint8Array.of(0xff), done], 'INVALID_RESPONSE'],
  ['nonboolean done', ['{"done":"true"}\n'], 'INVALID_RESPONSE'],
  ['missing message', ['{"done":false}\n'], 'INVALID_RESPONSE'],
  ['invalid content', ['{"message":{"content":7},"done":false}\n'], 'INVALID_RESPONSE'],
  ['invalid thinking', ['{"message":{"thinking":[]},"done":false}\n'], 'INVALID_RESPONSE'],
  ['excessive generated text', [line('a'.repeat(1024 * 1024)), line('b'.repeat(1024 * 1024 + 1)), done], 'RESPONSE_LIMIT'],
  ['excessive wire bytes', [' '.repeat(4 * 1024 * 1024 + 1)], 'RESPONSE_LIMIT'],
]) test(`rejects ${name}`, async () => {
  const p = provider({ fetchImpl: async () => response(chunks) });
  await assert.rejects(p.streamChat(request()), { code });
});

for (const [name, status, redirected, code] of [
  ['HTTP failure', 500, false, 'HTTP_ERROR'], ['redirect status', 307, false, 'REDIRECT'], ['followed redirect', 200, true, 'REDIRECT'],
]) test(`rejects ${name} for both methods`, async () => {
  const p = provider({ fetchImpl: async () => response([], { status, redirected }) });
  await assert.rejects(p.listModels(endpoint), { code });
  await assert.rejects(p.streamChat(request()), { code });
});

for (const [name, body, code] of [
  ['oversized metadata', ' '.repeat(1024 * 1024 + 1), 'RESPONSE_LIMIT'],
  ['too many models', JSON.stringify({ models: Array.from({ length: 1001 }, () => ({ name: 'a' })) }), 'INVALID_RESPONSE'],
  ['invalid model name', '{"models":[{"name":7}]}', 'INVALID_RESPONSE'],
  ['invalid model list', '{"models":{}}', 'INVALID_RESPONSE'],
]) test(`rejects ${name}`, async () => {
  const p = provider({ fetchImpl: async () => response([body]) });
  await assert.rejects(p.listModels(endpoint), { code });
});

test('abort before connecting never calls fetch', async () => {
  let called = false; const controller = new AbortController(); controller.abort();
  const p = provider({ fetchImpl: async () => { called = true; return response([done]); } });
  await assert.rejects(p.streamChat(request({ signal: controller.signal })), { code: 'ABORTED' });
  assert.equal(called, false);
});

test('abort interrupts a pending body read and cancels its stream', async () => {
  let cancelled = false, fetchSignal; const controller = new AbortController();
  const p = provider({ fetchImpl: async (_url, options) => { fetchSignal = options.signal; return response([], { hang: true, cancel: () => { cancelled = true; } }); } });
  const pending = p.streamChat(request({ signal: controller.signal }));
  await new Promise((resolve) => setImmediate(resolve)); controller.abort();
  await assert.rejects(pending, { code: 'ABORTED' });
  assert.equal(fetchSignal.aborted, true); assert.equal(cancelled, true);
});

for (const [name, options, code] of [
  ['idle connection', { idleMs: 15, totalMs: 500 }, 'IDLE_TIMEOUT'],
  ['total connection', { idleMs: 500, totalMs: 15 }, 'TOTAL_TIMEOUT'],
]) test(`${name} deadline rejects even if fetch ignores abort`, async () => {
  const p = provider({ ...options, fetchImpl: () => new Promise(() => {}) });
  await assert.rejects(p.streamChat(request()), { code });
});

test('idle deadline covers a stalled response body', async () => {
  const p = provider({ idleMs: 15, totalMs: 500, fetchImpl: async () => response([line('partial')], { hang: true }) });
  await assert.rejects(p.streamChat(request()), { code: 'IDLE_TIMEOUT' });
});

test('a done record completes and cancels without waiting for the server to close', async () => {
  let cancelled = false;
  const p = provider({ idleMs: 15, fetchImpl: async () => response([done], { hang: true, cancel: () => { cancelled = true; } }) });
  await p.streamChat(request()); assert.equal(cancelled, true);
});

test('abort from a delta stops subsequent records in the same chunk', async () => {
  const controller = new AbortController(); const deltas = [];
  const p = provider({ fetchImpl: async () => response([line('first') + line('second') + done]) });
  await assert.rejects(p.streamChat(request({ signal: controller.signal, onDelta(delta) { deltas.push(delta); controller.abort(); } })), { code: 'ABORTED' });
  assert.deepEqual(deltas, [{ content: 'first', thinking: '' }]);
});

test('total deadline remains fixed while incoming data refreshes the idle deadline', async () => {
  let interval;
  const p = provider({ idleMs: 100, totalMs: 35, fetchImpl: async () => ({ status: 200, body: new ReadableStream({
    start(controller) { interval = setInterval(() => controller.enqueue(encoder.encode(line('x'))), 5); },
    cancel() { clearInterval(interval); },
  }) }) });
  try { await assert.rejects(p.streamChat(request()), { code: 'TOTAL_TIMEOUT' }); }
  finally { clearInterval(interval); }
});

test('throwing delta consumer rejects and releases the response stream', async () => {
  let cancelled = false;
  const p = provider({ fetchImpl: async () => response([line('first')], { hang: true, cancel: () => { cancelled = true; } }) });
  await assert.rejects(p.streamChat(request({ onDelta() { throw new Error('consumer closed'); } })), /consumer closed/);
  assert.equal(cancelled, true);
});

test('rejects tool or credential-bearing request structures before transmission', async () => {
  let called = false;
  const p = provider({ fetchImpl: async () => { called = true; return response([done]); } });
  for (const messages of [[{ role: 'tool', content: 'x' }], [{ role: 'user', content: 'x', images: ['secret'] }], [{ role: 'user', content: null }]]) {
    await assert.rejects(p.streamChat(request({ messages })), { code: 'INVALID_REQUEST' });
  }
  assert.equal(called, false);
});
