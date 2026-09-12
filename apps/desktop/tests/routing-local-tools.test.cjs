const { test } = require('node:test');
const assert = require('node:assert/strict');
const { streamHostedRouting } = require('../../../packages/providers/hosted-routing.cjs');
let streamLocalChat;
try { ({ streamLocalChat } = require('../../../packages/providers/local-chat.cjs')); } catch (e) { if (e.code !== 'MODULE_NOT_FOUND') throw e; }
const localTools = [{ name: 'zq_document_create', description: 'Create a document', parameters: { type: 'object', properties: { title: { type: 'string' } }, required: ['title'], additionalProperties: false } }];
const frame = p => `data: ${typeof p === 'string' ? p : JSON.stringify(p)}\n\n`;
const chat = (delta, finish_reason = null, extra = {}) => frame({ choices: [{ index: 0, delta, finish_reason }], ...extra });
const call = (args = '{"title":"Draft"}', id = 'call_1') => ({ index: 0, id, type: 'function', function: { name: 'zq_document_create', arguments: args } });
const xcall = (args = '{"title":"Draft"}') => ({ type: 'function_call', id: 'fc_1', call_id: 'call_1', name: 'zq_document_create', arguments: args, status: 'completed' });
const xdone = output => frame({ type: 'response.completed', response: { status: 'completed', output } });
const final = provider => provider === 'xai' ? xdone([{ type: 'message', content: [{ type: 'output_text', text: 'Created.', annotations: [] }] }]) : chat({ content: 'Created.' }, 'stop') + frame('[DONE]');
function run(provider, wires, extra = {}) {
  const bodies = [], executed = [], deltas = [], sources = [], usage = [];
  const adapter = ['xai', 'openrouter'].includes(provider) ? streamHostedRouting : streamLocalChat;
  const promise = (async () => {
    assert.equal(typeof adapter, 'function', 'local chat adapter must exist');
    return adapter(provider, { apiKey: 'fixture-key', fetchImpl: async (url, init) => {
      bodies.push({ url, body: JSON.parse(init.body) });
      assert.ok(wires.length, 'bounded continuation must not make an unexpected request');
      const wire = wires.shift();
      return new Response(new ReadableStream({ start(c) { const bytes = new TextEncoder().encode(wire); for (let i = 0; i < bytes.length; i += 13) c.enqueue(bytes.slice(i, i + 13)); c.close(); } }));
    } }, { baseUrl: provider === 'vllm' ? 'http://localhost:8000/v1' : undefined, model: provider === 'xai' ? 'grok-4.6' : 'fixture-model', messages: [{ role: 'user', content: 'Create a draft.' }], tools: [], localTools, onLocalTool: async c => { executed.push(c); return { documentId: 'doc_1' }; }, onDelta: d => deltas.push(d), onSources: s => sources.push(s), onUsage: u => usage.push(u), ...extra });
  })();
  return { promise, bodies, executed, deltas, sources, usage };
}
test('xAI local-only continuation preserves complete output including encrypted reasoning and call IDs', async () => {
  const output = [{ type: 'reasoning', id: 'r_1', encrypted_content: 'opaque', summary: [] }, xcall()];
  const r = run('xai', [frame({ type: 'response.output_item.added', output_index: 1, item: { ...xcall(''), status: 'in_progress' } }) + frame({ type: 'response.function_call_arguments.delta', item_id: 'fc_1', output_index: 1, delta: '{"title":' }) + frame({ type: 'response.function_call_arguments.delta', item_id: 'fc_1', output_index: 1, delta: '"Draft"}' }) + xdone(output), final('xai')]);
  assert.equal(await r.promise, 'Created.'); assert.equal(r.executed.length, 1);
  assert.deepEqual(r.bodies[1].body.input.slice(1, 3), output);
  assert.deepEqual(r.bodies[1].body.input[3], { type: 'function_call_output', call_id: 'call_1', output: '{"documentId":"doc_1"}' });
  assert.ok(r.bodies[0].body.include.includes('reasoning.encrypted_content'));
  assert.equal(r.bodies[0].body.tools[0].type, 'function');
});
for (const provider of ['openrouter', 'vllm', 'groq', 'openai']) test(`${provider} assembles streamed arguments and returns matching tool results`, async () => {
  const r = run(provider, [chat({ tool_calls: [call('{"title":')] }) + chat({ tool_calls: [{ index: 0, function: { arguments: '"Draft"}' } }] }, 'tool_calls') + frame('[DONE]'), final(provider)]);
  assert.equal(await r.promise, 'Created.'); assert.equal(r.executed.length, 1);
  assert.deepEqual(r.bodies[1].body.messages.slice(-2), [{ role: 'assistant', content: null, tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'zq_document_create', arguments: '{"title":"Draft"}' } }] }, { role: 'tool', tool_call_id: 'call_1', content: '{"documentId":"doc_1"}' }]);
  assert.deepEqual(r.bodies[0].body.tools.map(t => t.type), ['function']);
});
test('OpenRouter combines opted-in server search with local tools and preserves reasoning details and sources', async () => {
  const details = [{ type: 'reasoning.encrypted', id: 'reason_1', data: 'opaque', index: 0, format: 'anthropic-claude-v1' }];
  const r = run('openrouter', [chat({ reasoning_details: details, tool_calls: [call()], annotations: [{ type: 'url_citation', url_citation: { url: 'https://example.com/research', title: 'Research' } }] }, 'tool_calls', { usage: { prompt_tokens: 10, completion_tokens: 2, server_tool_use: { web_search_requests: 1 } } }) + frame('[DONE]'), chat({ content: 'Created.' }, 'stop', { usage: { prompt_tokens: 12, completion_tokens: 3 } }) + frame('[DONE]')], { tools: ['web_search'] });
  assert.match(await r.promise, /Sources:/); assert.deepEqual(r.bodies[0].body.tools.map(t => t.type), ['openrouter:web_search', 'function']);
  assert.deepEqual(r.bodies[1].body.messages.at(-2).reasoning_details, details);
  assert.equal(r.bodies[1].body.messages.at(-2).annotations[0].url_citation.url, 'https://example.com/research');
  assert.deepEqual(r.usage.at(-1), { inputTokens: 22, outputTokens: 5 }); assert.ok(r.sources.length);
});
for (const provider of ['xai', 'openrouter', 'vllm']) test(`${provider} never executes truncated, malformed, or canceled tool calls`, async () => {
  const bad = provider === 'xai' ? [frame({ type: 'response.output_item.added', output_index: 0, item: xcall() }), xdone([xcall('{"title":')]), frame({ type: 'response.incomplete' })] : [chat({ tool_calls: [call()] }, 'tool_calls'), chat({ tool_calls: [call('{"title":')] }, 'tool_calls') + frame('[DONE]'), chat({ tool_calls: [call()] }, 'length') + frame('[DONE]'), chat({ tool_calls: [call()] }, 'stop') + frame('[DONE]')];
  for (const wire of bad) { const r = run(provider, [wire]); await assert.rejects(r.promise); assert.equal(r.executed.length, 0); assert.equal(r.bodies.length, 1); }
  const controller = new AbortController(); const r = run(provider, [provider === 'xai' ? frame({ type: 'response.output_text.delta', delta: 'Preparing' }) + xdone([xcall()]) : chat({ content: 'Preparing', tool_calls: [call()] }, 'tool_calls') + frame('[DONE]')], { signal: controller.signal, onDelta: () => controller.abort() });
  await assert.rejects(r.promise, { code: 'ABORTED' }); assert.equal(r.executed.length, 0);
});
test('chat rejects a malformed second function before executing any call in its response', async () => {
  const r = run('vllm', [chat({ tool_calls: [call(), { ...call('{bad', 'call_2'), index: 1 }] }, 'tool_calls') + frame('[DONE]')]);
  await assert.rejects(r.promise); assert.equal(r.executed.length, 0);
});
for (const provider of ['xai', 'openrouter', 'vllm']) test(`${provider} reuses a duplicate call result and bounds repeated continuations`, async () => {
  const wire = provider === 'xai' ? xdone([xcall()]) : chat({ tool_calls: [call()] }, 'tool_calls') + frame('[DONE]');
  const r = run(provider, [wire, wire, final(provider)]);
  await r.promise; assert.equal(r.executed.length, 1); assert.equal(r.bodies.length, 3);
  const repeated = run(provider, Array(13).fill(wire));
  await assert.rejects(repeated.promise, { code: 'RESPONSE_LIMIT' }); assert.equal(repeated.executed.length, 1); assert.equal(repeated.bodies.length, 13);
});
test('xAI rejects a completed function that changes arguments from its done item', async () => {
  const r = run('xai', [frame({ type: 'response.output_item.done', item: xcall() }) + xdone([xcall('{"title":"Changed"}')])]);
  await assert.rejects(r.promise); assert.equal(r.executed.length, 0);
});
test('OpenRouter decreases the server search budget across local continuations', async () => {
  const r = run('openrouter', [chat({ tool_calls: [call()] }, 'tool_calls', { usage: { server_tool_use: { web_search_requests: 1 } } }) + frame('[DONE]'), final('openrouter')], { tools: ['web_search'] });
  await r.promise;
  assert.equal(r.bodies[1].body.max_tool_calls, 1); assert.equal(r.bodies[1].body.tools[0].parameters.max_uses, 1);
});
test('OpenRouter removes exhausted server search while retaining local tools', async () => {
  const r = run('openrouter', [chat({ tool_calls: [call()] }, 'tool_calls', { usage: { server_tool_use: { web_search_requests: 2 } } }) + frame('[DONE]'), final('openrouter')], { tools: ['web_search'] });
  await r.promise; assert.deepEqual(r.bodies[1].body.tools.map(t => t.type), ['function']);
});
test('xAI rejects malformed item identities and repeated done items before execution', async () => {
  const { id, ...withoutId } = xcall();
  for (const wire of [xdone([withoutId]), frame({ type: 'response.output_item.done', item: xcall() }) + frame({ type: 'response.output_item.done', item: xcall('{"title":"Changed"}') }) + xdone([xcall('{"title":"Changed"}')])]) {
    const r = run('xai', [wire]); await assert.rejects(r.promise); assert.equal(r.executed.length, 0);
  }
});
