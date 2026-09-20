'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { researchRequest, researchCapabilities, parseResponse } = require('../../../packages/providers/research.cjs');
const { createProvider } = require('@zq/providers');
const openai = { status: 'completed', output: [{ type: 'web_search_call', status: 'completed', action: { type: 'search', sources: [{ url: 'https://example.org/a', title: 'A' }] } }, { type: 'message', content: [{ type: 'output_text', text: 'MODEL CLAIM IS NOT EVIDENCE', annotations: [{ type: 'url_citation', url: 'https://example.org/b', title: 'B' }] }] }], usage: { input_tokens: 12, output_tokens: 8 } };
const anthropic = { stop_reason: 'end_turn', content: [{ type: 'server_tool_use', id: 's1', name: 'web_search' }, { type: 'web_search_tool_result', tool_use_id: 's1', content: [{ type: 'web_search_result', url: 'https://example.org/a', title: 'A', encrypted_content: 'opaque' }] }, { type: 'text', text: 'MODEL CLAIM', citations: [{ type: 'web_search_result_location', url: 'https://example.org/a', cited_text: 'Actual short passage' }, { type: 'web_search_result_location', url: 'https://invented.org', cited_text: 'Fabricated' }] }], usage: { input_tokens: 10, output_tokens: 6, cache_read_input_tokens: 2, cache_creation_input_tokens: 3 } };
const request = (provider, mode = 'search') => ({ baseUrl: provider === 'openai' ? 'https://api.openai.com/v1' : 'https://api.anthropic.com/v1', model: provider === 'openai' ? 'gpt-5' : 'claude-sonnet-4-5', mode, system: 'Return JSON.', prompt: 'Research.', allowedDomains: ['example.org'] });
test('research requests preserve account/model, scope, tool caps and transport privacy', async () => {
 for (const provider of ['openai', 'anthropic']) {
  let sent;
  const result = await researchRequest(provider, { apiKey: 'test-only-key', fetchImpl: async (url, init) => { sent = { url, ...init }; return new Response(JSON.stringify(provider === 'openai' ? openai : anthropic)); } }, request(provider));
  const body = JSON.parse(sent.body);
  assert.equal(body.model, request(provider).model); assert.equal(sent.credentials, 'omit'); assert.equal(sent.redirect, 'manual'); assert.equal(body.stream, false);
  assert.deepEqual(provider === 'openai' ? body.tools[0].filters.allowed_domains : body.tools[0].allowed_domains, ['example.org']);
  assert.equal(provider === 'openai' ? body.max_tool_calls : body.tools[0].max_uses, 3);
  assert.equal(provider === 'openai' ? sent.headers.Authorization : sent.headers['x-api-key'], provider === 'openai' ? 'Bearer test-only-key' : 'test-only-key');
  assert.equal(result.sources[0].url, 'https://example.org/a'); assert.equal(result.sources[0].text, undefined); assert.equal(JSON.stringify(result.sources).includes('MODEL CLAIM'), false);
 }
});
test('only successful search metadata yields sources; prose and encrypted content cannot become evidence', () => {
 const a = parseResponse('anthropic', anthropic, 'search', ['example.org']);
 assert.deepEqual(a.sources, [{ url: 'https://example.org/a', title: 'A', snippet: 'Actual short passage' }]); assert.deepEqual(a.usage, { inputTokens: 15, outputTokens: 6 });
 const noSearch = structuredClone(openai); noSearch.output.shift();
 assert.throws(() => parseResponse('openai', noSearch, 'search', []), /did not execute/);
 assert.deepEqual(parseResponse('openai', openai, 'search', ['different.org']).sources, []);
 const limited = structuredClone(anthropic); limited.content[2].citations[0].cited_text = '😀'.repeat(200);
 assert.equal(Array.from(parseResponse('anthropic', limited, 'search', []).sources[0].snippet).length, 150);
});
test('provider pause, refusal, HTTP-200 tool failure and unmatched tool output fail closed', () => {
 assert.throws(() => parseResponse('anthropic', { ...anthropic, stop_reason: 'pause_turn' }, 'search', []), /did not finish/);
 assert.throws(() => parseResponse('openai', { ...openai, status: 'incomplete' }, 'search', []), /did not finish/);
 const bad = structuredClone(anthropic); bad.content[1].content = { type: 'web_search_tool_result_error', error_code: 'max_uses_exceeded' };
 assert.throws(() => parseResponse('anthropic', bad, 'search', []), /search failed/);
 bad.content[1].tool_use_id = 'not-issued'; assert.throws(() => parseResponse('anthropic', bad, 'search', []), /Unmatched/);
 const refusal = { status: 'completed', output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'No' }] }] };
 assert.throws(() => parseResponse('openai', refusal, 'json', []), /declined/);
 assert.throws(() => parseResponse('openai', openai, 'json', []), /Unexpected/);
});
test('JSON research generation enables no tools and is available through the native provider factory', async () => {
 let sent;
 const provider = createProvider('openai', { apiKey: 'test-only-key', fetchImpl: async (_, init) => { sent = JSON.parse(init.body); return new Response(JSON.stringify({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: '{"title":"Plan"}' }] }] })); } });
 const result = await provider.researchRequest(request('openai', 'json'));
 assert.equal(sent.tools, undefined); assert.equal(sent.text.format.type, 'json_object'); assert.equal(result.text, '{"title":"Plan"}');
});
test('unsupported models, alternate endpoints and invalid domains reject before network access', async () => {
 let calls = 0; const options = { apiKey: 'test-only-key', fetchImpl: async () => { calls++; throw Error(); } };
 assert.equal(researchCapabilities('ollama', 'local').supported, false);
 for (const change of [{ model: 'unverified-new-model' }, { baseUrl: 'https://other.example/v1' }, { allowedDomains: ['*.example.org'] }, { allowedDomains: ['https://example.org'] }, { allowedDomains: ['example.org/path'] }]) await assert.rejects(researchRequest('openai', options, { ...request('openai'), ...change }));
 assert.equal(calls, 0);
});
test('cancel, transport failures and oversized responses do not leak provider secrets', async () => {
 const controller = new AbortController(); let entered;
 const started = new Promise(resolve => { entered = resolve; });
 const pending = researchRequest('openai', { apiKey: 'test-only-key', fetchImpl: async () => { entered(); return new Promise(() => {}); } }, { ...request('openai'), signal: controller.signal });
 await started; controller.abort(); await assert.rejects(pending, /stopped/);
 await assert.rejects(researchRequest('openai', { apiKey: 'test-only-key', fetchImpl: async () => { throw Error('SECRET CONTENT'); } }, request('openai')), error => !error.message.includes('SECRET') && error.code === 'NETWORK_ERROR');
 await assert.rejects(researchRequest('openai', { apiKey: 'test-only-key', fetchImpl: async () => new Response('x'.repeat(2 * 1024 * 1024 + 1)) }, request('openai')), /size limit/);
});
