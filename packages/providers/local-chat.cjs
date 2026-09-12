const { createTransport, sseParser, failure, object, parseJSON, TEXT_LIMIT, REQUEST_LIMIT } = require('./transport.cjs');
const { createToolSession } = require('./local-tools.cjs');
const { createActiveClock } = require('./active-clock.cjs');
const { createTelemetry } = require('./usage.cjs');
const CALL_LIMIT = 120 * 1024;

// Validate the entire terminal batch before any mutation is dispatched.
function validateCalls(calls, session) {
  if (calls.length > 12) throw failure('RESPONSE_LIMIT', 'The provider exceeded the local tool-call limit.');
  const ids = new Map();
  for (const call of calls) {
    if (typeof call.id !== 'string' || !call.id || call.id.length > 256 || /[\x00-\x20\x7f]/.test(call.id) || typeof call.name !== 'string' || !session.has(call.name)) throw failure('UNSUPPORTED_OUTPUT', 'The provider requested an unavailable local tool.');
    if (typeof call.arguments !== 'string' || Buffer.byteLength(call.arguments) > CALL_LIMIT || !object(parseJSON(call.arguments))) throw failure('INVALID_RESPONSE', 'The provider returned invalid tool arguments.');
    const signature = JSON.stringify([call.name, call.arguments]);
    if (ids.has(call.id) && ids.get(call.id) !== signature) throw failure('INVALID_RESPONSE', 'The provider changed a tool identifier.');
    ids.set(call.id, signature);
  }
  session.preflight(calls.map(c=>({...c,arguments:parseJSON(c.arguments)})));
}

// Chat Completions sends function argument fragments by index; no callback may
// execute these fragments until finish_reason=tool_calls AND [DONE] arrive.
function createChatTurn({ session, emit, annotations = () => {} }) {
  const calls = new Map(), details = new Map(), citations = [];
  const annotate = list => {
    annotations(list);
    if (list === undefined) return;
    if (!Array.isArray(list) || citations.length + list.length > 1000) throw failure('INVALID_RESPONSE', 'The provider returned invalid source annotations.');
    citations.push(...list);
  };
  let finished, complete = false, content = '', reasoning = '', reasoningContent = '', detailBytes = 0;
  const add = delta => {
    if (delta.function_call !== undefined || delta.tool_calls !== undefined && !session.enabled) throw failure('UNSUPPORTED_OUTPUT', 'Client function execution is not enabled in this chat.');
    if (delta.tool_calls !== undefined) {
      if (!Array.isArray(delta.tool_calls) || delta.tool_calls.length > 12) throw failure('INVALID_RESPONSE', 'The provider returned invalid tool calls.');
      for (const part of delta.tool_calls) {
        if (!object(part) || !Number.isInteger(part.index) || part.index < 0 || part.index >= 12 || part.type !== undefined && part.type !== 'function' || part.function !== undefined && !object(part.function)) throw failure('INVALID_RESPONSE', 'The provider returned an invalid tool delta.');
        let value = calls.get(part.index);
        if (!value) { value = { id: '', type: 'function', function: { name: '', arguments: '' } }; calls.set(part.index, value); }
        for (const [field, target] of [['id', value], ['name', value.function], ['arguments', value.function]]) {
          const fragment = field === 'id' ? part.id : part.function?.[field];
          if (fragment === undefined || fragment === null) continue;
          if (typeof fragment !== 'string') throw failure('INVALID_RESPONSE', 'The provider returned invalid tool text.');
          target[field] += fragment;
          if (Buffer.byteLength(target[field]) > (field === 'arguments' ? CALL_LIMIT : 256)) throw failure('RESPONSE_LIMIT', 'The provider exceeded the tool argument limit.');
        }
      }
    }
    if (delta.reasoning_details !== undefined) {
      if (!Array.isArray(delta.reasoning_details) || delta.reasoning_details.length > 1000) throw failure('INVALID_RESPONSE', 'The provider returned invalid reasoning details.');
      detailBytes += Buffer.byteLength(JSON.stringify(delta.reasoning_details));
      if (detailBytes > TEXT_LIMIT) throw failure('RESPONSE_LIMIT', 'The provider exceeded the reasoning limit.');
      for (const part of delta.reasoning_details) {
        if (!object(part) || typeof part.type !== 'string' || part.index !== undefined && (!Number.isInteger(part.index) || part.index < 0 || part.index > 1000)) throw failure('INVALID_RESPONSE', 'The provider returned invalid reasoning details.');
        const key = part.index ?? part.id ?? details.size;
        const prior = details.get(key);
        if (!prior) details.set(key, { ...part });
        else {
          for (const field of ['type', 'id', 'format']) if (part[field] !== undefined && prior[field] !== undefined && part[field] !== prior[field]) throw failure('INVALID_RESPONSE', 'The provider changed a reasoning identifier.');
          for (const [field, value] of Object.entries(part)) {
            if (['text', 'summary', 'data', 'signature'].includes(field) && typeof value === 'string') prior[field] = (prior[field] ?? '') + value;
            else prior[field] = value;
          }
        }
      }
    }
    const text = delta.content ?? '', thinking = delta.reasoning_content ?? delta.reasoning ?? '';
    emit(text, thinking); content += text;
    if (typeof delta.reasoning === 'string') reasoning += delta.reasoning;
    if (typeof delta.reasoning_content === 'string') reasoningContent += delta.reasoning_content;
    annotate(delta.annotations);
  };
  return {
    record(p) {
      if (!Array.isArray(p.choices) || p.choices.length > 1) throw failure('INVALID_RESPONSE', 'The provider returned invalid chat choices.');
      for (const c of p.choices) {
        if (!object(c) || !object(c.delta) || c.index !== undefined && c.index !== 0) throw failure('INVALID_RESPONSE', 'The provider returned an invalid chat delta.');
        if (finished && (c.delta.content || c.delta.reasoning || c.delta.reasoning_content || c.delta.tool_calls !== undefined || c.delta.reasoning_details !== undefined || c.finish_reason)) throw failure('INVALID_RESPONSE', 'The provider sent content after its finish reason.');
        add(c.delta);
        if (c.finish_reason) {
          if (c.finish_reason === 'length') throw failure('INCOMPLETE', 'The provider reached its output limit before completing.');
          if (!['stop', 'tool_calls'].includes(c.finish_reason)) throw failure('PROVIDER_ERROR', 'The provider stopped before completing this response.');
          if (c.finish_reason === 'tool_calls' && !session.enabled) throw failure('UNSUPPORTED_OUTPUT', 'Client function execution is not enabled in this chat.');
          finished = c.finish_reason;
        }
      }
      annotate(p.annotations);
    },
    done() {
      if (!finished) throw failure('EARLY_EOF', 'The provider ended before a finish reason.');
      if ((finished === 'tool_calls') !== Boolean(calls.size)) throw failure('INVALID_RESPONSE', 'The provider returned an inconsistent tool completion.');
      validateCalls([...calls.values()].map(c => ({ id: c.id, ...c.function })), session);
      complete = true; return true;
    },
    result() {
      if (!complete) throw failure('EARLY_EOF', 'The provider closed the response before completion.');
      const toolCalls = [...calls.entries()].sort((a, b) => a[0] - b[0]).map(([, c]) => c);
      return { calls: toolCalls.map(c => ({ id: c.id, ...c.function })), message: { role: 'assistant', content: content || null, ...(citations.length ? { annotations: citations } : {}), ...(toolCalls.length ? { tool_calls: toolCalls } : {}), ...(details.size ? { reasoning_details: [...details.values()] } : {}), ...(reasoning ? { reasoning } : {}), ...(reasoningContent ? { reasoning_content: reasoningContent } : {}) } };
    },
  };
}
function chatImage(data) {
  if (typeof data !== 'string' || data.length > 1398104 || data.length % 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) throw failure('INVALID_REQUEST', 'Chat images must be valid PNG, JPEG, or WebP data.');
  const b = Buffer.from(data, 'base64');
  const mime = b.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) ? 'image/png' : b[0] === 255 && b[1] === 216 && b[2] === 255 ? 'image/jpeg' : b.toString('ascii',0,4) === 'RIFF' && b.toString('ascii',8,12) === 'WEBP' ? 'image/webp' : undefined;
  if (!mime) throw failure('INVALID_REQUEST', 'Chat images must be PNG, JPEG, or WebP.');
  return { type: 'image_url', image_url: { url: `data:${mime};base64,${data}` } };
}
async function streamLocalChat(provider, { apiKey, ...options }, request) {
  const { model, messages, signal, onDelta, onUsage, onModel } = request;
  if (!['vllm', 'groq', 'openai'].includes(provider) || request.tools?.length) throw failure('UNSUPPORTED_TOOL', 'This route supports local function tools only.');
  const base = request.baseUrl ?? ({ groq: 'https://api.groq.com/openai/v1', openai: 'https://api.openai.com/v1', vllm: 'http://localhost:8000/v1' })[provider];
  let url; try { url = new URL(base); } catch { throw failure('INVALID_ENDPOINT', 'Enter a valid provider endpoint.'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw failure('INVALID_ENDPOINT', 'Enter a valid provider endpoint.');
  if (provider !== 'vllm' && !apiKey || apiKey !== undefined && (typeof apiKey !== 'string' || apiKey.length > 8192 || /[\s\x00-\x1f\x7f]/.test(apiKey))) throw failure('INVALID_API_KEY', 'Enter a valid API key.');
  if (typeof model !== 'string' || !model.trim() || model.length > 512 || typeof onDelta !== 'function' || !Array.isArray(messages) || !messages.length || messages.length > 10000 || !messages.every(m => object(m) && ['system','user','assistant'].includes(m.role) && typeof m.content === 'string' && (m.images === undefined || m.role === 'user' && Array.isArray(m.images) && m.images.length <= 10))) throw failure('INVALID_REQUEST', 'Chat requires a model and valid messages.');
  const clock = createActiveClock(request.onLocalTool?.userWait), totalMs = options.totalMs ?? 600000;
  const check = () => { if (signal?.aborted) throw failure('ABORTED', 'The provider request was stopped.'); if (clock.elapsedMs() >= totalMs) throw failure('TOTAL_TIMEOUT', 'The provider exceeded the request time limit.'); };
  const session = createToolSession(request.localTools, request.onLocalTool, check, { signal, totalMs: options.totalMs });
  const telemetry = createTelemetry({ onUsage, onModel });
  const history = messages.map(m => ({ role: m.role, content: m.images?.length ? [{ type: 'text', text: m.content }, ...m.images.map(chatImage)] : m.content }));
  let content = '', bytes = 0;
  const emit = (text, thinking) => {
    if (typeof text !== 'string' || typeof thinking !== 'string') throw failure('INVALID_RESPONSE', 'The provider returned invalid text.');
    bytes += Buffer.byteLength(text) + Buffer.byteLength(thinking);
    if (bytes > TEXT_LIMIT) throw failure('RESPONSE_LIMIT', 'The provider generated more than 2 MiB of text.');
    check(); content += text; if (text || thinking) onDelta({ content: text, thinking }); check();
  };
  createTransport(options); // Validate the configured deadlines before the loop.
  for (let round = 0; round < 13; round++) {
    check(); if (round) telemetry.nextRound();
    const turn = createChatTurn({ session, emit });
    const payload = { model, stream: true, ...(provider === 'openai' ? { store: false, stream_options: { include_usage: true } } : {}), ...(request.outputLimit ?? (provider === 'groq' ? {} : { max_tokens: request.maxTokens ?? 2048 })), messages: history, tools: session.definitions.map(tool => ({ type: 'function', function: tool })), tool_choice: 'auto', parallel_tool_calls: false };
    const body = JSON.stringify(payload);
    if (Buffer.byteLength(body) > REQUEST_LIMIT) throw failure('INVALID_REQUEST', 'Chat history exceeded the request size limit.');
    await createTransport({ ...options, totalMs: Math.max(1, totalMs - clock.elapsedMs()) })(base.replace(/\/$/, '') + '/chat/completions', { headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {}, body, signal, onText: sseParser((wire, event) => {
      check(); if (wire === '[DONE]') return turn.done();
      const p = parseJSON(wire);
      if (!object(p)) throw failure('INVALID_RESPONSE', 'The provider returned an invalid stream event.');
      if (p.error !== undefined || event === 'error') throw failure('PROVIDER_ERROR', 'The provider could not complete the tool request.');
      telemetry.observe('chat', p); turn.record(p);
    }) });
    check(); const result = turn.result();
    if (!result.calls.length) return content;
    if (round === 12) throw failure('RESPONSE_LIMIT', 'The provider exceeded the local tool continuation limit.');
    history.push(result.message);
    for (const call of result.calls) { const output = await session.execute({ ...call, arguments: parseJSON(call.arguments) }); check(); history.push({ role: 'tool', tool_call_id: call.id, content: output }); }
  }
}
module.exports = { streamLocalChat, createChatTurn, validateCalls };
