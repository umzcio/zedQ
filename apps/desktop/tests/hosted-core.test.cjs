const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createTransport } = require('../../../packages/providers/transport.cjs');
const { recordActivity, recordArtifact } = require('../electron/chat-tools.cjs');
let streamHostedCore;
try { ({ streamHostedCore } = require('../../../packages/providers/hosted-core.cjs')); } catch (error) { if (error.code !== 'MODULE_NOT_FOUND') throw error; }
const bases = { openai: 'https://api.openai.com/v1', anthropic: 'https://api.anthropic.com/v1', google: 'https://generativelanguage.googleapis.com/v1beta' };
const key = 'fixture-secret';
const png = Buffer.from('iVBORw0KGgo=', 'base64');
function response(parts, status = 200) { return { status, body: new ReadableStream({ start(c) { for (const p of parts) c.enqueue(typeof p === 'string' ? Buffer.from(p) : p); c.close(); } }) }; }
const event = data => `data: ${JSON.stringify(data)}\n\n`;
const events = (...data) => response([data.map(event).join('')]);
const odone = output => ({ type: 'response.completed', response: { status: 'completed', output } });
const astop = reason => [{ type: 'message_delta', delta: { stop_reason: reason }, usage: { output_tokens: 10 } }, { type: 'message_stop' }];
function run(provider, fetchImpl, extra = {}) {
  assert.equal(typeof streamHostedCore, 'function', 'hosted execution is implemented');
  return streamHostedCore(provider, { apiKey: key, fetchImpl }, { baseUrl: bases[provider], model: provider === 'google' ? 'gemini-2.5-pro' : 'fixture-model', messages: [{ role: 'user', content: 'Analyze' }], tools: ['code_execution'], onDelta() {}, onTool() {}, onArtifact: async () => {}, ...extra });
}

test('binary transport preserves non-UTF8 bytes with the usual redirect and byte limits', async () => {
  const received = [];
  await createTransport({ fetchImpl: async (_url, opts) => { assert.equal(opts.redirect, 'manual'); return response([png, Uint8Array.of(255)]); } })('https://api.openai.com/v1/files/example/content', { onBytes: chunk => received.push(Buffer.from(chunk)), maxBytes: 9 });
  assert.deepEqual(Buffer.concat(received), Buffer.concat([png, Buffer.from([255])]));
  await assert.rejects(createTransport({ fetchImpl: async () => response([png]) })('https://api.openai.com/v1/files/example/content', { onBytes() {}, maxBytes: 7 }), { code: 'RESPONSE_LIMIT' });
});

test('OpenAI hosted search emits actual activity and clickable inline citations without duplicate final text', async () => {
  const deltas = [], activity = []; let payload;
  const annotation = { type: 'url_citation', start_index: 0, end_index: 6, url: 'https://example.com/news', title: 'News' };
  const message = { type: 'message', id: 'm1', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'Result', annotations: [annotation] }] };
  await run('openai', async (url, options) => { assert.equal(url, bases.openai + '/responses'); payload = JSON.parse(options.body); return events(
    { type: 'response.output_item.added', output_index: 0, item: { type: 'web_search_call', id: 'ws1', status: 'in_progress' } },
    { type: 'response.web_search_call.searching', item_id: 'ws1', output_index: 0 },
    { type: 'response.output_text.delta', item_id: 'm1', output_index: 1, content_index: 0, delta: 'Result' },
    { type: 'response.output_item.done', output_index: 0, item: { type: 'web_search_call', id: 'ws1', status: 'completed', action: { type: 'search', query: 'news' } } },
    { type: 'response.output_item.done', output_index: 1, item: message }, odone([message])); },
    { tools: ['web_search'], onDelta: d => deltas.push(d), onTool: a => activity.push(a) });
  assert.deepEqual(payload.tools, [{ type: 'web_search' }]); assert.equal(payload.store, false);
  assert.equal(deltas.map(d => d.content).join(''), 'Result [1](<https://example.com/news>)');
  assert.ok(activity.some(a => a.id === 'ws1' && a.status === 'running')); assert.equal(activity.at(-1).status, 'complete');
});

test('OpenAI downloads only current response container files, awaits artifact storage and removes sandbox links', async () => {
  const urls = [], artifacts = [], deltas = []; let stored = false;
  await run('openai', async (url, options) => { urls.push(url); assert.equal(options.headers.Authorization, `Bearer ${key}`);
    if (urls.length === 1) { const body = JSON.parse(options.body); assert.deepEqual(body.tools, [{ type: 'code_interpreter', container: { type: 'auto' } }]); return events(odone([
      { type: 'code_interpreter_call', id: 'ci1', status: 'completed', container_id: 'cntr_1', code: 'print(2)', outputs: [] },
      { type: 'message', id: 'm1', role: 'assistant', content: [{ type: 'output_text', text: '[Chart](sandbox:/mnt/data/chart.png)', annotations: [{ type: 'container_file_citation', container_id: 'cntr_1', file_id: 'cfile_1', filename: 'chart.png', start_index: 0, end_index: 33 }] }] }
    ])); }
    assert.equal(url, bases.openai + '/containers/cntr_1/files/cfile_1/content'); return response([png]);
  }, { onArtifact: async a => { await new Promise(setImmediate); artifacts.push(a); stored = true; }, onDelta: d => deltas.push(d) });
  assert.equal(stored, true); assert.equal(artifacts[0].data, png.toString('base64')); assert.equal(artifacts[0].name, 'chart.png');
  assert.ok(!deltas.map(d => d.content).join('').includes('sandbox:')); assert.equal(urls.length, 2);
});

test('Anthropic pause continuation preserves all native blocks and container while starting each send fresh', async () => {
  const bodies = [], activity = [], deltas = [];
  const blocks = [{ type: 'thinking', thinking: 'Reason', signature: 'signed' }, { type: 'server_tool_use', id: 'srv1', name: 'web_search', input: { query: 'news' } }];
  await run('anthropic', async (_url, options) => { bodies.push(JSON.parse(options.body)); return bodies.length === 1 ? events(
    { type: 'message_start', message: { content: [], container: { id: 'container_1' } } },
    { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '', signature: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'Reason' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'signed' } }, { type: 'content_block_stop', index: 0 },
    { type: 'content_block_start', index: 1, content_block: { type: 'server_tool_use', id: 'srv1', name: 'web_search', input: {} } },
    { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"query":' } },
    { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '"news"}' } }, { type: 'content_block_stop', index: 1 }, ...astop('pause_turn')
  ) : events(
    { type: 'content_block_start', index: 0, content_block: { type: 'web_search_tool_result', tool_use_id: 'srv1', content: [{ type: 'web_search_result', url: 'https://example.com' }] } }, { type: 'content_block_stop', index: 0 },
    { type: 'content_block_start', index: 1, content_block: { type: 'text', text: 'Answer', citations: [{ type: 'web_search_result_location', url: 'https://example.com', encrypted_index: 'opaque' }] } }, { type: 'content_block_stop', index: 1 }, ...astop('end_turn'));
  }, { tools: ['web_search'], onTool: a => activity.push(a), onDelta: d => deltas.push(d) });
  assert.equal(bodies[0].container, undefined); assert.equal(bodies[1].container, 'container_1'); assert.deepEqual(bodies[1].messages.at(-1), { role: 'assistant', content: blocks });
  assert.deepEqual(bodies[1].tools, bodies[0].tools); assert.equal(activity.at(-1).status, 'complete'); assert.ok(deltas.map(d => d.content).join('').includes('https://example.com/'));
});

test('Anthropic hosted code retrieves generated file metadata and bytes without obsolete beta header', async () => {
  const artifacts = [], urls = [];
  await run('anthropic', async (url, options) => { urls.push(url); assert.equal(options.headers['anthropic-beta'], undefined);
    if (urls.length === 1) return events({ type: 'content_block_start', index: 0, content_block: { type: 'server_tool_use', id: 'srv1', name: 'bash_code_execution', input: { command: 'make chart' } } }, { type: 'content_block_stop', index: 0 },
      { type: 'content_block_start', index: 1, content_block: { type: 'bash_code_execution_tool_result', tool_use_id: 'srv1', content: { type: 'bash_code_execution_result', stdout: '', stderr: '', return_code: 0, content: [{ type: 'bash_code_execution_output', file_id: 'file_1' }] } } }, { type: 'content_block_stop', index: 1 }, ...astop('end_turn'));
    if (urls.length === 2) return response([JSON.stringify({ id: 'file_1', filename: 'plot.png', mime_type: 'image/png', downloadable: true, size_bytes: png.length })]);
    return response([png]);
  }, { onArtifact: async a => artifacts.push(a) });
  assert.deepEqual(urls.slice(1), [bases.anthropic + '/files/file_1', bases.anthropic + '/files/file_1/content']); assert.equal(artifacts[0].name, 'plot.png');
});

test('Gemini hosted Python executes server-side and persists inlineData without a client tool roundtrip', async () => {
  const activity = [], artifacts = [], deltas = []; let calls = 0;
  await run('google', async (url, options) => { calls++; assert.ok(url.endsWith(':streamGenerateContent?alt=sse')); assert.deepEqual(JSON.parse(options.body).tools, [{ codeExecution: {} }]); return events(
    { candidates: [{ index: 0, content: { role: 'model', parts: [{ executableCode: { language: 'PYTHON', code: 'print(4)' } }] } }] },
    { candidates: [{ index: 0, content: { role: 'model', parts: [{ codeExecutionResult: { outcome: 'OUTCOME_OK', output: '4' } }, { inlineData: { mimeType: 'image/png', data: png.toString('base64') } }, { text: 'Four' }, { text: '', thoughtSignature: 'opaque' }] }, finishReason: 'STOP' }] });
  }, { onTool: a => activity.push(a), onArtifact: async a => artifacts.push(a), onDelta: d => deltas.push(d) });
  assert.equal(calls, 1); assert.ok(activity.some(a => a.status === 'running')); assert.equal(activity.at(-1).status, 'complete'); assert.equal(artifacts.length, 1); assert.equal(deltas.map(d => d.content).join(''), 'Four');
});

test('hosted tools reject client function requests, unsupported Google Search and unpinned endpoints', async () => {
  for (const [p, ev] of [['openai', { type: 'response.output_item.added', item: { type: 'function_call', id: 'fc1', name: 'shell', arguments: '{}' } }], ['anthropic', { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 't1', name: 'shell', input: {} } }], ['google', { candidates: [{ index: 0, content: { parts: [{ functionCall: { name: 'shell', args: {} } }] } }] }]]) await assert.rejects(run(p, async () => events(ev)), { code: 'UNSUPPORTED_OUTPUT' });
  const neverFetch = async () => assert.fail('invalid requests must not send credentials');
  await assert.rejects(run('google', neverFetch, { tools: ['web_search'] }), { code: 'UNSUPPORTED_TOOL' });
  await assert.rejects(run('openai', neverFetch, { baseUrl: 'https://attacker.example/v1' }), { code: 'INVALID_ENDPOINT' });
});

test('Anthropic tool errors remain visible and pause loops are bounded', async () => {
  const activity = [];
  await run('anthropic', async () => events({ type: 'content_block_start', index: 0, content_block: { type: 'server_tool_use', id: 'srv1', name: 'web_search', input: {} } }, { type: 'content_block_stop', index: 0 },
    { type: 'content_block_start', index: 1, content_block: { type: 'web_search_tool_result', tool_use_id: 'srv1', content: { type: 'web_search_tool_result_error', error_code: 'max_uses_exceeded' } } }, { type: 'content_block_stop', index: 1 }, ...astop('end_turn')), { tools: ['web_search'], onTool: a => activity.push(a) });
  assert.equal(activity.at(-1).status, 'error');
  let calls = 0; await assert.rejects(run('anthropic', async () => { calls++; return events({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: 'Still going' } }, { type: 'content_block_stop', index: 0 }, ...astop('pause_turn')); }), { code: 'TOOL_LIMIT' }); assert.equal(calls, 5);
});

test('hosted artifacts reject malicious IDs, oversized files and redirects without leaking the key', async () => {
  const item = file_id => ({ type: 'message', id: 'm1', content: [{ type: 'output_text', text: 'File', annotations: [{ type: 'container_file_citation', container_id: 'cntr_1', file_id, filename: 'data.bin' }] }] });
  let calls = 0; const activity = [];
  await run('openai', async () => { calls++; return events(odone([item('../secret')])); }, { onTool: a => activity.push(a) }); assert.equal(calls, 1); assert.equal(activity.at(-1).status, 'error');
  for (const resp of [response([new Uint8Array(4 * 1024 * 1024 + 1)]), response([key], 302)]) {
    calls = 0; const out = [];
    await run('openai', async () => ++calls === 1 ? events(odone([item('cfile_1')])) : resp, { onTool: a => out.push(a), onArtifact: async () => assert.fail('failed download must not create artifact') });
    assert.equal(out.at(-1).status, 'error'); assert.ok(!JSON.stringify(out).includes(key));
  }
});

test('hosted streams require a terminal completion and cancellation prevents continuation or downloads', async () => {
  await assert.rejects(run('openai', async () => events({ type: 'response.output_text.delta', output_index: 0, delta: 'Partial' })), { code: 'EARLY_EOF' });
  const controller = new AbortController(); let calls = 0;
  await assert.rejects(run('anthropic', async () => { calls++; return events({ type: 'content_block_start', index: 0, content_block: { type: 'server_tool_use', id: 's1', name: 'web_search', input: {} } }, ...astop('pause_turn')); }, { tools: ['web_search'], signal: controller.signal, onTool() { controller.abort(); } }), { code: 'ABORTED' }); assert.equal(calls, 1);
});

test('Anthropic refuses a terminal event with an unfinished block and duplicate block stops', async () => {
  for (const chunks of [
    [{ type: 'content_block_start', index: 0, content_block: { type: 'text', text: 'Partial' } }, ...astop('end_turn')],
    [{ type: 'content_block_start', index: 0, content_block: { type: 'text', text: 'Once' } }, { type: 'content_block_stop', index: 0 }, { type: 'content_block_stop', index: 0 }, ...astop('end_turn')]
  ]) await assert.rejects(run('anthropic', async () => events(...chunks)), { code: 'INVALID_RESPONSE' });
});

test('OpenAI retains repeated source associations and a completed tool is not downgraded by late detail', async () => {
  const activity = [], deltas = [];
  await run('openai', async () => events(
    { type: 'response.output_item.done', item: { type: 'code_interpreter_call', id: 'ci1', status: 'completed', code: 'print(2)' } },
    { type: 'response.code_interpreter_call_code.done', item_id: 'ci1', code: 'print(2)' },
    odone([{ type: 'message', id: 'm1', content: [{ type: 'output_text', text: 'One. Two.', annotations: [{ type: 'url_citation', url: 'https://example.com', end_index: 4 }, { type: 'url_citation', url: 'https://example.com', end_index: 9 }] }] }])
  ), { tools: ['code_execution', 'web_search'], onTool: a => activity.push(a), onDelta: d => deltas.push(d) });
  assert.equal(activity.at(-1).status, 'complete');
  assert.equal(deltas.map(d => d.content).join(''), 'One. [1](<https://example.com/>) Two. [1](<https://example.com/>)');
});

test('onReplace preserves live text deltas and finalizes a single fully cited answer', async () => {
  const seen = [], replaced = []; let sawTextBeforeTerminal = false;
  const first = event({ type: 'response.output_text.delta', item_id: 'm1', output_index: 0, delta: 'Live answer' });
  const last = event(odone([{ type: 'message', id: 'm1', content: [{ type: 'output_text', text: 'Live answer', annotations: [{ type: 'url_citation', url: 'https://example.com', end_index: 11 }] }] }]));
  let pulls = 0;
  await run('openai', async () => ({ status: 200, body: new ReadableStream({ pull(c) { if (!pulls++) c.enqueue(Buffer.from(first)); else { sawTextBeforeTerminal = seen.join('') === 'Live answer'; c.enqueue(Buffer.from(last)); c.close(); } } }, { highWaterMark: 0 }) }), {
    tools: ['web_search'], onDelta: d => seen.push(d.content), onReplace: value => replaced.push(value)
  });
  assert.equal(sawTextBeforeTerminal, true); assert.deepEqual(seen, ['Live answer']); assert.deepEqual(replaced, ['Live answer [1](<https://example.com/>)']);
});

test('hosted activity detail is bounded by UTF8 bytes and contains no NUL', async () => {
  const out = []; await run('openai', async () => events(odone([{ type: 'code_interpreter_call', id: 'ci1', status: 'completed', code: '\0' + '🌍'.repeat(2000) }])), { onTool: a => out.push(a) });
  assert.ok(Buffer.byteLength(out[0].detail) <= 4000); assert.ok(!out[0].detail.includes('\0'));
});

test('hosted Unicode detail survives native activity validation at the byte boundary', async () => {
  for (const code of ['a'.repeat(3997) + '🌍b', '\ud800\0safe']) {
    const reply = {};
    await run('openai', async () => events(odone([{ type: 'code_interpreter_call', id: 'ci1', status: 'completed', code }])), { onTool: event => recordActivity(reply, event, ['code_execution']) });
    assert.ok(reply.toolActivity[0].detail.endsWith(code.startsWith('a') ? 'a' : 'safe'));
    assert.equal(Buffer.from(reply.toolActivity[0].detail).toString(), reply.toolActivity[0].detail);
  }
});

test('hosted file names survive native artifact validation with long Unicode and invalid input', async () => {
  const reply = {}; let calls = 0;
  await run('openai', async () => ++calls === 1 ? events(odone([{ type: 'message', id: 'm1', content: [{ type: 'output_text', text: 'File', annotations: [{ type: 'container_file_citation', container_id: 'cntr_1', file_id: 'cfile_1', filename: '🌍'.repeat(100) + '\ud800.png' }] }] }])) : response([png]), { onArtifact: async file => recordArtifact(reply, file, ['code_execution']) });
  assert.equal(reply.generatedFiles.length, 1); assert.ok(Buffer.byteLength(reply.generatedFiles[0].name) <= 256);
});

test('core stops excessive activity before native storage rejects its forty-first event', async () => {
  const reply = {}, items = Array.from({ length: 41 }, (_, i) => ({ type: 'code_interpreter_call', id: `ci${i}`, status: 'completed', code: 'print(1)' }));
  await assert.rejects(run('openai', async () => events(odone(items)), { onTool: event => recordActivity(reply, event, ['code_execution']) }), { code: 'TOOL_LIMIT' });
  assert.equal(reply.toolActivity.length, 40);
});

test('core rejects an eleventh generated file before requesting downloads or native storage', async () => {
  let downloads = 0;
  await assert.rejects(run('openai', async () => {
    downloads++;
    return events(odone([{ type: 'message', id: 'm1', content: [{ type: 'output_text', text: 'Files', annotations: Array.from({ length: 11 }, (_, i) => ({ type: 'container_file_citation', container_id: 'cntr_1', file_id: `cfile_${i}`, filename: `plot${i}.png` })) }] }]));
  }, { onArtifact: async () => assert.fail('no excess batch should be stored') }), { code: 'TOOL_LIMIT' });
  assert.equal(downloads, 1);
});
