const { createTelemetry } = require('./usage.cjs');
const { createActiveClock } = require('./active-clock.cjs');
const TEXT_LIMIT = 2 * 1024 * 1024;
const WIRE_LIMIT = 4 * 1024 * 1024;
const REQUEST_LIMIT = 12 * 1024 * 1024;
const MODEL_LIMIT = 1024 * 1024;
const TOOL_JSON_LIMIT = 120 * 1024;
const TOOL_CALL_LIMIT = 4;

function failure(code, message) { return Object.assign(new Error(message), { code }); }
function object(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }

function normalizeBaseUrl(value) {
  try {
    if (typeof value !== 'string' || value.length > 2048 || /[\s\\?#]/.test(value)) throw new Error();
    const authority = value.match(/^https?:\/\/([^/]+)/i)?.[1];
    if (!authority || authority.includes('@')) throw new Error();
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password || url.search || url.hash) throw new Error();
    return url.href.replace(/\/+$/, '');
  } catch { throw failure('INVALID_ENDPOINT', 'Enter an HTTP or HTTPS Ollama endpoint without credentials, query, or fragment.'); }
}

// Race both connection and body reads against our own abort promise. This also
// bounds callers whose fetch implementation is slow to act on AbortSignal.
function requestScope(signal, idleMs, totalMs, userWait) {
  const clock = createActiveClock(userWait);
  const controller = new AbortController();
  let rejectAbort, idleTimer, totalTimer, reason;
  const aborted = new Promise((_resolve, reject) => { rejectAbort = reject; });
  aborted.catch(() => {});
  const abort = (error) => {
    if (reason) return;
    reason = error; rejectAbort(error); controller.abort(error);
  };
  const externalAbort = () => abort(failure('ABORTED', 'Ollama request was stopped.'));
  const refresh = () => {
    idleTimer?.();
    idleTimer = clock.timeout(() => abort(failure('IDLE_TIMEOUT', 'Ollama stopped responding.')), idleMs);
  };
  if (signal?.aborted) externalAbort();
  else signal?.addEventListener('abort', externalAbort, { once: true });
  refresh();
  totalTimer = clock.timeout(() => abort(failure('TOTAL_TIMEOUT', 'Ollama exceeded the request time limit.')), totalMs);
  return {
    signal: controller.signal,
    refresh,
    check() { if (reason) throw reason; },
    wait(promise) { return Promise.race([promise, aborted]); },
    close() {
      idleTimer?.(); totalTimer?.();
      signal?.removeEventListener('abort', externalAbort);
      controller.abort();
    },
  };
}

function cancel(bodyOrReader) {
  try { bodyOrReader?.cancel().catch(() => {}); } catch { /* A closed or locked body needs no further cleanup. */ }
}

function parseJSON(text) {
  try { return JSON.parse(text); }
  catch { throw failure('INVALID_RESPONSE', 'Ollama returned malformed JSON.'); }
}

function createOllamaProvider({ fetchImpl = globalThis.fetch, idleMs = 90000, totalMs = 600000 } = {}) {
  if (typeof fetchImpl !== 'function' || !Number.isFinite(idleMs) || idleMs <= 0 || !Number.isFinite(totalMs) || totalMs <= 0) {
    throw new TypeError('Ollama requires fetch and positive request deadlines.');
  }

  async function consume(baseUrl, route, { signal, body, maxBytes, onText, sharedScope, onBytes }) {
    const url = normalizeBaseUrl(baseUrl) + route;
    const scope = sharedScope || requestScope(signal, idleMs, totalMs);
    let response, reader;
    try {
      scope.check();
      const pendingFetch = Promise.resolve(fetchImpl(url, {
        method: body === undefined ? 'GET' : 'POST',
        ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body }),
        signal: scope.signal, redirect: 'manual', credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store',
      }));
      // A late response from an abort-insensitive fetch must not retain a body.
      pendingFetch.then((lateResponse) => { if (scope.signal.aborted) cancel(lateResponse?.body); }, () => {});
      response = await scope.wait(pendingFetch);
      scope.check(); scope.refresh();
      if (response.redirected || (response.status >= 300 && response.status < 400)) throw failure('REDIRECT', 'Ollama endpoint redirects are not allowed.');
      if (response.status !== 200) throw failure('HTTP_ERROR', `Ollama returned HTTP ${response.status}.`);
      if (!response.body || typeof response.body.getReader !== 'function') throw failure('INVALID_RESPONSE', 'Ollama returned no response body.');
      reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8', { fatal: true });
      let bytes = 0;
      while (true) {
        scope.check();
        const next = await scope.wait(reader.read());
        scope.check();
        if (next.done) {
          let finalText;
          try { finalText = decoder.decode(); } catch { throw failure('INVALID_RESPONSE', 'Ollama returned invalid UTF-8.'); }
          onText(finalText, true); scope.check(); return;
        }
        if (!(next.value instanceof Uint8Array)) throw failure('INVALID_RESPONSE', 'Ollama returned an invalid response chunk.');
        bytes += next.value.byteLength;
        if (bytes > maxBytes) throw failure('RESPONSE_LIMIT', 'Ollama response exceeded the size limit.');
        onBytes?.(next.value.byteLength);
        if (next.value.byteLength) scope.refresh();
        let text;
        try { text = decoder.decode(next.value, { stream: true }); }
        catch { throw failure('INVALID_RESPONSE', 'Ollama returned invalid UTF-8.'); }
        const complete = onText(text, false);
        scope.check();
        if (complete === true) return;
      }
    } catch (error) {
      scope.check();
      throw error;
    } finally {
      cancel(reader || response?.body);
      if (!sharedScope) scope.close();
    }
  }

  async function listModels(baseUrl) {
    let text = '';
    await consume(baseUrl, '/api/tags', { maxBytes: MODEL_LIMIT, onText(chunk) { text += chunk; } });
    const payload = parseJSON(text);
    if (object(payload) && Object.hasOwn(payload, 'error')) throw failure('PROVIDER_ERROR', 'Ollama could not list models.');
    if (!object(payload) || !Array.isArray(payload.models) || payload.models.length > 1000 ||
      !payload.models.every((model) => object(model) && typeof model.name === 'string' && model.name.trim().length > 0 && model.name.length <= 512)) {
      throw failure('INVALID_RESPONSE', 'Ollama returned an invalid model list.');
    }
    return [...new Set(payload.models
      .filter((model) => !Array.isArray(model.capabilities) || model.capabilities.includes('completion'))
      .map((model) => model.name))];
  }

  async function supportsImages(baseUrl,model){
    let text='';await consume(baseUrl,'/api/show',{body:JSON.stringify({model}),maxBytes:MODEL_LIMIT,onText(chunk){text+=chunk}});
    const data=parseJSON(text);return Array.isArray(data?.capabilities)&&data.capabilities.includes('vision');
  }

  // Cache completed metadata only: a caller's cancellation must not poison
  // another caller's lookup. Expiry also lets replaced model tags gain tools.
  const toolCapabilities = new Map();
  async function supportsLocalTools(baseUrl, model, { signal } = {}) {
    if (signal?.aborted) throw failure('ABORTED', 'Ollama request was stopped.');
    if (typeof model !== 'string' || !model.trim() || model.length > 512) throw failure('INVALID_REQUEST', 'Ollama requires a model.');
    const endpoint = normalizeBaseUrl(baseUrl);
    const key = JSON.stringify([endpoint, model]);
    const cached = toolCapabilities.get(key);
    if (cached && cached.expires > Date.now()) return cached.supported;
    let text = '';
    await consume(endpoint, '/api/show', { signal, body: JSON.stringify({ model }), maxBytes: MODEL_LIMIT, onText(chunk) { text += chunk; } });
    if (signal?.aborted) throw failure('ABORTED', 'Ollama request was stopped.');
    const payload = parseJSON(text);
    if (object(payload) && Object.hasOwn(payload, 'error')) throw failure('PROVIDER_ERROR', 'Ollama could not inspect the model.');
    if (!object(payload) || (payload.capabilities !== undefined && (!Array.isArray(payload.capabilities) || !payload.capabilities.every(value => typeof value === 'string')))) {
      throw failure('INVALID_RESPONSE', 'Ollama returned invalid model capabilities.');
    }
    const supported = payload.capabilities?.includes('tools') || false;
    if (toolCapabilities.size >= 128) toolCapabilities.delete(toolCapabilities.keys().next().value);
    toolCapabilities.set(key, { supported, expires: Date.now() + 5 * 60 * 1000 });
    return supported;
  }

  async function streamChat({ baseUrl, model, messages, signal, onDelta, onUsage, onModel, localTools, onLocalTool }) {
    if (typeof model !== 'string' || !model.trim() || model.length > 512 || !Array.isArray(messages) || messages.length === 0 ||
      !messages.every((message) => object(message) && ['system', 'user', 'assistant'].includes(message.role) && typeof message.content === 'string' &&
        Object.keys(message).every((key) => ['role', 'content', 'images'].includes(key)) &&
        (message.images===undefined || message.role==='user'&&Array.isArray(message.images)&&message.images.length<=10&&message.images.every(image=>typeof image==='string'&&image.length<=1398104&&image.length%4===0&&/^[A-Za-z0-9+/]+={0,2}$/.test(image)))) || typeof onDelta !== 'function') {
      throw failure('INVALID_REQUEST', 'Ollama chat requires a model and text messages.');
    }
    if (localTools !== undefined && (!Array.isArray(localTools) || localTools.length > 64 || !localTools.every(tool =>
      object(tool) && typeof tool.name === 'string' && /^[A-Za-z_][A-Za-z0-9_-]{0,63}$/.test(tool.name) &&
      typeof tool.description === 'string' && tool.description.length <= 8000 &&
      object(tool.parameters) && tool.parameters.type === 'object') || new Set(localTools.map(tool => tool.name)).size !== localTools.length)) {
      throw failure('INVALID_REQUEST', 'Ollama requires valid, uniquely named local tools.');
    }
    const hasTools = Boolean(localTools?.length);
    if (hasTools && typeof onLocalTool !== 'function') throw failure('INVALID_REQUEST', 'Ollama local tools require an executor.');
    let tools;
    if (hasTools) {
      // Snapshot only the function declaration; callers cannot alter the allowlist
      // or advertised schema while generation is in progress.
      try {
        const json = JSON.stringify(localTools.map(({ name, description, parameters }) => ({ type: 'function', function: { name, description, parameters } })));
        if (Buffer.byteLength(json, 'utf8') > TOOL_JSON_LIMIT) throw new Error();
        tools = JSON.parse(json);
      } catch { throw failure('INVALID_REQUEST', 'Ollama tool definitions exceeded the JSON limit.'); }
    }
    const allowedNames = new Set(tools?.map(tool => tool.function.name));
    const history = messages.map(({ role, content, images }) => ({ role, content, ...(images?.length ? { images: [...images] } : {}) }));
    const telemetry=createTelemetry({onUsage,onModel});
    let textBytes = 0, wireBytes = 0, executedCalls = 0;
    // One scope spans network rounds AND execution, so callbacks cannot evade
    // the deadline or schedule another dispatch after cancellation.
    const scope = hasTools ? requestScope(signal, idleMs, totalMs, onLocalTool?.userWait) : undefined;
    try {
      while (true) {
        scope?.check();
        const body = JSON.stringify({ model, messages: history, stream: true, options: { num_predict: hasTools ? 8192 : 2048 }, ...(hasTools ? { tools } : {}) });
        if (Buffer.byteLength(body, 'utf8') > REQUEST_LIMIT) throw failure('INVALID_REQUEST', 'Chat history exceeded the request size limit.');
        let pending = '', complete = false, doneReason;
        const assistant = { role: 'assistant', content: '', thinking: '', tool_calls: [] };
        const record = (line) => {
          scope?.check();
          if (signal?.aborted) throw failure('ABORTED', 'Ollama request was stopped.');
          if (!line.trim()) return;
          if (complete) throw failure('INVALID_RESPONSE', 'Ollama sent data after the completion record.');
          const payload = parseJSON(line);
          if (object(payload) && Object.hasOwn(payload, 'error')) throw failure('PROVIDER_ERROR', 'Ollama could not generate a response.');
          if (!object(payload) || typeof payload.done !== 'boolean' || (!payload.done && !object(payload.message)) ||
            (payload.message !== undefined && (!object(payload.message) ||
              (payload.message.role !== undefined && payload.message.role !== 'assistant') ||
              (payload.message.content !== undefined && typeof payload.message.content !== 'string') ||
              (payload.message.thinking !== undefined && typeof payload.message.thinking !== 'string') ||
              (Object.hasOwn(payload.message, 'tool_calls') && (!hasTools || !Array.isArray(payload.message.tool_calls)))))) {
            throw failure('INVALID_RESPONSE', 'Ollama returned an invalid chat record.');
          }
          if (payload.message?.tool_calls) {
            if (executedCalls + assistant.tool_calls.length + payload.message.tool_calls.length > TOOL_CALL_LIMIT) throw failure('TOOL_LIMIT', 'Ollama exceeded four local tool calls.');
            for (const call of payload.message.tool_calls) {
              if (!object(call) || (call.type !== undefined && call.type !== 'function') || !object(call.function) ||
                !allowedNames.has(call.function.name) || !object(call.function.arguments)) {
                throw failure('INVALID_RESPONSE', 'Ollama returned an unknown or malformed local tool call.');
              }
              if (Buffer.byteLength(JSON.stringify(call.function.arguments), 'utf8') > TOOL_JSON_LIMIT) throw failure('RESPONSE_LIMIT', 'Ollama tool arguments exceeded 120 KiB.');
              assistant.tool_calls.push(call);
            }
          }
          telemetry.observe('ollama',payload);
          const delta = { content: payload.message?.content || '', thinking: payload.message?.thinking || '' };
          textBytes += Buffer.byteLength(delta.content, 'utf8') + Buffer.byteLength(delta.thinking, 'utf8');
          if (textBytes > TEXT_LIMIT) throw failure('RESPONSE_LIMIT', 'Ollama generated more than 2 MiB of text.');
          if (hasTools) { assistant.content += delta.content; assistant.thinking += delta.thinking; }
          if (delta.content || delta.thinking) onDelta(delta);
          if (signal?.aborted) throw failure('ABORTED', 'Ollama request was stopped.');
          complete = payload.done;
          if (complete) doneReason = payload.done_reason;
        };
        await consume(baseUrl, '/api/chat', {
          signal, body, maxBytes: WIRE_LIMIT, sharedScope: scope,
          onBytes(size) { wireBytes += size; if (wireBytes > WIRE_LIMIT) throw failure('RESPONSE_LIMIT', 'Ollama response exceeded the size limit.'); },
          onText(text, ended) {
            pending += text;
            let newline;
            while ((newline = pending.indexOf('\n')) !== -1) {
              const line = pending.slice(0, newline); pending = pending.slice(newline + 1); record(line);
            }
            if (ended) { record(pending); pending = ''; }
            if (complete && pending.trim()) throw failure('INVALID_RESPONSE', 'Ollama sent data after the completion record.');
            return complete;
          },
        });
        if (!complete) throw failure('EARLY_EOF', 'Ollama closed the response before completion.');
        if (!assistant.tool_calls.length) return;
        if (doneReason !== undefined && doneReason !== 'stop') throw failure('INVALID_RESPONSE', 'Ollama did not finish its local tool calls successfully.');
        scope.check();
        history.push(assistant);
        for (const call of assistant.tool_calls) {
          scope.check();
          executedCalls++;
          const result = await scope.wait(Promise.resolve().then(() => {
            scope.check();
            // Give the executor its own arguments so history retains the exact call.
            return onLocalTool({ name: call.function.name, arguments: JSON.parse(JSON.stringify(call.function.arguments)) });
          }));
          scope.check(); scope.refresh();
          let content;
          try {
            content = JSON.stringify(result);
            if (content === undefined || Buffer.byteLength(content, 'utf8') > TOOL_JSON_LIMIT) throw new Error();
          } catch { throw failure('INVALID_TOOL_RESULT', 'Ollama local tools must return JSON within 120 KiB.'); }
          history.push({ role: 'tool', tool_name: call.function.name, content });
        }
        telemetry.nextRound();
      }
    } finally { scope?.close(); }
  }

  return { listModels, streamChat, supportsImages, supportsLocalTools };
}

module.exports = { normalizeBaseUrl, createOllamaProvider };
