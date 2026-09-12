const MODEL_LIMIT = 1024 * 1024;
const WIRE_LIMIT = 4 * 1024 * 1024;
const TEXT_LIMIT = 2 * 1024 * 1024;
const REQUEST_LIMIT = 12 * 1024 * 1024;
const trustedErrors = new WeakSet();
function failure(code, message) {
  const error = Object.assign(new Error(message), { code });
  trustedErrors.add(error); return error;
}
function object(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function parseJSON(text) {
  try { return JSON.parse(text); } catch { throw failure('INVALID_RESPONSE', 'The provider returned malformed JSON.'); }
}
function cancel(body) { try { body?.cancel().catch(() => {}); } catch { /* Already closed or locked. */ } }

// Own deadlines also cover transports that ignore AbortSignal. Do not expose
// fetch errors: their message/cause may contain URLs, headers or request bodies.
function createTransport({ fetchImpl = globalThis.fetch, idleMs = 90000, totalMs = 600000 } = {}) {
  if (typeof fetchImpl !== 'function' || !Number.isFinite(idleMs) || idleMs <= 0 || !Number.isFinite(totalMs) || totalMs <= 0) throw new TypeError('A fetch implementation and positive request deadlines are required.');
  return async function consume(url, { headers, body, signal, maxBytes = WIRE_LIMIT, onText, onBytes }) {
    if ((typeof onText === 'function') === (typeof onBytes === 'function')) throw new TypeError('Provide exactly one text or binary response consumer.');
    const controller = new AbortController();
    let response, reader, reason, idleTimer, totalTimer, rejectAbort;
    const aborted = new Promise((_resolve, reject) => { rejectAbort = reject; }); aborted.catch(() => {});
    const abort = error => { if (!reason) { reason = error; rejectAbort(error); controller.abort(error); } };
    const externalAbort = () => abort(failure('ABORTED', 'The provider request was stopped.'));
    const check = () => { if (reason) throw reason; };
    const refresh = () => { clearTimeout(idleTimer); idleTimer = setTimeout(() => abort(failure('IDLE_TIMEOUT', 'The provider stopped responding.')), idleMs); };
    const wait = promise => Promise.race([promise, aborted]);
    if (signal?.aborted) externalAbort(); else signal?.addEventListener('abort', externalAbort, { once: true });
    refresh(); totalTimer = setTimeout(() => abort(failure('TOTAL_TIMEOUT', 'The provider exceeded the request time limit.')), totalMs);
    try {
      check();
      const pending = Promise.resolve(fetchImpl(url, {
        method: body === undefined ? 'GET' : 'POST', headers: { ...headers, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        ...(body === undefined ? {} : { body }), signal: controller.signal,
        redirect: 'manual', credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store',
      }));
      pending.then(late => { if (controller.signal.aborted) cancel(late?.body); }, () => {});
      response = await wait(pending); check(); refresh();
      if (response.redirected || (response.status >= 300 && response.status < 400)) throw failure('REDIRECT', 'Provider endpoint redirects are not allowed.');
      if (!Number.isInteger(response.status) || response.status < 100 || response.status > 599) throw failure('INVALID_RESPONSE', 'The provider returned an invalid HTTP status.');
      if (response.status !== 200) {
        const help = response.status === 401 || response.status === 403 ? ' Check the API key and account permissions.' : response.status === 429 ? ' Check account quota or try again later.' : '';
        throw failure('HTTP_ERROR', `The provider returned HTTP ${response.status}.${help}`);
      }
      if (!response.body || typeof response.body.getReader !== 'function') throw failure('INVALID_RESPONSE', 'The provider returned no response body.');
      reader = response.body.getReader(); const decoder = new TextDecoder('utf-8', { fatal: true }); let bytes = 0;
      while (true) {
        check(); const next = await wait(reader.read()); check();
        let text;
        if (next.done) {
          if (onBytes) { check(); return; }
          try { text = decoder.decode(); } catch { throw failure('INVALID_RESPONSE', 'The provider returned invalid UTF-8.'); }
          onText(text, true); check(); return;
        }
        if (!(next.value instanceof Uint8Array)) throw failure('INVALID_RESPONSE', 'The provider returned an invalid response chunk.');
        bytes += next.value.byteLength;
        if (bytes > maxBytes) throw failure('RESPONSE_LIMIT', 'The provider response exceeded the size limit.');
        if (next.value.byteLength) refresh();
        if (onBytes) { const done = onBytes(next.value); check(); if (done === true) return; continue; }
        try { text = decoder.decode(next.value, { stream: true }); } catch { throw failure('INVALID_RESPONSE', 'The provider returned invalid UTF-8.'); }
        const done = onText(text, false); check(); if (done === true) return;
      }
    } catch (error) {
      check();
      if (trustedErrors.has(error)) throw error;
      throw failure('NETWORK_ERROR', 'Could not communicate with the provider. Check the endpoint and network connection.');
    } finally {
      cancel(reader || response?.body); clearTimeout(idleTimer); clearTimeout(totalTimer);
      signal?.removeEventListener('abort', externalAbort); controller.abort();
    }
  };
}

// SSE is line-oriented: comments, CRLF, multiline data and chunk boundaries
// must not become JSON boundaries. Only a protocol terminal event completes.
function sseParser(onEvent) {
  let pending = '', data = [], event = '', complete = false;
  const dispatch = () => {
    if (!data.length) { event = ''; return; }
    if (complete) throw failure('INVALID_RESPONSE', 'The provider sent data after completion.');
    complete = onEvent(data.join('\n'), event) === true; data = []; event = '';
  };
  const line = value => {
    if (!value) { dispatch(); return; }
    if (value.startsWith(':')) return;
    const colon = value.indexOf(':'); const field = colon < 0 ? value : value.slice(0, colon);
    let text = colon < 0 ? '' : value.slice(colon + 1); if (text.startsWith(' ')) text = text.slice(1);
    if (field === 'data') data.push(text); else if (field === 'event') event = text;
  };
  return (text, ended) => {
    pending += text;
    while (true) {
      const match = /[\r\n]/.exec(pending); if (!match) break;
      const i = match.index;
      if (pending[i] === '\r' && i === pending.length - 1 && !ended) break;
      const width = pending[i] === '\r' && pending[i + 1] === '\n' ? 2 : 1;
      const value = pending.slice(0, i); pending = pending.slice(i + width); line(value);
    }
    // An unterminated SSE frame is truncated, even when its JSON looks valid.
    if (ended && (pending.trim() || data.length)) throw failure('EARLY_EOF', 'The provider closed an incomplete stream event.');
    if (complete && (pending.trim() || data.length)) throw failure('INVALID_RESPONSE', 'The provider sent data after completion.');
    return complete;
  };
}

module.exports = { createTransport, sseParser, failure, object, parseJSON, MODEL_LIMIT, WIRE_LIMIT, TEXT_LIMIT, REQUEST_LIMIT };
