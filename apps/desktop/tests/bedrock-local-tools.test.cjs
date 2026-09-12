const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('node:stream');
const { EventStreamCodec } = require('@smithy/core/event-streams');
const { createBedrockProvider } = require('../../../packages/providers/bedrock.cjs');
const baseUrl = 'https://bedrock-runtime.us-east-1.amazonaws.com';
const localTools = [{ name: 'create_artifact', description: 'Create an artifact', parameters: { type: 'object', properties: { title: { type: 'string' } }, required: ['title'], additionalProperties: false } }];
const start = { messageStart: { role: 'assistant' } };
const stop = index => ({ contentBlockStop: { contentBlockIndex: index } });
const delta = (index, value) => ({ contentBlockDelta: { contentBlockIndex: index, delta: value } });
const toolStart = (index = 0, id = 'call_1', name = 'create_artifact') => ({ contentBlockStart: { contentBlockIndex: index, start: { toolUse: { toolUseId: id, name } } } });
const toolRound = (id = 'call_1', input = '{"title":"Chart"}') => [start, toolStart(0, id), delta(0, { toolUse: { input } }), stop(0), { messageStop: { stopReason: 'tool_use' } }];
const finalRound = [start, delta(0, { text: 'Created.' }), stop(0), { messageStop: { stopReason: 'end_turn' } }];
function eventStream(events) {
  const codec = new EventStreamCodec(bytes => Buffer.from(bytes).toString('utf8'), text => Buffer.from(text));
  const wire = Buffer.concat(events.map(event => {
    const [type, payload] = Object.entries(event)[0];
    return Buffer.from(codec.encode({ headers: { ':message-type': { type: 'string', value: 'event' }, ':event-type': { type: 'string', value: type }, ':content-type': { type: 'string', value: 'application/json' } }, body: Buffer.from(JSON.stringify(payload)) }));
  }));
  return { response: { statusCode: 200, headers: { 'content-type': 'application/vnd.amazon.eventstream' }, body: Readable.from(Array.from({ length: Math.ceil(wire.length / 7) }, (_, i) => wire.subarray(i * 7, i * 7 + 7))) } };
}
function provider(handle, options = {}) { return createBedrockProvider({ apiKey: 'fixture-key', requestHandler: { handle, destroy() {} }, ...options }, value => value || baseUrl); }
const chat = (p, overrides = {}) => p.streamChat({ baseUrl, model: 'us.anthropic.claude-sonnet-4-6', messages: [{ role: 'user', content: 'Create a chart' }], localTools, onLocalTool: async () => ({ artifactId: 'artifact_1' }), onDelta() {}, ...overrides });

test('Bedrock advertises local tools only for documented Converse streaming tool models', async () => {
  const p = provider(async () => { throw new Error('Capability checks must not invoke a model'); });
  for (const model of ['us.anthropic.claude-sonnet-4-6', 'global.anthropic.claude-opus-4-6', 'anthropic.claude-haiku-4-5-20251001-v1:0', 'amazon.nova-micro-v1:0', 'us.amazon.nova-2-lite-v1:0']) assert.equal(await p.supportsLocalTools(baseUrl, model), true, model);
  for (const model of ['meta.llama3-8b-instruct-v1:0', 'anthropic.claude-v2', 'anthropic.claude-sonnet-999', 'anthropic.claude-mythos-5', 'amazon.nova-sonic-v1:0', 'unknown', 'evil.anthropic.claude-sonnet-4-6']) assert.equal(await p.supportsLocalTools(baseUrl, model), false, model);
});

test('Bedrock executes completed calls and returns matching results with original text and reasoning', async () => {
  const first = [start, delta(0, { reasoningContent: { text: 'Plan.' } }), delta(0, { reasoningContent: { signature: 'signed-' } }), delta(0, { reasoningContent: { signature: 'value' } }), stop(0), delta(1, { reasoningContent: { redactedContent: Buffer.from([0, 255, 23]).toString('base64') } }), stop(1), delta(2, { text: 'Making it.' }), stop(2), toolStart(3), delta(3, { toolUse: { input: '{"title":' } }), delta(3, { toolUse: { input: '"Chart"}' } }), stop(3), { messageStop: { stopReason: 'tool_use' } }, { metadata: { usage: { inputTokens: 10, outputTokens: 4 } } }];
  const requests = [], calls = [], output = [], usage = [];
  await chat(provider(async request => { requests.push(JSON.parse(new TextDecoder().decode(request.body))); assert.equal(new Headers(request.headers).get('authorization'), 'Bearer fixture-key'); return eventStream(requests.length === 1 ? first : [...finalRound, { metadata: { usage: { inputTokens: 15, outputTokens: 2 } } }]); }), { onLocalTool: async call => { calls.push(call); return { artifactId: 'artifact_1' }; }, onDelta: value => output.push(value), onUsage: value => usage.push(value) });
  assert.deepEqual(calls, [{ name: 'create_artifact', arguments: { title: 'Chart' } }]);
  assert.equal(requests.length, 2);
  assert.deepEqual(requests[0].toolConfig, { tools: [{ toolSpec: { name: 'create_artifact', description: 'Create an artifact', inputSchema: { json: localTools[0].parameters } } }] });
  assert.deepEqual(requests[1].messages.slice(1), [{ role: 'assistant', content: [{ reasoningContent: { reasoningText: { text: 'Plan.', signature: 'signed-value' } } }, { reasoningContent: { redactedContent: 'AP8X' } }, { text: 'Making it.' }, { toolUse: { toolUseId: 'call_1', name: 'create_artifact', input: { title: 'Chart' } } }] }, { role: 'user', content: [{ toolResult: { toolUseId: 'call_1', content: [{ json: { artifactId: 'artifact_1' } }] } }] }]);
  assert.equal(output.map(value => value.content).join(''), 'Making it.Created.');
  assert.equal(output.map(value => value.thinking).join(''), 'Plan.');
  assert.deepEqual(usage.at(-1), { inputTokens: 25, outputTokens: 6 });
});

test('Bedrock never executes partial, malformed, unknown, or nonterminal tool requests', async () => {
  const cases = [
    [toolRound().slice(0, 3), 'EARLY_EOF'],
    [[...toolRound().slice(0, 3), { messageStop: { stopReason: 'tool_use' } }], 'INVALID_RESPONSE'],
    [[...toolRound().slice(0, 4), { messageStop: { stopReason: 'end_turn' } }], 'INVALID_RESPONSE'],
    [toolRound('call_1', '{bad'), 'INVALID_RESPONSE'],
    [[start, toolStart(0, 'call_1', 'shell_exec'), delta(0, { toolUse: { input: '{}' } }), stop(0), { messageStop: { stopReason: 'tool_use' } }], 'UNSUPPORTED_OUTPUT'],
    [[...toolRound(), delta(1, { text: 'late' })], 'INVALID_RESPONSE'],
    [[start, toolStart(), delta(0, { toolUse: { input: 'x'.repeat(120 * 1024 + 1) } })], 'RESPONSE_LIMIT'],
    [[...toolRound().slice(0, 4), { messageStop: { stopReason: 'max_tokens' } }], 'INCOMPLETE'],
  ];
  for (const [events, code] of cases) {
    let calls = 0;
    await assert.rejects(chat(provider(async () => eventStream(events)), { onLocalTool: async () => { calls++; return {}; } }), { code });
    assert.equal(calls, 0);
  }
});

test('Bedrock preserves AWS tool IDs with punctuation and rejects server tool execution', async () => {
  const requests = [];
  await chat(provider(async request => { requests.push(JSON.parse(new TextDecoder().decode(request.body))); return eventStream(requests.length === 1 ? toolRound('call.1:part-a') : finalRound); }));
  assert.equal(requests[1].messages.at(-1).content[0].toolResult.toolUseId, 'call.1:part-a');
  const events = toolRound(); events[1].contentBlockStart.start.toolUse.type = 'server_tool_use';
  let calls = 0;
  await assert.rejects(chat(provider(async () => eventStream(events)), { onLocalTool: async () => { calls++; return {}; } }), { code: 'UNSUPPORTED_OUTPUT' });
  assert.equal(calls, 0);
});

test('Bedrock deduplicates repeated call IDs across rounds and rejects changed payloads', async () => {
  let requests = 0, executions = 0;
  await chat(provider(async () => eventStream(++requests <= 2 ? toolRound() : finalRound)), { onLocalTool: async () => { executions++; return { artifactId: 'artifact_1' }; } });
  assert.equal(executions, 1);
  assert.equal(requests, 3);
  requests = 0; executions = 0;
  await assert.rejects(chat(provider(async () => eventStream(++requests === 1 ? toolRound() : toolRound('call_1', '{"title":"Changed"}'))), { onLocalTool: async () => { executions++; return {}; } }), { code: 'INVALID_RESPONSE' });
  assert.equal(executions, 1);
});

test('Bedrock limits total local calls and bounds results before a continuation', async () => {
  let requests = 0, executions = 0;
  await assert.rejects(chat(provider(async () => eventStream(toolRound('call_' + ++requests))), { onLocalTool: async () => { executions++; return {}; } }), { code: 'TOOL_LIMIT' });
  assert.equal(executions, 12);
  assert.equal(requests, 13);
  requests = 0;
  await assert.rejects(chat(provider(async () => { requests++; return eventStream(toolRound()); }), { onLocalTool: async () => ({ text: 'x'.repeat(120 * 1024) }) }), { code: 'RESPONSE_LIMIT' });
  assert.equal(requests, 1);
});

test('Bedrock cancellation during execution prevents continuation and later calls', async () => {
  const controller = new AbortController(); let requests = 0, executions = 0;
  const events = [...toolRound().slice(0, 4), toolStart(1, 'call_2'), delta(1, { toolUse: { input: '{"title":"Second"}' } }), stop(1), { messageStop: { stopReason: 'tool_use' } }];
  await assert.rejects(chat(provider(async () => { requests++; return eventStream(events); }), { signal: controller.signal, onLocalTool: async () => { executions++; controller.abort(); return {}; } }), { code: 'ABORTED' });
  assert.equal(requests, 1);
  assert.equal(executions, 1);
});

test('Bedrock deadlines include hung local execution and its errors are redacted', async () => {
  let requests = 0;
  await assert.rejects(chat(provider(async () => { requests++; return eventStream(toolRound()); }, { idleMs: 30, totalMs: 200 }), { onLocalTool: async () => new Promise(() => {}) }), { code: 'IDLE_TIMEOUT' });
  assert.equal(requests, 1);
  await assert.rejects(chat(provider(async () => eventStream(toolRound())), { onLocalTool: async () => { throw new Error('private-key and document text'); } }), error => error.code === 'LOCAL_TOOL_ERROR' && !/private-key|document text/.test(error.message));
});

test('Bedrock unsupported models omit local definitions and never execute model tool output', async () => {
  let payload, executions = 0;
  const p = provider(async request => { payload = JSON.parse(new TextDecoder().decode(request.body)); return eventStream(toolRound()); });
  await assert.rejects(chat(p, { model: 'meta.llama3-8b-instruct-v1:0', onLocalTool: async () => { executions++; return {}; } }), { code: 'UNSUPPORTED_OUTPUT' });
  assert.equal(payload.toolConfig, undefined);
  assert.equal(executions, 0);
});

test('Bedrock rejects a historical ID conflict before any new call in the terminal batch', async () => {
  let requests = 0; const executions = [];
  const conflict = [start, toolStart(0, 'call_2'), delta(0, { toolUse: { input: '{"title":"New"}' } }), stop(0), toolStart(1, 'call_1'), delta(1, { toolUse: { input: '{"title":"Changed"}' } }), stop(1), { messageStop: { stopReason: 'tool_use' } }];
  await assert.rejects(chat(provider(async () => eventStream(++requests === 1 ? toolRound() : conflict)), { onLocalTool: async call => { executions.push(call); return {}; } }), { code: 'INVALID_RESPONSE' });
  assert.deepEqual(executions, [{ name: 'create_artifact', arguments: { title: 'Chart' } }]);
  assert.equal(requests, 2);
});
