const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createOllamaProvider } = require('../../../packages/providers/ollama.cjs');

const endpoint = 'http://127.0.0.1:11434';
const encoder = new TextEncoder();
const localTools = [{ name: 'create_document', description: 'Create a document', parameters: { type: 'object', properties: { content: { type: 'string' } }, required: ['content'] } }];
const call = (content = 'Hello') => ({ function: { index: 0, name: 'create_document', arguments: { content } } });
const line = (message, extra = {}) => JSON.stringify({ message: { role: 'assistant', ...message }, done: false, ...extra }) + '\n';
const done = JSON.stringify({ done: true, done_reason: 'stop', prompt_eval_count: 5, eval_count: 2 }) + '\n';
function response(chunks, { hang = false } = {}) {
  return { status: 200, body: new ReadableStream({ start(controller) {
    for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
    if (!hang) controller.close();
  } }) };
}
function request(extra = {}) {
  return { baseUrl: endpoint, model: 'local:tools', messages: [{ role: 'user', content: 'Make a document' }], localTools, onDelta() {}, onLocalTool: async () => ({ file: 'document.docx' }), ...extra };
}

test('advertises native tools and continues with complete calls, thinking, content and JSON tool results', async () => {
  const bodies = [], calls = [], deltas = [], usages = [];
  const nativeCall = call();
  const p = createOllamaProvider({ fetchImpl: async (_url, options) => {
    bodies.push(JSON.parse(options.body));
    assert.equal(options.redirect, 'manual');
    if (bodies.length === 1) return response([line({ thinking: 'Plan' }), line({ content: 'Creating. ', tool_calls: [nativeCall] }), done]);
    assert.deepEqual(calls, [{ name: 'create_document', arguments: { content: 'Hello' } }]);
    return response([line({ content: 'Ready.' }), done]);
  } });
  await p.streamChat(request({ onDelta: delta => deltas.push(delta), onUsage: usage => usages.push(usage), onLocalTool: async value => { calls.push(value); return { file: 'document.docx' }; } }));
  assert.deepEqual(bodies[0].tools, localTools.map(tool => ({ type: 'function', function: tool })));
  assert.equal(bodies[0].options.num_predict, 8192);
  assert.deepEqual(bodies[1].tools, bodies[0].tools);
  assert.deepEqual(bodies[1].messages.slice(1), [
    { role: 'assistant', content: 'Creating. ', thinking: 'Plan', tool_calls: [nativeCall] },
    { role: 'tool', tool_name: 'create_document', content: '{"file":"document.docx"}' },
  ]);
  assert.equal(deltas.map(delta => delta.content).join(''), 'Creating. \n\nReady.');
  assert.equal(usages.at(-1).inputTokens, 10);
  assert.equal(usages.at(-1).outputTokens, 4);
});

test('tool dispatch waits for successful completion, even when calls arrive in fragmented NDJSON', async () => {
  let stream, dispatched = false, requests = 0;
  const p = createOllamaProvider({ fetchImpl: async () => ++requests === 1 ? { status: 200, body: new ReadableStream({ start(controller) { stream = controller; } }) } : response([done]) });
  const running = p.streamChat(request({ onLocalTool: async () => { dispatched = true; return {}; } }));
  await new Promise(resolve => setImmediate(resolve));
  const text = line({ tool_calls: [call()] });
  stream.enqueue(encoder.encode(text.slice(0, 19))); stream.enqueue(encoder.encode(text.slice(19)));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(dispatched, false);
  stream.enqueue(encoder.encode(done));
  await running;
  assert.equal(dispatched, true);
});

for (const [name, chunks, code] of [
  ['unknown function in a batch', [line({ tool_calls: [call(), { function: { name: 'delete_files', arguments: {} } }] }), done], 'INVALID_RESPONSE'],
  ['string arguments', [line({ tool_calls: [{ function: { name: 'create_document', arguments: '{}' } }] }), done], 'INVALID_RESPONSE'],
  ['array arguments', [line({ tool_calls: [{ function: { name: 'create_document', arguments: [] } }] }), done], 'INVALID_RESPONSE'],
  ['missing arguments', [line({ tool_calls: [{ function: { name: 'create_document' } }] }), done], 'INVALID_RESPONSE'],
  ['malformed calls list', [line({ tool_calls: {} }), done], 'INVALID_RESPONSE'],
  ['early EOF', [line({ tool_calls: [call()] })], 'EARLY_EOF'],
  ['invalid final JSON', [line({ tool_calls: [call()] }), '{"done":'], 'INVALID_RESPONSE'],
  ['token limit completion', [line({ tool_calls: [call()] }), '{"done":true,"done_reason":"length"}\n'], 'INVALID_RESPONSE'],
  ['arguments over 120 KiB', [line({ tool_calls: [call('a'.repeat(120 * 1024))] }), done], 'RESPONSE_LIMIT'],
  ['seventeen parallel calls', [line({ tool_calls: Array.from({ length: 17 }, () => call()) }), done], 'TOOL_LIMIT'],
]) test(`never dispatches ${name}`, async () => {
  let dispatched = 0;
  const p = createOllamaProvider({ fetchImpl: async () => response(chunks) });
  await assert.rejects(p.streamChat(request({ onLocalTool: async () => { dispatched++; return {}; } })), { code });
  assert.equal(dispatched, 0);
});

test('stops a repeating model after sixteen calls across sixteen tool rounds', async () => {
  let calls = 0, requests = 0;
  const p = createOllamaProvider({ fetchImpl: async () => { requests++; return response([line({ tool_calls: [call()] }), done]); } });
  await assert.rejects(p.streamChat(request({ onLocalTool: async () => { calls++; return {}; } })), { code: 'TOOL_LIMIT' });
  assert.equal(calls, 16); assert.equal(requests, 17);
});

test('executes parallel calls in order and continues after a recoverable tool error', async () => {
  const dispatched = []; let requests = 0;
  const p = createOllamaProvider({ fetchImpl: async (_url, options) => {
    if (++requests === 1) return response([line({ tool_calls: [call('First')] }), line({ tool_calls: [call('Second')] }), done]);
    assert.deepEqual(JSON.parse(options.body).messages.slice(-2), [
      { role: 'tool', tool_name: 'create_document', content: '{"error":"First could not be rendered"}' },
      { role: 'tool', tool_name: 'create_document', content: '{"file":"second.docx"}' },
    ]);
    return response([line({ content: 'The second file is ready.' }), done]);
  } });
  await p.streamChat(request({ onLocalTool: async ({ arguments: args }) => {
    dispatched.push(args.content);
    return args.content === 'First' ? { error: 'First could not be rendered' } : { file: 'second.docx' };
  } }));
  assert.deepEqual(dispatched, ['First', 'Second']); assert.equal(requests, 2);
});

test('rejects oversized or unserializable tool results before continuation', async () => {
  for (const result of [{ content: 'a'.repeat(120 * 1024) }, undefined, { value: 1n }]) {
    let requests = 0;
    const p = createOllamaProvider({ fetchImpl: async () => { requests++; return response([line({ tool_calls: [call()] }), done]); } });
    await assert.rejects(p.streamChat(request({ onLocalTool: async () => result })), { code: 'INVALID_TOOL_RESULT' });
    assert.equal(requests, 1);
  }
});

test('cancellation from streamed text prevents pending tool dispatch', async () => {
  let dispatched = 0; const controller = new AbortController();
  const p = createOllamaProvider({ fetchImpl: async () => response([line({ content: 'Creating', tool_calls: [call()] }), done]) });
  await assert.rejects(p.streamChat(request({ signal: controller.signal, onDelta() { controller.abort(); }, onLocalTool: async () => { dispatched++; return {}; } })), { code: 'ABORTED' });
  assert.equal(dispatched, 0);
});

test('cancellation interrupts an uncooperative executor with no late continuation or next dispatch', async () => {
  let release, started; const entered = new Promise(resolve => { started = resolve; });
  let requests = 0, calls = 0; const controller = new AbortController();
  const p = createOllamaProvider({ fetchImpl: async () => { requests++; return response([line({ tool_calls: [call(), call('Second')] }), done]); } });
  const running = p.streamChat(request({ signal: controller.signal, onLocalTool: () => { calls++; started(); return new Promise(resolve => { release = resolve; }); } }));
  await entered; controller.abort();
  await assert.rejects(running, { code: 'ABORTED' });
  release({}); await new Promise(resolve => setImmediate(resolve));
  assert.equal(requests, 1); assert.equal(calls, 1);
});

test('one total deadline covers all rounds and a stalled executor', async () => {
  let requests = 0;
  const p = createOllamaProvider({ idleMs: 1000, totalMs: 60, fetchImpl: async () => {
    requests++; await new Promise(resolve => setTimeout(resolve, 25));
    return response([line({ tool_calls: [call()] }), done]);
  } });
  await assert.rejects(p.streamChat(request({ onLocalTool: async () => { await new Promise(resolve => setTimeout(resolve, 25)); return {}; } })), { code: 'TOTAL_TIMEOUT' });
  assert.ok(requests <= 2);
  const stalled = createOllamaProvider({ idleMs: 1000, totalMs: 20, fetchImpl: async () => response([line({ tool_calls: [call()] }), done]) });
  await assert.rejects(stalled.streamChat(request({ onLocalTool: () => new Promise(() => {}) })), { code: 'TOTAL_TIMEOUT' });
});

test('generated text budget is shared across rounds', async () => {
  let requests = 0;
  const p = createOllamaProvider({ fetchImpl: async () => ++requests === 1
    ? response([line({ content: 'a'.repeat(1024 * 1024), tool_calls: [call()] }), done])
    : response([line({ content: 'b'.repeat(1024 * 1024 + 1) }), done]) });
  await assert.rejects(p.streamChat(request()), { code: 'RESPONSE_LIMIT' });
});

test('wire budget includes metadata across all rounds', async () => {
  let calls = 0;
  const p = createOllamaProvider({ fetchImpl: async () => response([line({ tool_calls: [call()] }, { metadata: 'x'.repeat(3 * 1024 * 1024) }), done]) });
  await assert.rejects(p.streamChat(request({ onLocalTool: async () => { calls++; return {}; } })), { code: 'RESPONSE_LIMIT' });
  assert.equal(calls, 1);
});

test('validates descriptors before connecting and leaves plain callers tool-free', async () => {
  let requests = 0;
  const p = createOllamaProvider({ fetchImpl: async (_url, options) => { requests++; assert.equal(Object.hasOwn(JSON.parse(options.body), 'tools'), false); return response([done]); } });
  for (const extra of [{ localTools: {} }, { localTools, onLocalTool: undefined }, { localTools: [localTools[0], localTools[0]] }, { localTools: [{ ...localTools[0], name: '../run' }] }]) {
    await assert.rejects(p.streamChat(request(extra)), { code: 'INVALID_REQUEST' });
  }
  assert.equal(requests, 0);
  await p.streamChat(request({ localTools: undefined, onLocalTool: undefined }));
  await p.streamChat(request({ localTools: [], onLocalTool: undefined }));
  assert.equal(requests, 2);
});

test('capability discovery caches by normalized endpoint and model, including negative results', async () => {
  const requests = [];
  const p = createOllamaProvider({ fetchImpl: async (url, options) => {
    requests.push({ url, body: JSON.parse(options.body) });
    return response([JSON.stringify({ capabilities: JSON.parse(options.body).model === 'local:tools' ? ['completion', 'tools'] : ['completion'] })]);
  } });
  assert.equal(await p.supportsLocalTools(endpoint + '/', 'local:tools'), true);
  assert.equal(await p.supportsLocalTools(endpoint, 'local:tools'), true);
  assert.equal(await p.supportsLocalTools(endpoint, 'local:plain'), false);
  assert.equal(await p.supportsLocalTools(endpoint, 'local:plain'), false);
  assert.equal(await p.supportsLocalTools(endpoint + '/proxy', 'local:tools'), true);
  assert.equal(requests.length, 3);
  assert.equal(requests[0].url, endpoint + '/api/show');
  assert.deepEqual(requests[0].body, { model: 'local:tools' });
});

test('capability lookup cancellation does not cache a late response', async () => {
  let release, requests = 0; const controller = new AbortController();
  const p = createOllamaProvider({ fetchImpl: async () => {
    if (++requests === 1) return new Promise(resolve => { release = resolve; });
    return response(['{"capabilities":["tools"]}']);
  } });
  const running = p.supportsLocalTools(endpoint, 'local:tools', { signal: controller.signal });
  await new Promise(resolve => setImmediate(resolve)); controller.abort();
  await assert.rejects(running, { code: 'ABORTED' });
  release(response(['{"capabilities":[]}']));
  assert.equal(await p.supportsLocalTools(endpoint, 'local:tools'), true);
  await assert.rejects(p.supportsLocalTools(endpoint, 'local:tools', { signal: controller.signal }), { code: 'ABORTED' });
  assert.equal(requests, 2);
});

test('capability failures are rejected and never cached', async () => {
  for (const payload of ['{"error":"model missing"}', '{"capabilities":"tools"}', '[]', '{bad']) {
    let requests = 0;
    const p = createOllamaProvider({ fetchImpl: async () => response([++requests === 1 ? payload : '{"capabilities":["tools"]}']) });
    await assert.rejects(p.supportsLocalTools(endpoint, 'local:tools'));
    assert.equal(await p.supportsLocalTools(endpoint, 'local:tools'), true);
    assert.equal(requests, 2);
  }
});
test('MCP selections can advertise more than sixteen tools with full descriptions',async()=>{
 const tools=Array.from({length:20},(_,i)=>({name:'mcp_'+i,description:i===0?'Research '.repeat(500):'Lookup',parameters:{type:'object'}}));let body;
 const p=createOllamaProvider({fetchImpl:async(_url,options)=>{body=JSON.parse(options.body);return response([done])}});
 await p.streamChat(request({localTools:tools}));assert.equal(body.tools.length,20);assert.equal(body.tools[0].function.description,tools[0].description);
 await assert.rejects(p.streamChat(request({localTools:Array.from({length:65},(_,i)=>({...tools[1],name:'mcp_'+i}))})),{code:'INVALID_REQUEST'});
});

test('a calendar workflow can complete more than four calls and separate round text',async()=>{
 let calls=0,requests=0;const deltas=[];
 const p=createOllamaProvider({fetchImpl:async()=>++requests<=6?response([line({content:'Checking.',tool_calls:[call()]}),done]):response([line({content:'Your calendar is clear.'}),done])});
 await p.streamChat(request({onLocalTool:async()=>{calls++;return {}},onDelta:d=>deltas.push(d.content)}));assert.equal(calls,6);assert.ok(deltas.join('').includes('Checking.\n\nYour calendar'));
});
test('exhausted tool budget requests a final summary without tools and marks the response incomplete',async()=>{
 let requests=0,calls=0;const deltas=[];
 const p=createOllamaProvider({fetchImpl:async(_,options)=>{const body=JSON.parse(options.body);if(++requests<=16)return response([line({tool_calls:[call()]}),done]);assert.equal(body.tools,undefined);assert.match(JSON.stringify(body.messages),/summarize.*results/i);return response([line({content:'I checked the primary calendar; the rest remain unchecked.'}),done]);}});
 await assert.rejects(p.streamChat(request({onLocalTool:async()=>{calls++;return {}},onDelta:d=>deltas.push(d.content)})),{code:'TOOL_LIMIT'});assert.equal(calls,16);assert.equal(requests,17);assert.match(deltas.join(''),/remain unchecked/);
});
