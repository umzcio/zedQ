'use strict';
const { createTransport, failure, parseJSON, object } = require('./transport.cjs');
const { hostedToolOptions } = require('./hosted-tools.cjs');
const { sourceURL, sourceTitle } = require('./sources.cjs');
const BASES = { openai: 'https://api.openai.com/v1', anthropic: 'https://api.anthropic.com/v1' };
const count = v => Number.isSafeInteger(v) && v >= 0;
function researchCapabilities(provider, model) {
 const supported = Object.hasOwn(BASES, provider) && hostedToolOptions(provider, model).some(t => t.kind === 'web_search');
 return { supported, web: supported, reason: supported ? '' : 'Research currently requires a supported OpenAI or Anthropic Chat model. The selected model will not be replaced.' };
}
function domains(values) {
 if (!Array.isArray(values) || values.length > 40 || values.some(v => typeof v !== 'string' || v.length > 253 || !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/.test(v))) throw failure('INVALID_REQUEST', 'Use lower-case domain names without schemes, paths or wildcards.');
 return values;
}
function allowedURL(value, allowedDomains) {
 const clean = sourceURL(value); if (!clean) return;
 const url = new URL(clean);
 if (url.protocol !== 'https:' || url.port || clean.length > 4096) return;
 if (allowedDomains.length && !allowedDomains.some(d => url.hostname === d || url.hostname.endsWith('.' + d))) return;
 return url.href;
}
function usage(provider, value) {
 if (!object(value) || !count(value.input_tokens) || !count(value.output_tokens)) return;
 const inputTokens = value.input_tokens + (provider === 'anthropic' ? (count(value.cache_read_input_tokens) ? value.cache_read_input_tokens : 0) + (count(value.cache_creation_input_tokens) ? value.cache_creation_input_tokens : 0) : 0);
 return { inputTokens, outputTokens: value.output_tokens };
}
function parseResponse(provider, data, mode, allowedDomains) {
 if (!object(data) || data.error || (provider === 'openai' ? data.status !== 'completed' : data.stop_reason !== 'end_turn')) throw failure('INCOMPLETE', 'Research did not finish this request. Its previous checkpoint is preserved.');
 const blocks = provider === 'openai' ? data.output : data.content;
 if (!Array.isArray(blocks) || blocks.length > 500) throw failure('INVALID_RESPONSE', 'Invalid research response.');
 const sources = new Map(); let text = '', searched = false, searchErrors = 0;
 const add = (url, title) => { url = allowedURL(url, allowedDomains); if (url && sources.size < 30 && !sources.has(url)) sources.set(url, { url, title: sourceTitle(title, url) }); };
 if (provider === 'openai') {
  for (const item of blocks) {
   if (item?.type === 'web_search_call') {
    if (mode !== 'search') throw failure('UNSUPPORTED_OUTPUT', 'Unexpected research tool.');
    if (item.status !== 'completed') { searchErrors++; continue; } searched = true;
    for (const s of Array.isArray(item.action?.sources) ? item.action.sources : []) add(s?.url, s?.title);
   } else if (item?.type === 'message') {
    if (!Array.isArray(item.content)) throw failure('INVALID_RESPONSE', 'Invalid research content.');
    for (const part of item.content) {
     if (part.type === 'refusal') throw failure('PROVIDER_REFUSAL', 'The provider declined this research request.');
     if (part.type === 'output_text' && typeof part.text === 'string') text += part.text;
    }
   } else if (item?.type !== 'reasoning') throw failure('UNSUPPORTED_OUTPUT', 'Unexpected research output.');
  }
  // Citation URLs are useful when sources metadata is omitted, but are accepted
  // only with a successful search call. Assistant prose is never source text.
  if (searched) for (const item of blocks) if (item.type === 'message') for (const part of item.content) for (const a of part.annotations ?? []) if (a?.type === 'url_citation') add(a.url, a.title);
 } else {
  const searchIds = new Set(blocks.filter(b => b?.type === 'server_tool_use' && b.name === 'web_search').map(b => b.id));
  for (const block of blocks) {
   if (block?.type === 'text') { if (typeof block.text !== 'string') throw failure('INVALID_RESPONSE', 'Invalid research text.'); text += block.text; }
   else if (block?.type === 'server_tool_use') { if (mode !== 'search' || block.name !== 'web_search') throw failure('UNSUPPORTED_OUTPUT', 'Unexpected research tool.'); }
   else if (block?.type === 'web_search_tool_result') {
    if (mode !== 'search' || !searchIds.has(block.tool_use_id)) throw failure('INVALID_RESPONSE', 'Unmatched research search result.');
    if (!Array.isArray(block.content)) { searchErrors++; continue; } searched = true;
    for (const s of block.content) if (s?.type === 'web_search_result') add(s.url, s.title);
   } else if (!['thinking', 'redacted_thinking'].includes(block?.type)) throw failure('UNSUPPORTED_OUTPUT', 'Unexpected research output.');
  }
  for (const block of blocks) if (block.type === 'text') for (const citation of block.citations ?? []) {
   const s = sources.get(allowedURL(citation.url, allowedDomains));
   if (s && citation.type === 'web_search_result_location' && typeof citation.cited_text === 'string') s.snippet = Array.from(citation.cited_text).slice(0, 150).join('');
  }
 }
 if (Buffer.byteLength(text) > 512000) throw failure('RESPONSE_LIMIT', 'Research response is too large.');
 if (mode === 'search' && !searched) throw failure('SEARCH_FAILED', searchErrors ? 'The provider web search failed. Try again later.' : 'The provider did not execute a web search. No evidence was recorded.');
 return { text, sources: [...sources.values()], ...(usage(provider, data.usage) ? { usage: usage(provider, data.usage) } : {}), ...(searchErrors ? { warning: 'Some provider searches failed; the available results may be incomplete.' } : {}) };
}
/** Separate bounded calls; ordinary Chat tool limits and streamed rendering are unchanged. */
async function researchRequest(provider, { apiKey, ...transportOptions }, request) {
 const { baseUrl, model, mode, system, prompt, signal, allowedDomains = [] } = request;
 if (!researchCapabilities(provider, model).supported || baseUrl !== BASES[provider]) throw failure('UNSUPPORTED_TOOLS', 'Research is unavailable for the selected provider/model.');
 if (typeof apiKey !== 'string' || !apiKey || apiKey.length > 8192 || /[\s\x00-\x1f\x7f]/.test(apiKey)) throw failure('INVALID_API_KEY', 'Add a valid provider API key.');
 if (!['json', 'search'].includes(mode) || typeof system !== 'string' || typeof prompt !== 'string' || Buffer.byteLength(system + prompt) > 256000 || /\0/.test(system + prompt)) throw failure('INVALID_REQUEST', 'Invalid research request.');
 domains(allowedDomains);
 const headers = provider === 'openai' ? { Authorization: `Bearer ${apiKey}` } : { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' };
 const payload = provider === 'openai'
  ? { model, stream: false, store: false, max_output_tokens: 8192, input: [{ role: 'system', content: system }, { role: 'user', content: prompt }], ...(mode === 'search' ? { tools: [{ type: 'web_search', ...(allowedDomains.length ? { filters: { allowed_domains: allowedDomains } } : {}) }], max_tool_calls: 3, tool_choice: 'required', include: ['web_search_call.action.sources'] } : { text: { format: { type: 'json_object' } } }) }
  : { model, stream: false, max_tokens: 8192, system, messages: [{ role: 'user', content: prompt }], ...(mode === 'search' ? { tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 3, ...(allowedDomains.length ? { allowed_domains: allowedDomains } : {}) }] } : {}) };
 let raw = '';
 await createTransport({ ...transportOptions, totalMs: Math.min(transportOptions.totalMs ?? 85000, 85000) })(baseUrl + (provider === 'openai' ? '/responses' : '/messages'), { headers, signal, body: JSON.stringify(payload), maxBytes: 2 * 1024 * 1024, onText: chunk => { raw += chunk; } });
 return parseResponse(provider, parseJSON(raw), mode, allowedDomains);
}
module.exports = { researchCapabilities, researchRequest, parseResponse, domains, allowedURL };
