const { createTelemetry } = require('./usage.cjs');
const { createActiveClock } = require('./active-clock.cjs');
const { createToolSession, isLocalToolError } = require('./local-tools.cjs');
const { Readable } = require('node:stream');
const { BedrockClient, ListFoundationModelsCommand, ListInferenceProfilesCommand } = require('@aws-sdk/client-bedrock');
const { BedrockRuntimeClient, ConverseStreamCommand } = require('@aws-sdk/client-bedrock-runtime');
const { failure, object, MODEL_LIMIT, WIRE_LIMIT, TEXT_LIMIT, REQUEST_LIMIT } = require('./transport.cjs');

const trusted = new WeakSet();
const fail = (code, message) => { const error = failure(code, message); trusted.add(error); return error; };
const validId = value => typeof value === 'string' && value.length > 0 && value.length <= 512 && /^[a-zA-Z0-9._:-]+$/.test(value);
const strings = value => Array.isArray(value) && value.every(item => typeof item === 'string');
// Discovery describes modalities, not API compatibility. Restrict it to the
// documented Converse chat families; embeddings, legacy completion models and
// specialist Messages/Responses-only models must not appear in this picker.
// https://docs.aws.amazon.com/bedrock/latest/userguide/models-api-compatibility.html
function converseModel(id) {
  if (/(?:embed|image|audio|speech|safeguard|cyber|moderation|rerank|realtime)/i.test(id) || /^anthropic\.claude-mythos-5(?::|$)/.test(id)) return false;
  return /^(?:anthropic\.claude-(?:3|sonnet-|opus-|haiku-|fable-|mythos-)|amazon\.nova-(?:micro|lite|pro|premier|2-lite)|ai21\.jamba|cohere\.command-(?:r|a)|deepseek\.|meta\.llama[34]|mistral\.|openai\.gpt-|qwen\.|nvidia\.|minimax\.|moonshot\.|zai\.|writer\.palmyra)/.test(id);
}

// Converse streaming/tool support is independent of text/image discovery.
// Keep this allowlist to documented model versions; future families stay off.
// https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-anthropic-claude-sonnet-4-6.html
// https://docs.aws.amazon.com/nova/latest/userguide/using-converse-api.html
// https://docs.aws.amazon.com/nova/latest/nova2-userguide/using-tools.html
const toolModels = new Set([
  'anthropic.claude-sonnet-4-20250514-v1:0',
  'anthropic.claude-sonnet-4-5-20250929-v1:0', 'anthropic.claude-sonnet-4-6',
  'anthropic.claude-opus-4-1-20250805-v1:0',
  'anthropic.claude-opus-4-5-20251101-v1:0', 'anthropic.claude-opus-4-6',
  'anthropic.claude-haiku-4-5-20251001-v1:0',
  'amazon.nova-micro-v1:0', 'amazon.nova-lite-v1:0', 'amazon.nova-pro-v1:0',
  'amazon.nova-premier-v1:0', 'amazon.nova-2-lite-v1:0',
]);
const toolModel = id => validId(id) && toolModels.has(id.replace(/^(?:us|eu|apac|global|au|jp)\./, ''));
const toolId = value => typeof value === 'string' && /^[a-zA-Z0-9_.:-]{1,64}$/.test(value);
const jsonSize = value => Buffer.byteLength(JSON.stringify(value, (_key, item) => item?.type === 'Buffer' && Array.isArray(item.data) ? Buffer.from(item.data).toString('base64') : item));

function createBedrockProvider({ apiKey, idleMs = 90000, totalMs = 600000, requestHandler } = {}, normalize) {
  if (!apiKey) throw fail('MISSING_API_KEY', 'Add an Amazon Bedrock API key.');
  if (typeof apiKey !== 'string' || apiKey.length > 8192 || /[\s\x00-\x1f\x7f]/.test(apiKey)) throw fail('INVALID_API_KEY', 'Enter a valid Amazon Bedrock API key.');
  if (![idleMs, totalMs].every(value => Number.isFinite(value) && value > 0)) throw new TypeError('Positive request deadlines are required.');
  let metadata = new Map(), metadataBase;
  function connection(baseUrl) {
    const base = normalize(baseUrl);
    const match = /^https:\/\/bedrock-runtime\.([a-z]{2}(?:-[a-z]+)+-\d)\.amazonaws\.com$/.exec(base);
    if (!match) throw fail('INVALID_ENDPOINT', 'Choose an official Amazon Bedrock region.');
    return { base, region: match[1] };
  }

  // Own deadlines cover SDK transports that ignore AbortSignal. Bound raw bytes
  // before SDK JSON/EventStream decoding, and never propagate SDK errors: they
  // can contain request headers, credentials, prompt text or account details.
  async function operation(baseUrl, runtime, signal, work, userWait) {
    const clock = createActiveClock(userWait);
    const { base, region } = connection(baseUrl), controller = new AbortController();
    let client, reason, idleTimer, totalTimer, rejectAbort, rawBytes = 0, action = runtime ? 'InvokeModelWithResponseStream' : 'ListFoundationModels';
    const bodies = new Set(), aborted = new Promise((_resolve, reject) => { rejectAbort = reject; });
    aborted.catch(() => {});
    const abort = error => { if (!reason) { reason = error; rejectAbort(error); controller.abort(); for (const body of bodies) body.destroy?.(); } };
    const check = () => { if (reason) throw reason; };
    const refresh = () => { idleTimer?.(); idleTimer = clock.timeout(() => abort(fail('IDLE_TIMEOUT', 'Amazon Bedrock stopped responding.')), idleMs); };
    const externalAbort = () => abort(fail('ABORTED', 'The provider request was stopped.'));
    const wait = promise => Promise.race([promise, aborted]);
    if (signal?.aborted) externalAbort(); else signal?.addEventListener('abort', externalAbort, { once: true });
    refresh(); totalTimer = clock.timeout(() => abort(fail('TOTAL_TIMEOUT', 'Amazon Bedrock exceeded the request time limit.')), totalMs);
    try {
      check();
      const Client = runtime ? BedrockRuntimeClient : BedrockClient;
      client = new Client({
        region, endpoint: runtime ? base : `https://bedrock.${region}.amazonaws.com`,
        token: { token: apiKey }, authSchemePreference: ['httpBearerAuth'],
        // Explicitly select bearer auth: never fall back to local AWS profiles,
        // environment credentials, SSO, or instance metadata for this provider.
        httpAuthSchemeProvider: () => [{ schemeId: 'smithy.api#httpBearerAuth' }],
        credentials: async () => { throw fail('INVALID_API_KEY', 'Amazon Bedrock requires an API key.'); },
        maxAttempts: 1, requestHandler: requestHandler || { requestTimeout: idleMs, connectionTimeout: Math.min(idleMs, 30000) },
      });
      const underlying = client.config.requestHandler;
      client.config.requestHandler = {
        ...underlying,
        async handle(request, options) {
          check();
          const pending = Promise.resolve(underlying.handle(request, options));
          pending.then(result => { if (controller.signal.aborted) result?.response?.body?.destroy?.(); }, () => {});
          const result = await wait(pending); check(); refresh();
          const response = result?.response;
          if (!response || !Number.isInteger(response.statusCode)) throw fail('INVALID_RESPONSE', 'Amazon Bedrock returned an invalid HTTP response.');
          const status = response.statusCode;
          if (status !== 200) {
            response.body?.destroy?.();
            if (status >= 300 && status < 400) throw fail('REDIRECT', 'Provider endpoint redirects are not allowed.');
            const help = status === 401 || status === 403 ? ` Check the API key, selected region, model access, and bedrock:${action} permission.` : status === 429 ? ' Check account quota or try again later.' : '';
            throw fail('HTTP_ERROR', `Amazon Bedrock returned HTTP ${status}.${help}`);
          }
          const source = response.body;
          if (!source || typeof source[Symbol.asyncIterator] !== 'function') throw fail('INVALID_RESPONSE', 'Amazon Bedrock returned no response body.');
          bodies.add(source);
          response.body = Readable.from((async function* () {
            // The SDK allocates from the first four frame bytes, before CRC
            // validation. Validate declared lengths before passing bytes to it.
            const prefix = Buffer.alloc(4); let prefixBytes = 0, remaining = 0;
            try {
              for await (const chunk of source) {
                check();
                if (!(chunk instanceof Uint8Array) && typeof chunk !== 'string') throw fail('INVALID_RESPONSE', 'Amazon Bedrock returned invalid response bytes.');
                const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
                rawBytes += bytes.byteLength;
                if (rawBytes > (runtime ? WIRE_LIMIT : MODEL_LIMIT)) throw fail('RESPONSE_LIMIT', 'Amazon Bedrock exceeded the response size limit.');
                if (runtime) {
                  let offset = 0;
                  while (offset < bytes.length) {
                    if (remaining) {
                      const count = Math.min(remaining, bytes.length - offset); remaining -= count; offset += count;
                    } else {
                      const count = Math.min(4 - prefixBytes, bytes.length - offset);
                      bytes.copy(prefix, prefixBytes, offset, offset + count); prefixBytes += count; offset += count;
                      if (prefixBytes === 4) {
                        const length = prefix.readUInt32BE(0);
                        if (length < 16 || length > WIRE_LIMIT) throw fail('RESPONSE_LIMIT', 'Amazon Bedrock returned an invalid or oversized stream frame.');
                        remaining = length - 4; prefixBytes = 0;
                      }
                    }
                  }
                }
                if (bytes.length) refresh();
                yield bytes;
              }
              if (runtime && (prefixBytes || remaining)) throw fail('EARLY_EOF', 'Amazon Bedrock closed an incomplete stream frame.');
            } finally { bodies.delete(source); source.destroy?.(); }
          })());
          bodies.add(response.body);
          return result;
        },
        destroy() { underlying.destroy?.(); },
      };
      const send = async (command, name) => {
        if (name) action = name;
        check(); const result = await wait(client.send(command, { abortSignal: controller.signal })); check(); return result;
      };
      return await wait(work({ send, wait, check, signal: controller.signal }));
    } catch (error) {
      check();
      if (trusted.has(error) || isLocalToolError(error)) throw error;
      throw fail('NETWORK_ERROR', 'Could not communicate with Amazon Bedrock. Check the selected region, model access, and network connection.');
    } finally {
      idleTimer?.(); totalTimer?.(); signal?.removeEventListener('abort', externalAbort);
      controller.abort(); for (const body of bodies) body.destroy?.(); client?.destroy();
    }
  }

  async function listModels(baseUrl) {
    const { base } = connection(baseUrl);
    return operation(base, false, undefined, async ({ send }) => {
      const payload = await send(new ListFoundationModelsCommand({ byOutputModality: 'TEXT' }));
      if (!Array.isArray(payload.modelSummaries) || payload.modelSummaries.length > 1000) throw fail('INVALID_RESPONSE', 'Amazon Bedrock returned an invalid model catalog.');
      const foundations = new Map(), found = new Map();
      for (const model of payload.modelSummaries) {
        if (!object(model) || !validId(model.modelId) || !strings(model.inputModalities) || !strings(model.outputModalities) || !strings(model.inferenceTypesSupported) || !object(model.modelLifecycle) || typeof model.modelLifecycle.status !== 'string' || typeof model.responseStreamingSupported !== 'boolean') throw fail('INVALID_RESPONSE', 'Amazon Bedrock returned invalid model capabilities.');
        if (model.modelLifecycle.status !== 'ACTIVE' || !model.responseStreamingSupported || !model.inputModalities.includes('TEXT') || !model.outputModalities.includes('TEXT') || !converseModel(model.modelId)) continue;
        foundations.set(model.modelId, model);
        if (model.inferenceTypesSupported.includes('ON_DEMAND')) found.set(model.modelId, model);
      }
      let nextToken, count = 0; const cursors = new Set();
      for (let page = 0; page < 10; page++) {
        const profiles = await send(new ListInferenceProfilesCommand({ typeEquals: 'SYSTEM_DEFINED', maxResults: 100, ...(nextToken ? { nextToken } : {}) }), 'ListInferenceProfiles');
        if (!Array.isArray(profiles.inferenceProfileSummaries) || (count += profiles.inferenceProfileSummaries.length) > 1000) throw fail('INVALID_RESPONSE', 'Amazon Bedrock returned invalid inference profiles.');
        for (const profile of profiles.inferenceProfileSummaries) {
          if (!object(profile) || !validId(profile.inferenceProfileId) || !Array.isArray(profile.models) || !profile.models.length || profile.models.length > 100 || !profile.models.every(model => object(model) && typeof model.modelArn === 'string' && model.modelArn.length <= 2048) || typeof profile.status !== 'string' || typeof profile.type !== 'string') throw fail('INVALID_RESPONSE', 'Amazon Bedrock returned an invalid inference profile.');
          if (profile.status !== 'ACTIVE' || profile.type !== 'SYSTEM_DEFINED') continue;
          const ids = [...new Set(profile.models.map(model => /:foundation-model\/([^/]+)$/.exec(model.modelArn)?.[1]))];
          if (ids.length !== 1 || !foundations.has(ids[0])) continue;
          found.set(profile.inferenceProfileId, foundations.get(ids[0]));
          if (found.size > 1000) throw fail('RESPONSE_LIMIT', 'Amazon Bedrock exceeded the model count limit.');
        }
        nextToken = profiles.nextToken;
        if (nextToken === undefined || nextToken === null || nextToken === '') {
          metadata = found; metadataBase = base;
          return [...found.keys()].sort();
        }
        if (typeof nextToken !== 'string' || nextToken.length > 2048 || cursors.has(nextToken)) throw fail('INVALID_RESPONSE', 'Amazon Bedrock returned invalid model pagination.');
        cursors.add(nextToken);
      }
      throw fail('RESPONSE_LIMIT', 'Amazon Bedrock exceeded the model page limit.');
    });
  }

  async function supportsImages(baseUrl, model) {
    const { base } = connection(baseUrl);
    if (!validId(model)) return false;
    if (metadataBase !== base || !metadata.has(model)) await listModels(base);
    return metadata.get(model)?.inputModalities.includes('IMAGE') === true;
  }

  async function supportsLocalTools(baseUrl, model, { signal } = {}) {
    connection(baseUrl);
    if (signal?.aborted) throw fail('ABORTED', 'The provider request was stopped.');
    return toolModel(model);
  }

  async function streamChat({ baseUrl, model, messages, signal, onDelta, onUsage, onModel, localTools, onLocalTool }) {
    if (!validId(model) || !Array.isArray(messages) || !messages.length || messages.length > 10000 || typeof onDelta !== 'function') throw fail('INVALID_REQUEST', 'Chat requires a model and valid text messages.');
    let requestBytes = 0;
    const converted = [], system = [];
    for (const message of messages) {
      if (!object(message) || !['user', 'assistant', 'system'].includes(message.role) || typeof message.content !== 'string' || Object.keys(message).some(key => !['role', 'content', 'images'].includes(key)) || (message.images !== undefined && (message.role !== 'user' || !Array.isArray(message.images) || message.images.length > 10))) throw fail('INVALID_REQUEST', 'Chat requires valid text messages and user images.');
      requestBytes += Buffer.byteLength(message.content);
      const content = message.content ? [{ text: message.content }] : [];
      for (const data of message.images || []) {
        if (typeof data !== 'string' || data.length > 1398104 || data.length % 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) throw fail('INVALID_REQUEST', 'Chat images must be PNG, JPEG, or WebP.');
        requestBytes += data.length;
        const bytes = Buffer.from(data, 'base64');
        const format = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ? 'png' : bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 ? 'jpeg' : bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP' ? 'webp' : undefined;
        if (!format) throw fail('INVALID_REQUEST', 'Chat images must be PNG, JPEG, or WebP.');
        content.push({ image: { format, source: { bytes } } });
      }
      if (requestBytes > REQUEST_LIMIT) throw fail('INVALID_REQUEST', 'Chat history exceeded the request size limit.');
      if (message.role === 'system') { if (message.content) system.push({ text: message.content }); }
      else {
        if (!content.length) throw fail('INVALID_REQUEST', 'Chat messages cannot be empty.');
        converted.push({ role: message.role, content });
      }
    }
    if (!converted.length) throw fail('INVALID_REQUEST', 'Chat requires a user message.');
    // Model defaults avoid exceeding a model-specific output cap (for example,
    // older Llama models accept fewer tokens than modern Claude models).
    const telemetry=createTelemetry({onUsage,onModel});
    const payload = { modelId: model, messages: converted, ...(system.length ? { system } : {}) };
    // Include JSON escaping and structural overhead in the request bound.
    if (Buffer.byteLength(JSON.stringify(payload, (_key, value) => value?.type === 'Buffer' && Array.isArray(value.data) ? Buffer.from(value.data).toString('base64') : value)) > REQUEST_LIMIT) throw fail('INVALID_REQUEST', 'Chat history exceeded the request size limit.');
    return operation(baseUrl, true, signal, async ({ send, wait, check, signal: operationSignal }) => {
      const session = createToolSession(toolModel(model) ? localTools : undefined, onLocalTool, check, { signal: operationSignal, totalMs });
      if (session.enabled) {
        payload.toolConfig = { tools: session.definitions.map(({ name, description, parameters }) => ({ toolSpec: { name, description, inputSchema: { json: parameters } } })) };
        let textBytes = 0;
        // One operation owns all rounds: total deadline and raw-byte bounds must
        // not reset when the model requests another tool.
        for (let round = 0; round < 13; round++) {
          if (jsonSize(payload) > REQUEST_LIMIT) throw fail('INVALID_REQUEST', 'Chat history exceeded the request size limit.');
          const response = await send(new ConverseStreamCommand(payload));
          if (!response.stream || typeof response.stream[Symbol.asyncIterator] !== 'function') throw fail('INVALID_RESPONSE', 'Amazon Bedrock returned no response stream.');
          const iterator = response.stream[Symbol.asyncIterator]();
          const blocks = []; let started = false, complete = false, stopReason, active;
          const invalid = () => fail('INVALID_RESPONSE', 'Amazon Bedrock returned an invalid tool response.');
          const newBlock = (index, kind) => {
            if (!Number.isSafeInteger(index) || index !== blocks.length || active !== undefined || blocks.length >= 1000) throw invalid();
            const block = { kind, closed: false }; blocks.push(block); active = index; return block;
          };
          const boundText = bytes => {
            textBytes += bytes;
            if (textBytes > TEXT_LIMIT) throw fail('RESPONSE_LIMIT', 'Amazon Bedrock generated more than 2 MiB of text.');
          };
          try {
            while (true) {
              check(); const next = await wait(iterator.next()); check();
              if (next.done) break;
              const event = next.value;
              if (!object(event) || Object.keys(event).length !== 1) throw invalid();
              const [type, value] = Object.entries(event)[0];
              if (type.endsWith('Exception')) throw fail('PROVIDER_ERROR', 'Amazon Bedrock could not complete this response. Check the model and account access.');
              if (!object(value) || (complete && type !== 'metadata')) throw invalid();
              if (type === 'metadata') { telemetry.observe('bedrock', value); check(); continue; }
              if (type === 'messageStart') {
                if (started || value.role !== 'assistant') throw invalid();
                started = true; continue;
              }
              if (!started) throw invalid();
              const index = value.contentBlockIndex;
              if (type === 'contentBlockStart') {
                const use = value.start?.toolUse;
                if (!object(value.start) || Object.keys(value.start).length !== 1 || !object(use)) throw fail('UNSUPPORTED_OUTPUT', 'Amazon Bedrock returned unsupported output.');
                if (!toolId(use.toolUseId) || typeof use.name !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(use.name)) throw invalid();
                if (use.type !== undefined) throw fail('UNSUPPORTED_OUTPUT', 'Amazon Bedrock requested an unsupported server tool.');
                if (!session.has(use.name)) throw fail('UNSUPPORTED_OUTPUT', 'Amazon Bedrock requested an unavailable tool.');
                if (blocks.filter(block => block.kind === 'tool').length >= 12) throw fail('RESPONSE_LIMIT', 'Amazon Bedrock exceeded the local tool call limit.');
                Object.assign(newBlock(index, 'tool'), { id: use.toolUseId, name: use.name, input: '' });
              } else if (type === 'contentBlockDelta') {
                const delta = value.delta;
                if (!object(delta) || Object.keys(delta).length !== 1) throw invalid();
                const kind = Object.keys(delta)[0];
                if (!['text', 'reasoningContent', 'toolUse'].includes(kind)) throw fail('UNSUPPORTED_OUTPUT', 'Amazon Bedrock returned unsupported output.');
                let block = blocks[index];
                if (!block && kind !== 'toolUse') block = newBlock(index, kind === 'text' ? 'text' : 'reasoning');
                if (!block || !Number.isSafeInteger(index) || active !== index || block.closed) throw invalid();
                if (kind === 'toolUse') {
                  if (block.kind !== 'tool' || !object(delta.toolUse) || Object.keys(delta.toolUse).length !== 1 || typeof delta.toolUse.input !== 'string') throw invalid();
                  block.input += delta.toolUse.input;
                  if (Buffer.byteLength(block.input) > 120 * 1024) throw fail('RESPONSE_LIMIT', 'Amazon Bedrock exceeded the tool argument size limit.');
                } else if (kind === 'text') {
                  if (block.kind !== 'text' || typeof delta.text !== 'string') throw invalid();
                  boundText(Buffer.byteLength(delta.text)); block.text = (block.text || '') + delta.text;
                  if (delta.text) onDelta({ content: delta.text, thinking: '' }); check();
                } else {
                  const reasoning = delta.reasoningContent;
                  if (block.kind !== 'reasoning' || !object(reasoning) || Object.keys(reasoning).length !== 1) throw invalid();
                  const key = Object.keys(reasoning)[0], value = reasoning[key];
                  // AWS requires reasoning text/signatures unmodified on replay.
                  // https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_ReasoningContentBlockDelta.html
                  if (key === 'redactedContent') {
                    if (!(value instanceof Uint8Array) || block.text !== undefined || block.signature !== undefined) throw invalid();
                    boundText(value.byteLength); (block.redacted ||= []).push(Buffer.from(value));
                  } else if (['text', 'signature'].includes(key)) {
                    if (typeof value !== 'string' || block.redacted) throw invalid();
                    boundText(Buffer.byteLength(value)); block[key] = (block[key] || '') + value;
                    if (key === 'text' && value) onDelta({ content: '', thinking: value }); check();
                  } else throw fail('UNSUPPORTED_OUTPUT', 'Amazon Bedrock returned unsupported reasoning.');
                }
              } else if (type === 'contentBlockStop') {
                if (!Number.isSafeInteger(index) || active !== index || !blocks[index] || blocks[index].closed) throw invalid();
                blocks[index].closed = true; active = undefined;
              } else if (type === 'messageStop') {
                if (value.stopReason === 'max_tokens') throw fail('INCOMPLETE', 'Amazon Bedrock reached its output limit before completing.');
                if (!['end_turn', 'stop_sequence', 'tool_use'].includes(value.stopReason)) throw fail('PROVIDER_ERROR', 'Amazon Bedrock stopped before completing this response.');
                if (active !== undefined || !blocks.length) throw invalid();
                const calls = blocks.filter(block => block.kind === 'tool');
                if ((value.stopReason === 'tool_use') !== (calls.length > 0)) throw invalid();
                stopReason = value.stopReason; complete = true;
              } else throw fail('UNSUPPORTED_OUTPUT', 'Amazon Bedrock returned unsupported output.');
            }
            if (!complete) throw fail('EARLY_EOF', 'Amazon Bedrock closed the response before completion.');
          } finally { Promise.resolve(iterator.return?.()).catch(() => {}); }
          if (stopReason !== 'tool_use') return;
          // Parse every completed block before dispatch; an invalid/truncated
          // response must not trigger any local mutation.
          const content = blocks.map(block => {
            if (block.kind === 'text') return { text: block.text || '' };
            if (block.kind === 'reasoning') return { reasoningContent: block.redacted ? { redactedContent: Buffer.concat(block.redacted) } : { reasoningText: { text: block.text || '', ...(block.signature !== undefined ? { signature: block.signature } : {}) } } };
            try { block.arguments = JSON.parse(block.input); } catch { throw invalid(); }
            if (!object(block.arguments)) throw invalid();
            return { toolUse: { toolUseId: block.id, name: block.name, input: block.arguments } };
          });
          const calls = blocks.filter(block => block.kind === 'tool');
          session.preflight(calls.map(({ id, name, arguments: args }) => ({ id, name, arguments: args })));
          const results = [];
          for (const block of calls) {
            check();
            const result = await wait(session.execute({ id: block.id, name: block.name, arguments: block.arguments })); check();
            results.push({ toolResult: { toolUseId: block.id, content: [{ json: JSON.parse(result) }] } });
          }
          converted.push({ role: 'assistant', content }, { role: 'user', content: results });
          telemetry.nextRound();
        }
        throw fail('RESPONSE_LIMIT', 'Amazon Bedrock exceeded the local tool round limit.');
      }
      const response = await send(new ConverseStreamCommand(payload));
      if (!response.stream || typeof response.stream[Symbol.asyncIterator] !== 'function') throw fail('INVALID_RESPONSE', 'Amazon Bedrock returned no response stream.');
      const iterator = response.stream[Symbol.asyncIterator](); let complete = false, textBytes = 0;
      try {
        while (true) {
          check(); const next = await wait(iterator.next()); check();
          if (next.done) break;
          const event = next.value;
          if (!object(event) || Object.keys(event).length !== 1) throw fail('INVALID_RESPONSE', 'Amazon Bedrock returned an invalid stream event.');
          const [type, value] = Object.entries(event)[0];
          if (type.endsWith('Exception')) throw fail('PROVIDER_ERROR', 'Amazon Bedrock could not complete this response. Check the model and account access.');
          if (complete && type !== 'metadata') throw fail('INVALID_RESPONSE', 'Amazon Bedrock sent content after completion.');
          if(type === 'metadata')telemetry.observe('bedrock',value);
          if (type === 'contentBlockStart') {
            if (!object(value.start) || Object.keys(value.start).length) throw fail('UNSUPPORTED_OUTPUT', 'Tool calls and non-text output are not supported in this chat.');
          } else if (type === 'contentBlockDelta') {
            const delta = value.delta;
            if (!object(delta) || Object.keys(delta).some(key => !['text', 'reasoningContent'].includes(key))) throw fail('UNSUPPORTED_OUTPUT', 'Tool calls and non-text output are not supported in this chat.');
            const content = delta.text ?? '', thinking = delta.reasoningContent?.text ?? '';
            if (typeof content !== 'string' || typeof thinking !== 'string') throw fail('INVALID_RESPONSE', 'Amazon Bedrock returned invalid text.');
            textBytes += Buffer.byteLength(content) + Buffer.byteLength(thinking);
            if (textBytes > TEXT_LIMIT) throw fail('RESPONSE_LIMIT', 'Amazon Bedrock generated more than 2 MiB of text.');
            if (content || thinking) onDelta({ content, thinking }); check();
          } else if (type === 'messageStop') {
            if (value.stopReason === 'max_tokens') throw fail('INCOMPLETE', 'Amazon Bedrock reached its output limit before completing.');
            if (value.stopReason === 'tool_use') throw fail('UNSUPPORTED_OUTPUT', 'Tool calls are not supported in this chat.');
            if (!['end_turn', 'stop_sequence'].includes(value.stopReason)) throw fail('PROVIDER_ERROR', 'Amazon Bedrock stopped before completing this response.');
            complete = true;
          } else if (!['messageStart', 'contentBlockStop', 'metadata'].includes(type)) throw fail('UNSUPPORTED_OUTPUT', 'Amazon Bedrock returned unsupported output.');
        }
        if (!complete) throw fail('EARLY_EOF', 'Amazon Bedrock closed the response before completion.');
      } finally { Promise.resolve(iterator.return?.()).catch(() => {}); }
    }, onLocalTool?.userWait);
  }
  return { listModels, supportsImages, supportsLocalTools, streamChat };
}

module.exports = { createBedrockProvider };
