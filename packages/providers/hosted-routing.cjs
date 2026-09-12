const { createToolSession } = require('./local-tools.cjs');
const { createActiveClock } = require('./active-clock.cjs');
const { createChatTurn, validateCalls } = require('./local-chat.cjs');
const { createSources } = require('./sources.cjs');
const { createTelemetry } = require('./usage.cjs');
const { createTransport, sseParser, failure, object, parseJSON, TEXT_LIMIT, REQUEST_LIMIT } = require('./transport.cjs');

const BASES = Object.freeze({ xai: 'https://api.x.ai/v1', openrouter: 'https://openrouter.ai/api/v1' });
const ROUTING_HOSTED_CAPABILITIES = Object.freeze({ xai: Object.freeze(['web_search', 'x_search']), openrouter: Object.freeze(['web_search']) });
function routingHostedCapabilities(provider, model) {
  if (typeof model !== 'string' || !model.trim() || model.length > 512) return [];
  if (provider === 'xai') return /^grok-4(?:\.(?:20|3|5|6))?(?:-|$)/.test(model) ? [...ROUTING_HOSTED_CAPABILITIES.xai] : [];
  if (provider === 'openrouter' && !model.endsWith(':batch')) return [...ROUTING_HOSTED_CAPABILITIES.openrouter];
  return [];
}
function sourceURL(value) {
  if (typeof value !== 'string' || value.length > 8192 || /[\x00-\x20\x7f]/.test(value)) return;
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return;
    return url.href.replace(/[<>()\[\]\\]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());
  } catch { return; }
}
function activityDetail(value) {
  // The durable host contract is UTF-8 bytes, not JavaScript code units.
  let result = '', bytes = 0;
  for (const point of Buffer.from(value.replace(/\0/g, '')).toString('utf8')) {
    const size = Buffer.byteLength(point);
    if (bytes + size > 4000) break;
    result += point; bytes += size;
  }
  return result;
}
function imageMime(data) {
  if (typeof data !== 'string' || data.length > 1398104 || data.length % 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) throw failure('INVALID_REQUEST', 'Chat images must be valid PNG, JPEG, or WebP data.');
  const b = Buffer.from(data, 'base64');
  if (b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png';
  if (b[0] === 255 && b[1] === 216 && b[2] === 255) return 'image/jpeg';
  if (b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  throw failure('INVALID_REQUEST', 'Chat images must be PNG, JPEG, or WebP.');
}

async function streamHostedRouting(provider, { apiKey, ...transportOptions }, request) {
  const { baseUrl, model, messages, signal, onDelta, onTool, onUsage, onModel, onSources } = request;
  if (!BASES[provider]) throw failure('UNSUPPORTED_TOOL', 'Hosted tools are not available for this provider.');
  if (baseUrl !== undefined && baseUrl !== BASES[provider] && baseUrl !== BASES[provider] + '/') throw failure('INVALID_ENDPOINT', 'Hosted tools require the official provider endpoint.');
  if (typeof apiKey !== 'string' || !apiKey || apiKey.length > 8192 || /[\s\x00-\x1f\x7f]/.test(apiKey)) throw failure('INVALID_API_KEY', 'Enter a valid API key.');
  if (typeof model !== 'string' || !model.trim() || model.length > 512 || typeof onDelta !== 'function' || (onTool !== undefined && typeof onTool !== 'function') || !Array.isArray(messages) || !messages.length || messages.length > 10000 || !messages.every(m => object(m) && ['system', 'user', 'assistant'].includes(m.role) && typeof m.content === 'string' && Object.keys(m).every(k => ['role', 'content', 'images'].includes(k)) && (m.images === undefined || m.role === 'user' && Array.isArray(m.images) && m.images.length <= 10))) throw failure('INVALID_REQUEST', 'Chat requires a model and valid messages.');
  const available = routingHostedCapabilities(provider, model);
  if (!Array.isArray(request.tools) || request.tools.length > 2 || new Set(request.tools).size !== request.tools.length || request.tools.some(t => !available.includes(t))) throw failure('UNSUPPORTED_TOOL', 'The selected hosted tool is not supported by this model.');
  const selected = new Set(request.tools);
  const input = messages.map(m => ({ role: m.role, content: m.images?.length ? [provider === 'xai' ? { type: 'input_text', text: m.content } : { type: 'text', text: m.content }, ...m.images.map(data => { const url = `data:${imageMime(data)};base64,${data}`; return provider === 'xai' ? { type: 'input_image', image_url: url } : { type: 'image_url', image_url: { url } }; })] : m.content }));
  const clock = createActiveClock(request.onLocalTool?.userWait), totalMs = transportOptions.totalMs ?? 600000;
  const check = () => { if (signal?.aborted) throw failure('ABORTED', 'The provider request was stopped.'); if (clock.elapsedMs() >= totalMs) throw failure('TOTAL_TIMEOUT', 'The provider exceeded the request time limit.'); };
  const session = createToolSession(request.localTools, request.onLocalTool, check, { signal, totalMs: transportOptions.totalMs });
  if (!selected.size && !session.enabled) throw failure('UNSUPPORTED_TOOL', 'Enable a hosted or local tool for this route.');
  const payload = provider === 'xai'
    ? { model, stream: true, store: false, max_output_tokens: request.maxTokens ?? 8192, parallel_tool_calls: false, input, tools: [...request.tools.map(type => ({ type })), ...session.definitions.map(tool => ({ type: 'function', ...tool }))], include: [...(selected.size ? ['web_search_call.action.sources'] : []), ...(session.enabled ? ['reasoning.encrypted_content'] : [])] }
    : { model, stream: true, modalities: ['text'], ...(request.outputLimit ?? {}), messages: input, ...(selected.size ? { max_tool_calls: 2 } : {}), tools: [...(selected.has('web_search') ? [{ type: 'openrouter:web_search', parameters: { engine: 'exa', max_results: 5, max_total_results: 10, max_uses: 2 } }] : []), ...session.definitions.map(tool => ({ type: 'function', function: tool }))], ...(session.enabled ? { parallel_tool_calls: false } : {}) };
  let complete = false, content = '', bytes = 0, searchCount = 0, roundSearchCount = 0, roundContent = '', output = [], chatTurn;
  const functionItems = new Map();
  const sources = new Map(), observed = new Map(), metadata = createSources(onSources);
  const emit = (text = '', thinking = '') => {
    if (typeof text !== 'string' || typeof thinking !== 'string') throw failure('INVALID_RESPONSE', 'The provider returned an invalid text delta.');
    bytes += Buffer.byteLength(text) + Buffer.byteLength(thinking);
    if (bytes > TEXT_LIMIT) throw failure('RESPONSE_LIMIT', 'The provider generated more than 2 MiB of text.');
    check(); content += text; roundContent += text; if (text || thinking) onDelta({ content: text, thinking }); check();
  };
  const source = (value, title) => { const url = sourceURL(value); if (url && sources.size < 100) { sources.set(url, url); metadata.add(url,title); } };
  const annotations = list => {
    if (list === undefined) return;
    if (!Array.isArray(list) || list.length > 1000) throw failure('INVALID_RESPONSE', 'The provider returned invalid source annotations.');
    for (const a of list) if (a?.type === 'url_citation') source(a.url ?? a.url_citation?.url, a.title ?? a.url_citation?.title);
  };
  const status = (id, kind, state, detail) => {
    if (typeof id !== 'string' || !id || id.length > 256 || /[\x00-\x1f\x7f]/.test(id)) throw failure('INVALID_RESPONSE', 'The provider returned an invalid tool identifier.');
    const prior = observed.get(id);
    if (prior && prior.kind !== kind) throw failure('INVALID_RESPONSE', 'The provider changed a tool identifier.');
    if (!prior && observed.size >= 8) throw failure('RESPONSE_LIMIT', 'The provider exceeded the observed tool-call limit.');
    if (prior?.status === state || prior && prior.status !== 'running') return;
    observed.set(id, { kind, status: state });
    check(); onTool?.({ id, kind, status: state, ...(detail ? { detail: activityDetail(detail) } : {}) }); check();
  };
  const item = value => {
    if (!object(value) || typeof value.type !== 'string') throw failure('INVALID_RESPONSE', 'The provider returned an invalid output item.');
    const kind = value.type === 'web_search_call' ? 'web_search' : value.type === 'x_search_call' ? 'x_search' : undefined;
    if (kind) {
      if (!selected.has(kind)) throw failure('UNSUPPORTED_OUTPUT', 'The provider called a tool that was not enabled.');
      const state = ['failed', 'incomplete'].includes(value.status) ? 'error' : value.status === 'completed' ? 'complete' : 'running';
      const query = value.action?.query;
      status(value.id, kind, state, typeof query === 'string' ? query : undefined);
      if (Array.isArray(value.action?.sources)) for (const s of value.action.sources.slice(0, 100)) source(s?.url,s?.title);
    } else if (value.type === 'function_call') {
      if (!session.enabled || value.name !== undefined && !session.has(value.name)) throw failure('UNSUPPORTED_OUTPUT', 'The provider requested an unavailable local tool.');
    } else if (!['message', 'reasoning'].includes(value.type)) throw failure('UNSUPPORTED_OUTPUT', 'The provider returned a tool or output that this chat cannot execute.');
    if (value.type === 'message') {
      if (!Array.isArray(value.content)) throw failure('INVALID_RESPONSE', 'The provider returned an invalid message.');
      for (const part of value.content) {
        if (!object(part) || !['output_text', 'refusal'].includes(part.type)) throw failure('UNSUPPORTED_OUTPUT', 'The provider returned unsupported message content.');
        annotations(part.annotations);
      }
    }
  };
  const telemetry=createTelemetry({onUsage,onModel});
  const record = (wire, event) => {
    check();
    if (wire === '[DONE]' && provider === 'openrouter') { complete = chatTurn.done(); return true; }
    const p = parseJSON(wire);
    if (!object(p)) throw failure('INVALID_RESPONSE', 'The provider returned an invalid stream event.');
    if (Object.hasOwn(p, 'error') || event === 'error' || p.type === 'error' || p.type === 'response.failed') throw failure('PROVIDER_ERROR', 'The provider could not complete the hosted-tool request.');
    telemetry.observe(provider === 'xai' ? 'responses' : 'chat',p);
    if (provider === 'xai') {
      if (p.type === 'response.output_text.delta' || p.type === 'response.refusal.delta') emit(p.delta);
      else if (['response.reasoning_summary_text.delta', 'response.reasoning_text.delta'].includes(p.type)) emit('', p.delta);
      else if (p.type === 'response.output_item.added' || p.type === 'response.output_item.done') {
        item(p.item);
        if (p.item.type === 'function_call') {
          const id = p.item.id;
          if (typeof id !== 'string' || !id || id.length > 256) throw failure('INVALID_RESPONSE', 'The provider returned an invalid function item.');
          const prior = functionItems.get(id);
          if (prior && (prior.name !== p.item.name || prior.call_id !== p.item.call_id)) throw failure('INVALID_RESPONSE', 'The provider changed a function identifier.');
          if (p.type === 'response.output_item.done' && (prior?.streamed || prior?.done) && prior.arguments !== p.item.arguments) throw failure('INVALID_RESPONSE', 'The provider changed streamed function arguments.');
          if (!prior && functionItems.size >= 12) throw failure('RESPONSE_LIMIT', 'The provider exceeded the local tool-call limit.');
          functionItems.set(id, { ...p.item, streamed: prior?.streamed, done: p.type === 'response.output_item.done' });
        }
      }
      else if (p.type === 'response.function_call_arguments.delta' || p.type === 'response.function_call_arguments.done') {
        const value = functionItems.get(p.item_id);
        if (!value || value.status === 'completed') throw failure('INVALID_RESPONSE', 'The provider returned an unmatched function argument event.');
        if (p.type.endsWith('.delta')) {
          if (typeof p.delta !== 'string') throw failure('INVALID_RESPONSE', 'The provider returned invalid function arguments.');
          value.arguments = (value.arguments ?? '') + p.delta; value.streamed = true;
          if (Buffer.byteLength(value.arguments) > 120 * 1024) throw failure('RESPONSE_LIMIT', 'The provider exceeded the tool argument limit.');
        } else if (typeof p.arguments !== 'string' || value.streamed && value.arguments !== p.arguments) throw failure('INVALID_RESPONSE', 'The provider changed streamed function arguments.');
        else value.arguments = p.arguments;
      }
      else if (p.type === 'response.output_text.annotation.added') annotations([p.annotation]);
      else if (p.type === 'response.incomplete') throw failure('INCOMPLETE', 'The provider reached its output limit before completing.');
      else if (p.type === 'response.completed') {
        if (p.response?.status !== 'completed' || !Array.isArray(p.response.output)) throw failure('INVALID_RESPONSE', 'The provider returned an invalid completion.');
        for (const value of p.response.output) item(value);
        if (!roundContent) for (const value of p.response.output) if (value.type === 'message') for (const part of value.content) emit(part.text ?? part.refusal ?? '');
        output = p.response.output;
        const calls = output.filter(value => value.type === 'function_call');
        for (const value of calls) {
          if (typeof value.id !== 'string' || !value.id || value.id.length > 256 || /[\x00-\x20\x7f]/.test(value.id)) throw failure('INVALID_RESPONSE', 'The provider returned an invalid function item.');
          if (value.status !== undefined && value.status !== 'completed') throw failure('INVALID_RESPONSE', 'The provider returned an incomplete function call.');
          const prior = functionItems.get(value.id);
          if (prior && (prior.name !== value.name || prior.call_id !== value.call_id || (prior.streamed || prior.done) && prior.arguments !== value.arguments)) throw failure('INVALID_RESPONSE', 'The provider changed its completed function call.');
        }
        if ([...functionItems.keys()].some(id => !calls.some(value => value.id === id))) throw failure('INVALID_RESPONSE', 'The provider omitted a pending function call.');
        validateCalls(calls.map(value => ({ id: value.call_id, name: value.name, arguments: value.arguments })), session);
        // A completed answer does not prove every attempted tool succeeded.
        // Leave unresolved activity for the host's terminal-state settlement.
        complete = true;
      } else if (typeof p.type !== 'string') throw failure('INVALID_RESPONSE', 'The provider returned an untyped stream event.');
    } else {
      chatTurn.record(p);
      const count = p.usage?.server_tool_use?.web_search_requests;
      if (count !== undefined) { if (!Number.isInteger(count) || count < 0 || count > (selected.has('web_search') ? 2 - searchCount : 0)) throw failure('RESPONSE_LIMIT', 'The provider exceeded the configured search limit.'); roundSearchCount = Math.max(roundSearchCount, count); }
    }
    return complete;
  };
  try {
    createTransport(transportOptions); // Validate the configured deadlines before the loop.
    for (let round = 0; round < 13; round++) {
      check(); complete = false; roundContent = ''; roundSearchCount = 0; output = []; functionItems.clear();
      if (round) telemetry.nextRound();
      chatTurn = createChatTurn({ session, emit, annotations });
      if (provider === 'openrouter' && selected.has('web_search')) {
        const remaining = 2 - searchCount;
        if (!remaining) { payload.tools = payload.tools.filter(tool => tool.type !== 'openrouter:web_search'); delete payload.max_tool_calls; }
        else { payload.max_tool_calls = remaining; payload.tools.find(tool => tool.type === 'openrouter:web_search').parameters.max_uses = remaining; }
      }
      const body = JSON.stringify(payload);
      if (Buffer.byteLength(body) > REQUEST_LIMIT) throw failure('INVALID_REQUEST', 'Chat history exceeded the request size limit.');
      await createTransport({ ...transportOptions, totalMs: Math.max(1, totalMs - clock.elapsedMs()) })(BASES[provider] + (provider === 'xai' ? '/responses' : '/chat/completions'), { headers: { Authorization: `Bearer ${apiKey}` }, body, signal, onText: sseParser(record) });
      check(); if (!complete) throw failure('EARLY_EOF', 'The provider closed the response before completion.');
      searchCount += roundSearchCount;
      const result = provider === 'xai' ? { calls: output.filter(value => value.type === 'function_call').map(value => ({ id: value.call_id, name: value.name, arguments: value.arguments })) } : chatTurn.result();
      if (!result.calls.length) break;
      if (round === 12) throw failure('RESPONSE_LIMIT', 'The provider exceeded the local tool continuation limit.');
      if (provider === 'xai') input.push(...output); else input.push(result.message);
      for (const call of result.calls) {
        const output = await session.execute({ ...call, arguments: parseJSON(call.arguments) }); check();
        input.push(provider === 'xai' ? { type: 'function_call_output', call_id: call.id, output } : { role: 'tool', tool_call_id: call.id, content: output });
      }
    }
    if (provider === 'openrouter' && selected.has('web_search') && (searchCount || sources.size)) status('openrouter_web_search', 'web_search', 'complete', searchCount ? `${searchCount} searches completed` : 'Search sources returned');
    const remaining = [...sources.keys()].filter(url => !content.includes(url));
    if (remaining.length) emit('\n\nSources:\n' + remaining.map((url, i) => `[${i + 1}](<${url}>)`).join('\n'));
    metadata.publish();
    return content;
  } catch (error) {
    // Preserve the transport's sanitized failure; status must not expose its cause.
    if (!signal?.aborted) for (const [id, value] of observed) if (value.status === 'running') { try { status(id, value.kind, 'error', 'The hosted-tool request did not complete.'); } catch {} }
    throw error;
  }
}

module.exports = { streamHostedRouting, ROUTING_HOSTED_CAPABILITIES, routingHostedCapabilities };
