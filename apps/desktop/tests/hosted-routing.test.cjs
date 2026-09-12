const { test } = require('node:test');
const assert = require('node:assert/strict');
let routing;
try { routing = require('../../../packages/providers/hosted-routing.cjs'); } catch (error) { if (error.code !== 'MODULE_NOT_FOUND') throw error; }
const key = 'fixture-secret';
const frame = value => `data: ${typeof value === 'string' ? value : JSON.stringify(value)}\n\n`;
const response = wire => new Response(new ReadableStream({ start(c) { const bytes = new TextEncoder().encode(wire); for (let i = 0; i < bytes.length; i += 17) c.enqueue(bytes.slice(i, i + 17)); c.close(); } }));
const xdone = output => frame({ type: 'response.completed', response: { status: 'completed', output } });
const chat = (delta, finish_reason = null) => frame({ choices: [{ index: 0, delta, finish_reason }] });
function run(provider, wire, extra = {}, options = {}) {
  assert.equal(typeof routing?.streamHostedRouting, 'function', 'hosted routing adapter must exist');
  const deltas = [], tools = [], calls = [];
  const promise = routing.streamHostedRouting(provider, { apiKey: key, fetchImpl: async (url, init) => { calls.push({ url, ...init }); return response(wire); }, ...options }, { model: provider === 'xai' ? 'grok-4.6' : 'google/gemini-3-flash-preview', messages: [{ role: 'user', content: 'Research.' }], tools: ['web_search'], onDelta: d => deltas.push(d), onTool: t => tools.push(t), ...extra });
  return { promise, deltas, tools, calls };
}
test('xAI hosted search uses stateless Responses and preserves observed tool status and citations', async () => {
  const item = { id: 'ws_1', type: 'web_search_call', status: 'completed', action: { type: 'search', query: 'release' } };
  const r = run('xai', frame({ type: 'response.output_item.added', item: { ...item, status: 'in_progress' } }) + frame({ type: 'response.output_text.delta', delta: 'Found.' }) + frame({ type: 'response.output_item.done', item }) + xdone([item, { type: 'message', content: [{ type: 'output_text', text: 'Found.', annotations: [{ type: 'url_citation', url: 'https://example.com/release' }] }] }]));
  const result = await r.promise;
  assert.equal(r.calls[0].url, 'https://api.x.ai/v1/responses');
  const body = JSON.parse(r.calls[0].body);
  assert.equal(body.store, false); assert.equal(body.previous_response_id, undefined);
  assert.deepEqual(body.tools, [{ type: 'web_search' }]);
  assert.equal(body.parallel_tool_calls, false);
  assert.deepEqual(r.tools.map(t => t.status), ['running', 'complete']);
  assert.match(result, /example.com\/release/);
  assert.ok(r.deltas.every(d => typeof d.content === 'string' && typeof d.thinking === 'string'));
});
test('OpenRouter uses bounded Exa server search and reads citations after stop until DONE', async () => {
  const r = run('openrouter', chat({ content: 'Answer' }, 'stop') + frame({ choices: [{ index: 0, delta: { annotations: [{ type: 'url_citation', url_citation: { url: 'https://example.com/a(b)', title: '[unsafe title]' } }] }, finish_reason: null }], usage: { server_tool_use: { web_search_requests: 2 } } }) + frame('[DONE]'));
  assert.match(await r.promise, /https:\/\/example.com\/a%28b%29/);
  const body = JSON.parse(r.calls[0].body);
  assert.equal(r.calls[0].url, 'https://openrouter.ai/api/v1/chat/completions');
  assert.equal(body.max_tool_calls, 2); assert.equal(body.tools[0].type, 'openrouter:web_search');
  assert.equal(body.tools[0].parameters.engine, 'exa'); assert.equal(body.tools[0].parameters.max_uses, 2);
  assert.equal(r.tools.at(-1).status, 'complete');
});
test('unsafe citations are discarded and duplicates do not inflate source list', async () => {
  const annotations = ['javascript:alert(1)', 'https://user:pass@example.com', 'https://example.com/ok', 'https://example.com/ok'].map(url => ({ type: 'url_citation', url }));
  const r = run('xai', xdone([{ type: 'message', content: [{ type: 'output_text', text: 'Answer', annotations }] }]));
  const text = await r.promise;
  assert.match(text, /^Answer/); assert.equal(text.includes('javascript'), false); assert.equal(text.includes('pass'), false);
  assert.equal(text.match(/https:\/\/example.com\/ok/g).length, 1);
});
test('unexpected function requests, terminal-only function calls, and incomplete streams fail', async () => {
  for (const wire of [frame({ type: 'response.output_item.added', item: { type: 'function_call', id: 'f', name: 'write_file' } }), xdone([{ type: 'function_call', id: 'f' }])]) await assert.rejects(run('xai', wire).promise, { code: 'UNSUPPORTED_OUTPUT' });
  await assert.rejects(run('openrouter', chat({ tool_calls: [] })).promise, { code: 'UNSUPPORTED_OUTPUT' });
  await assert.rejects(run('openrouter', chat({}, 'stop')).promise, { code: 'EARLY_EOF' });
  await assert.rejects(run('xai', frame({ type: 'response.output_text.delta', delta: 'unfinished' })).promise, { code: 'EARLY_EOF' });
});
test('unsupported providers, models, tools, and credential destinations never fetch', async () => {
  for (const [provider, extra, code] of [['xai', { baseUrl: 'https://attacker.example' }, 'INVALID_ENDPOINT'], ['xai', { model: 'grok-3' }, 'UNSUPPORTED_TOOL'], ['xai', { tools: ['code_execution'] }, 'UNSUPPORTED_TOOL'], ['openrouter', { tools: ['x_search'] }, 'UNSUPPORTED_TOOL'], ['perplexity', {}, 'UNSUPPORTED_TOOL']]) {
    const r = run(provider, '', extra); await assert.rejects(r.promise, { code }); assert.equal(r.calls.length, 0);
  }
});
test('tool observation bound, malformed completion, and provider errors fail without secret detail', async () => {
  const tooMany = Array.from({ length: 9 }, (_, i) => frame({ type: 'response.output_item.added', item: { id: 's' + i, type: 'web_search_call', status: 'in_progress' } })).join('');
  await assert.rejects(run('xai', tooMany).promise, { code: 'RESPONSE_LIMIT' });
  await assert.rejects(run('xai', frame({ type: 'response.completed', response: { status: 'in_progress' } })).promise, { code: 'INVALID_RESPONSE' });
  await assert.rejects(run('xai', frame({ error: { message: key } })).promise, e => e.code === 'PROVIDER_ERROR' && !e.message.includes(key));
});
test('aborted requests and transport redirects remain bounded and rejected', async () => {
  const c = new AbortController(); c.abort();
  await assert.rejects(run('xai', '', { signal: c.signal }).promise, { code: 'ABORTED' });
  await assert.rejects(run('xai', '', {}, { fetchImpl: async () => new Response('', { status: 307 }) }).promise, { code: 'REDIRECT' });
});
test('xAI leaves unresolved calls running until the host settles them, including incomplete done items', async () => {
  const started = { id: 'ws_pending', type: 'web_search_call', status: 'in_progress' };
  for (const tail of [xdone([]), frame({ type: 'response.output_item.done', item: started }) + xdone([started]), xdone([{ id: started.id, type: started.type }])]) {
    const r = run('xai', frame({ type: 'response.output_item.added', item: started }) + tail);
    await r.promise;
    assert.deepEqual(r.tools.map(t => t.status), ['running']);
  }
  const r = run('xai', frame({ type: 'response.output_item.added', item: started }) + xdone([{ ...started, status: 'failed' }]));
  await r.promise;
  assert.deepEqual(r.tools.map(t => t.status), ['running', 'error']);
});
test('xAI activity detail is valid UTF-8 within the host byte limit and contains no NUL', async () => {
  for (const query of ['研'.repeat(1400), 'a'.repeat(3999) + '😀', 'release\0notes', '\ud800' + '😀'.repeat(1200)]) {
    const item = { id: 'ws_unicode', type: 'web_search_call', status: 'completed', action: { query } };
    const r = run('xai', xdone([item]));
    await r.promise;
    const detail = r.tools[0].detail;
    assert.ok(Buffer.byteLength(detail) <= 4000);
    assert.equal(Buffer.from(detail).toString('utf8'), detail);
    assert.equal(detail.includes('\0'), false);
  }
});
