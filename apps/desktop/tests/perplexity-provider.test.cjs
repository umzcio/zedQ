const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createProvider } = require('@zq/providers');
const baseUrl = 'https://api.perplexity.ai';
const options = { apiKey: 'fixture-key' };

test('Perplexity verifies credentials with a read-only request, returning only Sonar models', async () => {
  const requests = [];
  const provider = createProvider('perplexity', { ...options, fetchImpl: async (url, init) => {
    requests.push({ url, ...init });
    return new Response(JSON.stringify({ requests: [], next_token: null }));
  }});
  assert.deepEqual(await provider.listModels(baseUrl), ['sonar', 'sonar-pro', 'sonar-reasoning-pro', 'sonar-deep-research']);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, baseUrl + '/v1/async/sonar');
  assert.equal(requests[0].method, 'GET');
  assert.equal(requests[0].body, undefined);
  assert.equal(requests[0].headers.Authorization, 'Bearer fixture-key');
  assert.equal(await provider.supportsImages(baseUrl, 'sonar-deep-research'), false);
  assert.equal(await provider.supportsImages(baseUrl, 'sonar-pro'), true);
});

test('Perplexity separates fragmented leading reasoning and preserves ordinary answer tags', async () => {
  const parts = ['<th', 'ink>Let me ', 'consider.</thi', 'nk>', 'Answer [1]. Example: <think>literal</think>'];
  const records = parts.map(content => ({ choices: [{ index: 0, delta: { content } }] }));
  records.push({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], citations: ['https://example.com/source'] });
  const provider = createProvider('perplexity', { ...options, fetchImpl: async () => new Response(records.map(record => 'data: ' + JSON.stringify(record) + '\n\n').join('') + 'data: [DONE]\n\n') });
  const deltas = [];
  await provider.streamChat({ baseUrl, model: 'sonar-reasoning-pro', messages: [{ role: 'user', content: 'Hi' }], onDelta: delta => deltas.push(delta) });
  assert.equal(deltas.map(d => d.thinking).join(''), 'Let me consider.');
  const answer = deltas.map(d => d.content).join('');
  assert.match(answer, /^Answer \[1\]\. Example: <think>literal<\/think>/);
  assert.match(answer, /https:\/\/example.com\/source/);
});

test('Perplexity does not report a valid connection when authentication fails or its response is malformed', async () => {
  for (const response of [new Response('{}', { status: 401 }), new Response('{}'), new Response('{"error":"sensitive"}')]) {
    const provider = createProvider('perplexity', { ...options, fetchImpl: async () => response });
    await assert.rejects(provider.listModels(baseUrl), error => !error.message.includes('sensitive'));
  }
});

test('Perplexity rejects unsupported model IDs without sending a generation request', async () => {
  let called = false;
  const provider = createProvider('perplexity', { ...options, fetchImpl: async () => { called = true; return new Response('{}'); }});
  await assert.rejects(provider.streamChat({ baseUrl, model: 'anthropic/claude-sonnet', messages: [{ role: 'user', content: 'Hi' }], onDelta() {} }), { code: 'INVALID_REQUEST' });
  assert.equal(called, false);
});
