const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('node:stream');
const { EventStreamCodec } = require('@smithy/core/event-streams');
const baseUrl = 'https://bedrock-runtime.us-east-1.amazonaws.com';
const secret = 'fixture-bedrock-key';
const foundation = (modelId, overrides = {}) => ({ modelId, inputModalities: ['TEXT'], outputModalities: ['TEXT'], responseStreamingSupported: true, inferenceTypesSupported: ['ON_DEMAND'], modelLifecycle: { status: 'ACTIVE' }, ...overrides });
const profile = id => ({ inferenceProfileId: 'us.' + id, status: 'ACTIVE', type: 'SYSTEM_DEFINED', models: [{ modelArn: 'arn:aws:bedrock:us-west-2::foundation-model/' + id }] });
const json = (value, statusCode = 200) => ({ response: { statusCode, headers: { 'content-type': 'application/json' }, body: Readable.from([JSON.stringify(value)]) } });
const normalEvents = [
  { messageStart: { role: 'assistant' } },
  { contentBlockDelta: { contentBlockIndex: 0, delta: { reasoningContent: { text: 'Considering.' } } } },
  { contentBlockStop: { contentBlockIndex: 0 } },
  { contentBlockDelta: { contentBlockIndex: 1, delta: { text: 'Hello.' } } },
  { contentBlockStop: { contentBlockIndex: 1 } },
  { messageStop: { stopReason: 'end_turn' } },
  { metadata: { usage: { inputTokens: 2, outputTokens: 4, totalTokens: 6 }, metrics: { latencyMs: 12 } } },
];
function eventStream(events) {
  const codec = new EventStreamCodec(bytes => Buffer.from(bytes).toString('utf8'), text => Buffer.from(text));
  const wire = Buffer.concat(events.map(event => {
    const [type, payload] = Object.entries(event)[0];
    return Buffer.from(codec.encode({ headers: { ':message-type': { type: 'string', value: 'event' }, ':event-type': { type: 'string', value: type }, ':content-type': { type: 'string', value: 'application/json' } }, body: Buffer.from(JSON.stringify(payload)) }));
  }));
  // Split both the frame headers and UTF-8 payloads across transport chunks.
  return { response: { statusCode: 200, headers: { 'content-type': 'application/vnd.amazon.eventstream' }, body: Readable.from(Array.from({ length: Math.ceil(wire.length / 7) }, (_, i) => wire.subarray(i * 7, i * 7 + 7))) } };
}
function provider(handle, options = {}) {
  const { createBedrockProvider } = require('../../../packages/providers/bedrock.cjs');
  return createBedrockProvider({ apiKey: secret, requestHandler: { handle, destroy() {} }, ...options }, value => value || baseUrl);
}
const chat = (p, overrides = {}) => p.streamChat({ baseUrl, model: 'us.anthropic.claude-sonnet-4-6', messages: [{ role: 'user', content: 'Hi' }], onDelta() {}, ...overrides });

test('Bedrock authenticates read-only regional discovery with bearer tokens and preserves paginated profiles', async () => {
  const requests = [];
  const claude = 'anthropic.claude-sonnet-4-6';
  const p = provider(async request => {
    requests.push(request);
    if (request.path === '/foundation-models') return json({ modelSummaries: [foundation(claude, { inferenceTypesSupported: [], inputModalities: ['TEXT', 'IMAGE'] }), foundation('amazon.nova-micro-v1:0'), foundation('amazon.titan-embed-text-v2:0'), foundation('anthropic.claude-v2'), foundation('openai.gpt-5.6-cyber')] });
    if (!request.query.nextToken) return json({ inferenceProfileSummaries: [profile(claude)], nextToken: 'page-two' });
    return json({ inferenceProfileSummaries: [] });
  });
  assert.deepEqual(await p.listModels(baseUrl), ['amazon.nova-micro-v1:0', 'us.' + claude]);
  assert.equal(await p.supportsImages(baseUrl, 'us.' + claude), true);
  assert.equal(await p.supportsImages(baseUrl, 'amazon.nova-micro-v1:0'), false);
  assert.equal(requests.length, 3);
  for (const request of requests) {
    assert.equal(request.hostname, 'bedrock.us-east-1.amazonaws.com');
    assert.equal(request.protocol, 'https:');
    assert.equal(request.method, 'GET');
    assert.equal(new Headers(request.headers).get('authorization'), 'Bearer ' + secret);
    assert.equal(request.headers['x-amz-security-token'], undefined);
    assert.equal(request.body, undefined);
  }
  assert.equal(requests[1].query.type, 'SYSTEM_DEFINED');
  assert.equal(requests[2].query.nextToken, 'page-two');
});

test('Bedrock decodes binary stream frames into content and thinking, with a pinned API-key request', async () => {
  const deltas = []; let sent;
  const p = provider(async request => { sent = request; return eventStream(normalEvents); });
  await chat(p, { messages: [{ role: 'system', content: 'Be clear' }, { role: 'user', content: 'Hi' }], onDelta: value => deltas.push(value) });
  assert.equal(sent.hostname, 'bedrock-runtime.us-east-1.amazonaws.com');
  assert.equal(new Headers(sent.headers).get('authorization'), 'Bearer ' + secret);
  assert.equal(sent.path, '/model/us.anthropic.claude-sonnet-4-6/converse-stream');
  assert.deepEqual(JSON.parse(new TextDecoder().decode(sent.body)).system, [{ text: 'Be clear' }]);
  assert.deepEqual(JSON.parse(new TextDecoder().decode(sent.body)).messages, [{ role: 'user', content: [{ text: 'Hi' }] }]);
  assert.equal(deltas.map(d => d.content).join(''), 'Hello.');
  assert.equal(deltas.map(d => d.thinking).join(''), 'Considering.');
});

test('Bedrock rejects truncated, unsupported, incomplete and post-terminal streams', async () => {
  const cases = [
    [normalEvents.slice(0, 5), 'EARLY_EOF'],
    [[...normalEvents.slice(0, 5), { messageStop: { stopReason: 'max_tokens' } }], 'INCOMPLETE'],
    [[{ contentBlockStart: { contentBlockIndex: 0, start: { toolUse: { toolUseId: 'x', name: 'tool' } } } }], 'UNSUPPORTED_OUTPUT'],
    [[...normalEvents, { contentBlockDelta: { contentBlockIndex: 2, delta: { text: 'late' } } }], 'INVALID_RESPONSE'],
  ];
  for (const [events, code] of cases) await assert.rejects(chat(provider(async () => eventStream(events))), { code });
});

test('Bedrock catalog permission failures are actionable and redact upstream messages', async () => {
  const p = provider(async request => request.path === '/foundation-models' ? json({ modelSummaries: [] }) : json({ __type: 'AccessDeniedException', message: secret + ' sensitive content' }, 403));
  await assert.rejects(p.listModels(baseUrl), error => error.code === 'HTTP_ERROR' && /ListInferenceProfiles/.test(error.message) && !error.message.includes(secret));
});

test('Bedrock bounds hung SDK requests and honors cancellation without exposing failures', async () => {
  const p = provider(async () => new Promise(() => {}), { idleMs: 20, totalMs: 100 });
  await assert.rejects(chat(p), { code: 'IDLE_TIMEOUT' });
  const controller = new AbortController(); controller.abort(); let called = false;
  await assert.rejects(chat(provider(async () => { called = true; return eventStream(normalEvents); }), { signal: controller.signal }), { code: 'ABORTED' });
  assert.equal(called, false);
  await assert.rejects(chat(provider(async () => { throw Object.assign(new Error(secret), { code: 'INVALID_RESPONSE' }); })), error => error.code === 'NETWORK_ERROR' && !error.message.includes(secret));
});

test('Bedrock rejects oversized requests and unsupported messages before contacting AWS', async () => {
  let calls = 0; const p = provider(async () => { calls++; return eventStream(normalEvents); });
  for (const messages of [[{ role: 'tool', content: 'x' }], [{ role: 'user', content: 'x'.repeat(13 * 1024 * 1024) }], [{ role: 'user', content: 'x', images: ['bad'] }]]) await assert.rejects(chat(p, { messages }), { code: 'INVALID_REQUEST' });
  assert.equal(calls, 0);
});

test('Bedrock detects repeated profile cursors and rejects malformed catalog metadata', async () => {
  const p = provider(async request => request.path === '/foundation-models' ? json({ modelSummaries: [] }) : json({ inferenceProfileSummaries: [], nextToken: 'repeat' }));
  await assert.rejects(p.listModels(baseUrl), { code: 'INVALID_RESPONSE' });
  await assert.rejects(provider(async () => json({ modelSummaries: [{}] })).listModels(baseUrl), { code: 'INVALID_RESPONSE' });
});

test('Bedrock uses model output defaults, avoiding a token cap above Llama limits', async () => {
  let sent;
  await chat(provider(async request => { sent = JSON.parse(new TextDecoder().decode(request.body)); return eventStream(normalEvents); }), { model: 'meta.llama3-8b-instruct-v1:0' });
  assert.equal(sent.inferenceConfig, undefined);
});

test('Bedrock bounds aggregate catalog size including foundation models and profiles', async () => {
  const models = Array.from({ length: 600 }, (_, i) => foundation('anthropic.claude-sonnet-fixture-' + i));
  const p = provider(async request => {
    if (request.path === '/foundation-models') return json({ modelSummaries: models });
    const page = Number(request.query.nextToken || '0');
    return json({ inferenceProfileSummaries: models.slice(page * 100, (page + 1) * 100).map(m => profile(m.modelId)), ...(page < 5 ? { nextToken: String(page + 1) } : {}) });
  });
  await assert.rejects(p.listModels(baseUrl), { code: 'RESPONSE_LIMIT' });
});

test('Bedrock maps user images to native bytes on the wire', async () => {
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3ioAAAAASUVORK5CYII=';
  let payload;
  await chat(provider(async request => { payload = JSON.parse(new TextDecoder().decode(request.body)); return eventStream(normalEvents); }), { messages: [{ role: 'user', content: 'Image', images: [png] }] });
  assert.deepEqual(payload.messages[0].content, [{ text: 'Image' }, { image: { format: 'png', source: { bytes: png } } }]);
});

test('Bedrock bounds raw catalog bytes and generated text', async () => {
  const p = provider(async () => json({ modelSummaries: [], padding: 'x'.repeat(1024 * 1024) }));
  await assert.rejects(p.listModels(baseUrl), { code: 'RESPONSE_LIMIT' });
  await assert.rejects(chat(provider(async () => eventStream([{ contentBlockDelta: { contentBlockIndex: 0, delta: { text: 'x'.repeat(2 * 1024 * 1024 + 1) } } }, { messageStop: { stopReason: 'end_turn' } }]))), { code: 'RESPONSE_LIMIT' });
});

test('Bedrock cancellation inside a delta stops output and closes the source', async () => {
  const controller = new AbortController(); let body, deltas = 0;
  const p = provider(async () => { const result = eventStream(normalEvents); body = result.response.body; return result; });
  await assert.rejects(chat(p, { signal: controller.signal, onDelta() { deltas++; controller.abort(); } }), { code: 'ABORTED' });
  assert.equal(deltas, 1);
  assert.equal(body.destroyed, true);
});

test('Bedrock pins endpoints and bearer authentication despite ambient AWS configuration', async () => {
  const overrides = { AWS_ENDPOINT_URL: 'https://untrusted.example', AWS_ENDPOINT_URL_BEDROCK: 'https://untrusted.example', AWS_ENDPOINT_URL_BEDROCK_RUNTIME: 'https://untrusted.example', AWS_ACCESS_KEY_ID: 'fixture-access', AWS_SECRET_ACCESS_KEY: 'fixture-secret', AWS_PROFILE: 'fixture-missing-profile', AWS_REGION: 'eu-west-1', AWS_AUTH_SCHEME_PREFERENCE: 'sigv4' };
  const before = Object.fromEntries(Object.keys(overrides).map(key => [key, process.env[key]]));
  Object.assign(process.env, overrides);
  try {
    let request;
    await chat(provider(async sent => { request = sent; return eventStream(normalEvents); }));
    assert.equal(request.hostname, 'bedrock-runtime.us-east-1.amazonaws.com');
    assert.equal(new Headers(request.headers).get('authorization'), 'Bearer ' + secret);
  } finally { for (const [key, value] of Object.entries(before)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } }
});

test('Bedrock rejects oversized declared EventStream frames before SDK allocation and detects truncation', async () => {
  for (const chunks of [[Buffer.from([127, 255, 255, 255])], [Buffer.from([127]), Buffer.from([255, 255]), Buffer.from([255])], [Buffer.from([0, 0, 0, 15])]]) {
    const p = provider(async () => ({ response: { statusCode: 200, headers: { 'content-type': 'application/vnd.amazon.eventstream' }, body: Readable.from(chunks) } }));
    await assert.rejects(chat(p), { code: 'RESPONSE_LIMIT' });
  }
  const p = provider(async () => ({ response: { statusCode: 200, headers: { 'content-type': 'application/vnd.amazon.eventstream' }, body: Readable.from([Buffer.from([0, 0, 0, 20, 1])]) } }));
  await assert.rejects(chat(p), { code: 'EARLY_EOF' });
});
