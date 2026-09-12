const { createToolSession, JSON_LIMIT } = require('./local-tools.cjs');
const { createActiveClock } = require('./active-clock.cjs');
const { validateCalls } = require('./local-chat.cjs');
const { createSources } = require('./sources.cjs');
const { createTelemetry } = require('./usage.cjs');
const { createTransport, sseParser, failure, object, parseJSON, TEXT_LIMIT, REQUEST_LIMIT, MODEL_LIMIT } = require('./transport.cjs');

const BASES = Object.freeze({ openai: 'https://api.openai.com/v1', anthropic: 'https://api.anthropic.com/v1', google: 'https://generativelanguage.googleapis.com/v1beta' });
const FILE_LIMIT = 4 * 1024 * 1024, FILE_TOTAL = 8 * 1024 * 1024, ACTIVITY_LIMIT = 40;
const validID = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,256}$/.test(value);
function imageType(data) {
  const b = Buffer.from(data, 'base64');
  if (b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png';
  if (b[0] === 255 && b[1] === 216 && b[2] === 255) return 'image/jpeg';
  if (b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  throw failure('INVALID_REQUEST', 'Chat images must be PNG, JPEG, or WebP.');
}
function boundedUTF8(value, limit) {
  const normalized = Buffer.from(value).toString('utf8').replace(/\0/g, '');
  let result = '', size = 0;
  for (const point of Array.from(normalized)) {
    const bytes = Buffer.byteLength(point); if (size + bytes > limit) break;
    result += point; size += bytes;
  }
  return result;
}
function filename(value, fallback = 'generated-file') {
  const leaf = typeof value === 'string' ? value.split(/[\\/]/).at(-1).replace(/[\x00-\x1f\x7f]/g, '').trim().replace(/^\.+/, '') : '';
  if (!leaf) return fallback;
  const extension = /\.[a-z0-9]{1,12}$/i.exec(leaf)?.[0] || '';
  return boundedUTF8(extension ? leaf.slice(0, -extension.length) : leaf, 256 - Buffer.byteLength(extension)) + extension;
}
function mimeFor(name, supplied) {
  if (typeof supplied === 'string' && /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/i.test(supplied) && supplied.length < 150) return supplied.toLowerCase();
  return ({ png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', csv: 'text/csv', txt: 'text/plain', md: 'text/markdown', json: 'application/json', pdf: 'application/pdf', html: 'text/html', svg: 'image/svg+xml', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' })[name.split('.').at(-1)?.toLowerCase()] || 'application/octet-stream';
}
function plainSandboxLinks(text) {
  return text.replace(/!?\[([^\]]*)\]\(\s*<?(?:sandbox:|file:|\/mnt\/)[^)]*\)/gi, '$1');
}

// Preserve native hosted tools and reasoning while routing only advertised local
// functions to the shell's document executor after a complete response.
async function streamHostedCore(provider, { apiKey, ...transportOptions }, request) {
  if (!Object.hasOwn(BASES, provider)) throw failure('UNSUPPORTED_TOOL', 'Hosted tools are unavailable for this provider.');
  const { baseUrl, model, messages, signal, onDelta, onTool, onArtifact, onReplace, tools, onUsage, onModel, onSources, localTools = [], onLocalTool } = request;
  if (baseUrl !== BASES[provider]) throw failure('INVALID_ENDPOINT', 'Cloud tools use their official HTTPS endpoint.');
  if (typeof apiKey !== 'string' || !apiKey || apiKey.length > 8192 || /[\s\x00-\x1f\x7f]/.test(apiKey)) throw failure('INVALID_API_KEY', 'Add a valid provider API key.');
  if (typeof model !== 'string' || !model.trim() || model.length > 512 || typeof onDelta !== 'function' || typeof onTool !== 'function' ||
      !Array.isArray(messages) || !messages.length || messages.length > 10000 || !messages.every(m => object(m) && ['system', 'user', 'assistant'].includes(m.role) && typeof m.content === 'string' &&
        (m.images === undefined || m.role === 'user' && Array.isArray(m.images) && m.images.length <= 10 && m.images.every(s => typeof s === 'string' && s.length <= 1398104 && s.length % 4 === 0 && /^[A-Za-z0-9+/]+={0,2}$/.test(s))))) throw failure('INVALID_REQUEST', 'Hosted tools require valid chat messages and callbacks.');
  if (!Array.isArray(tools) || tools.length > 2 || new Set(tools).size !== tools.length || tools.some(t => !['web_search', 'code_execution'].includes(t)) || provider === 'google' && tools.includes('web_search')) throw failure('UNSUPPORTED_TOOL', 'This hosted tool is unavailable for the selected provider.');
  const enabled = new Set(tools), headers = provider === 'openai' ? { Authorization: `Bearer ${apiKey}` } : provider === 'anthropic' ? { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' } : { 'x-goog-api-key': apiKey };
  const clock = createActiveClock(onLocalTool?.userWait), totalMs = transportOptions.totalMs ?? 600000;
  let textBytes = 0, thinkingBytes = 0, artifactBytes = 0, inlineCount = 0, renderedText = '';
  const liveText = typeof onReplace === 'function';
  const activities = new Map(), artifacts = new Map();
  const sources = createSources(onSources);
  const check = () => { if (signal?.aborted) throw failure('ABORTED', 'The provider request was stopped.'); if (clock.elapsedMs() >= totalMs) throw failure('TOTAL_TIMEOUT', 'The provider exceeded the request time limit.'); };
  const session = createToolSession(localTools,onLocalTool,check,{signal,totalMs});
  if (!tools.length && !session.enabled) throw failure('UNSUPPORTED_TOOL','Select an available tool.');
  if (provider === 'google' && session.enabled && tools.length && !/^gemini-3(?:[.-]|$)/.test(model.replace(/^models\//,''))) throw failure('UNSUPPORTED_TOOL','This Gemini model cannot combine document tools with hosted code execution.');
  const consume = (route, options) => { check(); return createTransport({ ...transportOptions, totalMs: Math.max(1, totalMs - clock.elapsedMs()) })(baseUrl + route, { headers, signal, ...options }); };
  const emit = (content = '', thinking = '') => {
    if (typeof content !== 'string' || typeof thinking !== 'string') throw failure('INVALID_RESPONSE', 'The provider returned invalid text.');
    textBytes += Buffer.byteLength(content) + Buffer.byteLength(thinking);
    thinkingBytes += Buffer.byteLength(thinking);
    if (textBytes > TEXT_LIMIT) throw failure('RESPONSE_LIMIT', 'The provider generated more than 2 MiB of text.');
    check(); if (content || thinking) onDelta({ content, thinking }); check();
  };
  const activity = (id, kind, status, detail) => {
    if (!validID(id) || !enabled.has(kind)) throw failure('UNSUPPORTED_OUTPUT', 'The provider returned an unexpected tool call.');
    if (!activities.has(id) && activities.size >= ACTIVITY_LIMIT) throw failure('TOOL_LIMIT', 'The provider exceeded the tool activity limit.');
    const safeDetail = typeof detail === 'string' ? boundedUTF8(detail.replaceAll(apiKey, '[redacted]'), 4000) : undefined;
    const previous = activities.get(id);
    if (previous?.status === 'error' && status !== 'error') return;
    if (previous?.status === 'complete' && status === 'running') status = 'complete';
    const next = { id, kind, status, ...(safeDetail ? { detail: safeDetail } : {}) };
    if (previous?.status === status && previous.detail === safeDetail) return;
    activities.set(id, next); check(); onTool(next); check();
  };
  const reference = annotation => {
    const source = sources.add(annotation?.url, annotation?.title); if (!source) return '';
    return ` [${source.id}](<${source.url}>)`;
  };
  const render = (text, annotations = [], positional = false) => {
    if (typeof text !== 'string') throw failure('INVALID_RESPONSE', 'The provider returned invalid answer text.');
    if (!Array.isArray(annotations)) throw failure('INVALID_RESPONSE', 'The provider returned invalid citations.');
    const additions = [], seen = new Set();
    for (const a of annotations) {
      if (a?.type === 'container_file_citation') queueArtifact({ provider, container: a.container_id, file: a.file_id, name: a.filename });
      else {
        const link = reference(a), at = positional && Number.isInteger(a.end_index) && a.end_index >= 0 && a.end_index <= text.length ? a.end_index : text.length;
        const key = at + link; if (!link || seen.has(key)) continue; seen.add(key); additions.push({ at, link });
      }
    }
    for (const a of additions.sort((a, b) => b.at - a.at)) text = text.slice(0, a.at) + a.link + text.slice(a.at);
    const clean = plainSandboxLinks(text);
    if (liveText) {
      renderedText += clean;
      if (Buffer.byteLength(renderedText) + thinkingBytes > TEXT_LIMIT) throw failure('RESPONSE_LIMIT', 'The provider generated more than 2 MiB of text.');
    } else emit(clean);
  };
  const queueArtifact = artifact => {
    if (!enabled.has('code_execution')) throw failure('UNSUPPORTED_OUTPUT', 'The provider returned an unexpected generated file.');
    const id = artifact.inline ? `inline_${++inlineCount}` : `${artifact.container || ''}_${artifact.file}`;
    if (artifacts.has(id)) return;
    if (artifacts.size >= 10) throw failure('TOOL_LIMIT', 'The provider generated too many files.');
    artifacts.set(id, artifact);
  };
  const images = (m, convert) => (m.images || []).map(data => convert(data, imageType(data)));
  const system = messages.filter(m => m.role === 'system').map(m => m.content).join('\n\n');
  let route, payload;
  if (provider === 'openai') {
    route = '/responses'; payload = { model, stream: true, store: false, max_output_tokens: request.maxTokens ?? 8192, ...(enabled.has('web_search') ? {include:['web_search_call.action.sources']} : {}), tools: tools.map(kind => kind === 'web_search' ? { type: 'web_search' } : { type: 'code_interpreter', container: { type: 'auto' } }), input: messages.map(m => ({ role: m.role, content: m.images?.length ? [{ type: 'input_text', text: m.content }, ...images(m, (data, mime) => ({ type: 'input_image', image_url: `data:${mime};base64,${data}` }))] : m.content })) };
  } else if (provider === 'anthropic') {
    route = '/messages'; payload = { model, stream: true, max_tokens: request.maxTokens ?? 8192, ...(system ? { system } : {}), tools: tools.map(kind => kind === 'web_search' ? { type: 'web_search_20250305', name: 'web_search', max_uses: 5 } : { type: 'code_execution_20260521', name: 'code_execution' }), messages: messages.filter(m => m.role !== 'system').map(m => ({ role: m.role, content: m.images?.length ? [{ type: 'text', text: m.content }, ...images(m, (data, mime) => ({ type: 'image', source: { type: 'base64', media_type: mime, data } }))] : m.content })) };
  } else {
    const id = model.replace(/^models\//, ''); if (!/^[A-Za-z0-9._-]+$/.test(id)) throw failure('INVALID_REQUEST', 'Choose a valid Gemini model.');
    route = '/models/' + encodeURIComponent(id) + ':streamGenerateContent?alt=sse';
    payload = { ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}), contents: messages.filter(m => m.role !== 'system').map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }, ...images(m, (data, mimeType) => ({ inlineData: { mimeType, data } }))] })), tools: enabled.has('code_execution') ? [{ codeExecution: {} }] : [], generationConfig: { maxOutputTokens: request.maxTokens ?? 8192 } };
  }

  if (session.enabled) {
    if (provider === 'openai') {
      payload.tools.push(...session.definitions.map(t=>({type:'function',...t,strict:false})));
      payload.include=[...(payload.include||[]),'reasoning.encrypted_content'];
      payload.parallel_tool_calls=false;
    } else if (provider === 'anthropic') payload.tools.push(...session.definitions.map(({parameters,...t})=>({...t,input_schema:parameters})));
    else payload.tools.push({functionDeclarations:session.definitions.map(({parameters,...t})=>({...t,parametersJsonSchema:parameters}))});
  }
  const telemetry=createTelemetry({onUsage,onModel});
  let pauses=0;
  for (let round = 0; round <= 16; round++) {
    if(round)telemetry.nextRound();
    check(); const body = JSON.stringify(payload); if (Buffer.byteLength(body) > REQUEST_LIMIT) throw failure('INVALID_REQUEST', 'Chat history exceeded the request size limit.');
    let complete = false, stopReason, container, lastCode, googleText = '', googleCalls = 0;
    let output; const googleParts=[], streamedCalls=new Map();
    const blocks = new Map(), closedBlocks = new Set(), openMessages = new Map(), renderedMessages = new Set();
    const handleOpenItem = (item, index, done = false) => {
      if (!object(item)) throw failure('INVALID_RESPONSE', 'The provider returned an invalid output item.');
      if (item.type === 'message') {
        const identity = item.id || `index_${index}`;
        for (const part of Array.isArray(item.content) ? item.content : []) for (const a of Array.isArray(part.annotations) ? part.annotations : []) if (a?.type === 'url_citation') sources.add(a.url, a.title);
        if (done && !renderedMessages.has(identity)) {
          if (!Array.isArray(item.content)) throw failure('INVALID_RESPONSE', 'The provider returned invalid message content.');
          for (const part of item.content) if (part.type === 'output_text') render(part.text, part.annotations || [], true); else if (part.type === 'refusal') render(part.refusal);
          renderedMessages.add(identity);
        }
      } else if (['web_search_call', 'code_interpreter_call'].includes(item.type)) {
        const kind = item.type === 'web_search_call' ? 'web_search' : 'code_execution';
        if (kind === 'web_search' && Array.isArray(item.action?.sources)) for (const s of item.action.sources.slice(0,100)) sources.add(s?.url,s?.title);
        const detail = kind === 'web_search' ? item.action?.query || item.action?.queries?.join('\n') || item.action?.url : item.code;
        activity(item.id, kind, item.status === 'completed' ? 'complete' : item.status === 'failed' || item.status === 'incomplete' ? 'error' : 'running', detail);
      } else if (item.type === 'function_call') {
        if (!session.enabled || !session.has(item.name)) throw failure('UNSUPPORTED_OUTPUT','The provider requested an unavailable local tool.');
        if (done) {
          if(item.status!==undefined && item.status!=='completed')throw failure('INVALID_RESPONSE','The provider returned an unfinished function call.');
          validateCalls([{id:item.call_id,name:item.name,arguments:item.arguments}],session);
          const prior=streamedCalls.get(item.id);
          if (prior && (prior.name!==item.name || prior.call_id!==item.call_id || prior.arguments && prior.arguments!==item.arguments)) throw failure('INVALID_RESPONSE','The provider changed a streamed tool call.');
        }
        if (item.id) streamedCalls.set(item.id,{...item});
      } else if (item.type?.includes('call')) throw failure('UNSUPPORTED_OUTPUT', 'Client tool execution is unavailable in this chat.');
    };
    const finishAnthropicBlock = (block, index) => {
      if (!object(block) || closedBlocks.has(index)) throw failure('INVALID_RESPONSE', 'The provider ended an unknown content block.');
      closedBlocks.add(index);
      if (block.__json !== undefined) { block.input = parseJSON(block.__json); delete block.__json; }
      if (block.type === 'text') render(block.text || '', block.citations || []);
      if (block.type === 'web_search_tool_result' && Array.isArray(block.content)) for (const s of block.content.slice(0,100)) if (s?.type === 'web_search_result') sources.add(s.url,s.title);
      if (block.type === 'server_tool_use') activity(block.id, block.name === 'web_search' ? 'web_search' : 'code_execution', 'running', JSON.stringify(block.input));
      if (block.type?.endsWith('_tool_result')) {
        const previous = activities.get(block.tool_use_id); if (!previous) throw failure('INVALID_RESPONSE', 'The provider returned an unmatched tool result.');
        const content = block.content, failed = object(content) && (content.type?.endsWith('_error') || content.error_code || Number.isInteger(content.return_code) && content.return_code !== 0);
        activity(block.tool_use_id, previous.kind, failed ? 'error' : 'complete', object(content) ? typeof content.stdout === 'string' ? [content.stdout, content.stderr].filter(Boolean).join('\n') : content.error_code : undefined);
        if (block.type === 'bash_code_execution_tool_result' && content?.type === 'bash_code_execution_result') for (const file of content.content || []) if (file.file_id) queueArtifact({ provider, file: file.file_id });
      }
      blocks.set(index, block);
    };
    const record = (raw, event) => {
      check(); const p = parseJSON(raw); if (!object(p)) throw failure('INVALID_RESPONSE', 'The provider returned an invalid stream event.');
      if (Object.hasOwn(p, 'error') || p.type === 'error' || event === 'error' || p.type === 'response.failed') throw failure('PROVIDER_ERROR', 'The provider could not finish this response. Check model and account access.');
      telemetry.observe(provider,p);
      if (provider === 'openai') {
        if (p.type === 'response.output_item.added' || p.type === 'response.output_item.done') handleOpenItem(p.item, p.output_index, p.type.endsWith('.done'));
        else if (p.type === 'response.output_text.delta' || p.type === 'response.refusal.delta') {
          if (typeof p.delta !== 'string') throw failure('INVALID_RESPONSE', 'The provider returned an invalid text delta.');
          if (liveText) emit(p.delta);
          const id = p.item_id || `index_${p.output_index ?? 0}`; const current = openMessages.get(id) || { text: '', annotations: [] }; current.text += p.delta;
          if (Buffer.byteLength(current.text) > TEXT_LIMIT) throw failure('RESPONSE_LIMIT', 'The provider generated more than 2 MiB of text.'); openMessages.set(id, current);
        } else if (p.type === 'response.output_text.annotation.added') {
          if (p.annotation?.type === 'url_citation') sources.add(p.annotation.url,p.annotation.title);
          const id = p.item_id || `index_${p.output_index ?? 0}`; const current = openMessages.get(id) || { text: '', annotations: [] }; current.annotations.push(p.annotation); openMessages.set(id, current);
        } else if (p.type === 'response.reasoning_summary_text.delta' || p.type === 'response.reasoning_text.delta') emit('', p.delta);
        else if (/^response\.(web_search|code_interpreter)_call\.(in_progress|searching|interpreting|completed)$/.test(p.type)) activity(p.item_id, p.type.includes('web_search') ? 'web_search' : 'code_execution', p.type.endsWith('.completed') ? 'complete' : 'running');
        else if (p.type === 'response.code_interpreter_call_code.done') activity(p.item_id, 'code_execution', 'running', p.code);
        else if (p.type === 'response.function_call_arguments.delta') {
          const call=streamedCalls.get(p.item_id);
          if (!call || typeof p.delta!=='string') throw failure('INVALID_RESPONSE','The provider returned unmatched function arguments.');
          call.arguments=(call.arguments||'')+p.delta;
          if(Buffer.byteLength(call.arguments)>JSON_LIMIT)throw failure('RESPONSE_LIMIT','The provider exceeded the tool argument limit.');
        }
        else if (p.type === 'response.incomplete') throw failure('INCOMPLETE', 'The provider reached its output limit before completing.');
        else if (p.type === 'response.completed') {
          if (p.response?.status !== 'completed') throw failure('INVALID_RESPONSE', 'The provider returned an invalid completion.');
          if (p.response.output !== undefined && !Array.isArray(p.response.output)) throw failure('INVALID_RESPONSE', 'The provider returned invalid output.');
          output=p.response.output || [];
          if(streamedCalls.size && [...streamedCalls.keys()].some(id=>!output.some(item=>item.id===id && item.type==='function_call'))) throw failure('INVALID_RESPONSE','The provider omitted a streamed tool call.');
          for (const [i, item] of output.entries()) handleOpenItem(item, i, true);
          for (const [id, part] of openMessages) if (!renderedMessages.has(id)) render(part.text, part.annotations, true);
          complete = true;
        }
      } else if (provider === 'anthropic') {
        if (p.type === 'message_start') container = p.message?.container?.id;
        else if (p.type === 'content_block_start') {
          const block = p.content_block; if (!object(block) || !Number.isInteger(p.index) || p.index < 0 || p.index > 1000 || blocks.has(p.index)) throw failure('INVALID_RESPONSE', 'The provider returned an invalid content block.');
          if (block.type === 'tool_use' && (!session.enabled || !session.has(block.name))) throw failure('UNSUPPORTED_OUTPUT','The provider requested an unavailable local tool.');
          if (liveText && block.type === 'text' && block.text) emit(block.text);
          if (block.type === 'server_tool_use') {
            if (!['web_search', 'code_execution', 'bash_code_execution', 'text_editor_code_execution'].includes(block.name)) throw failure('UNSUPPORTED_OUTPUT', 'The provider returned an unsupported hosted tool.');
            activity(block.id, block.name === 'web_search' ? 'web_search' : 'code_execution', 'running');
          }
          blocks.set(p.index, block);
        } else if (p.type === 'content_block_delta') {
          const b = blocks.get(p.index), d = p.delta; if (!b || closedBlocks.has(p.index) || !object(d)) throw failure('INVALID_RESPONSE', 'The provider returned an unmatched content delta.');
          if (d.type === 'text_delta') { if (typeof d.text !== 'string') throw failure('INVALID_RESPONSE', 'The provider returned invalid text.'); b.text = (b.text || '') + d.text; if (liveText) emit(d.text); }
          else if (d.type === 'thinking_delta') { emit('', d.thinking); b.thinking = (b.thinking || '') + d.thinking; }
          else if (d.type === 'signature_delta') { if (typeof d.signature !== 'string') throw failure('INVALID_RESPONSE', 'The provider returned an invalid signature.'); b.signature = (b.signature || '') + d.signature; }
          else if (d.type === 'input_json_delta') { if (!['server_tool_use','tool_use'].includes(b.type) || typeof d.partial_json !== 'string') throw failure('UNSUPPORTED_OUTPUT', 'The provider returned an unsupported tool delta.'); b.__json = (b.__json || '') + d.partial_json; if(Buffer.byteLength(b.__json)>JSON_LIMIT)throw failure('RESPONSE_LIMIT','The provider exceeded the tool argument limit.'); }
          else if (d.type === 'citations_delta') { (b.citations ||= []).push(d.citation); }
        } else if (p.type === 'content_block_stop') finishAnthropicBlock(blocks.get(p.index), p.index);
        else if (p.type === 'message_delta') { stopReason = p.delta?.stop_reason || stopReason; container = p.delta?.container?.id || p.container?.id || container; }
        else if (p.type === 'message_stop') {
          if (blocks.size !== closedBlocks.size) throw failure('INVALID_RESPONSE', 'The provider ended with an unfinished content block.');
          if ((stopReason === 'tool_use') !== [...blocks.values()].some(b=>b.type==='tool_use')) throw failure('INVALID_RESPONSE','The provider returned an inconsistent local tool completion.');
          if (stopReason === 'max_tokens') throw failure('INCOMPLETE', 'The provider reached its output limit before completing.');
          if (!['end_turn', 'stop_sequence', 'refusal', 'pause_turn', 'tool_use'].includes(stopReason)) throw failure('EARLY_EOF', 'The provider ended the stream before a finish reason.');
          complete = true;
        }
      } else {
        if (p.promptFeedback?.blockReason) throw failure('PROVIDER_ERROR', 'The provider declined this prompt.');
        if (p.candidates !== undefined && !Array.isArray(p.candidates)) throw failure('INVALID_RESPONSE', 'The provider returned invalid candidates.');
        for (const candidate of p.candidates || []) {
          if (!object(candidate) || candidate.index !== undefined && candidate.index !== 0 || candidate.content?.parts !== undefined && !Array.isArray(candidate.content.parts)) throw failure('INVALID_RESPONSE', 'The provider returned invalid candidate content.');
          for (const chunk of Array.isArray(candidate.groundingMetadata?.groundingChunks) ? candidate.groundingMetadata.groundingChunks.slice(0,100) : []) sources.add(chunk?.web?.uri,chunk?.web?.title);
          for (const part of candidate.content?.parts || []) {
            if (!object(part) || part.toolCall || part.toolResponse || part.functionCall && (!session.enabled || !object(part.functionCall) || !session.has(part.functionCall.name))) throw failure('UNSUPPORTED_OUTPUT', 'The provider returned an unavailable tool.');
            googleParts.push(part);
            if (part.text !== undefined) { if (typeof part.text !== 'string') throw failure('INVALID_RESPONSE', 'The provider returned invalid text.'); if (part.thought) emit('', part.text); else { googleText += part.text; if (liveText) emit(part.text); } }
            if (part.executableCode) { lastCode = validID(part.executableCode.id) ? part.executableCode.id : `gemini_code_${++googleCalls}`; activity(lastCode, 'code_execution', 'running', part.executableCode.code); }
            if (part.codeExecutionResult) { const id = validID(part.codeExecutionResult.id) ? part.codeExecutionResult.id : lastCode; if (!id) throw failure('INVALID_RESPONSE', 'The provider returned an unmatched code result.'); activity(id, 'code_execution', part.codeExecutionResult.outcome === 'OUTCOME_OK' ? 'complete' : 'error', part.codeExecutionResult.output); }
            if (part.inlineData) queueArtifact({ inline: part.inlineData, name: `generated-${inlineCount + 1}` });
          }
          if (Buffer.byteLength(googleText) > TEXT_LIMIT) throw failure('RESPONSE_LIMIT', 'The provider generated more than 2 MiB of text.');
          if (candidate.finishReason) { if (candidate.finishReason === 'MAX_TOKENS') throw failure('INCOMPLETE', 'The provider reached its output limit before completing.'); if (candidate.finishReason !== 'STOP') throw failure('PROVIDER_ERROR', 'The provider stopped before completing this response.'); complete = true; }
        }
      }
      return complete;
    };
    await consume(route, { body, onText: sseParser(record) });
    if (!complete) throw failure('EARLY_EOF', 'The provider closed the stream before completion.');
    if (provider === 'google') render(googleText);
    const orderedBlocks=[...blocks.entries()].sort((a,b)=>a[0]-b[0]).map(([,b])=>b);
    const calls=provider==='openai' ? (output||[]).filter(i=>i.type==='function_call').map(i=>({id:i.call_id,name:i.name,arguments:i.arguments})) : provider==='anthropic' ? orderedBlocks.filter(b=>b.type==='tool_use').map(b=>({id:b.id,name:b.name,arguments:JSON.stringify(b.input)})) : googleParts.filter(p=>p.functionCall).map((p,i)=>({id:p.functionCall.id??`gemini_local_${round}_${i}`,name:p.functionCall.name,arguments:JSON.stringify(p.functionCall.args)}));
    validateCalls(calls,session);
    const paused=provider==='anthropic' && stopReason==='pause_turn';
    if (!calls.length && !paused) break;
    if (round===16 || paused && ++pauses>4) throw failure('TOOL_LIMIT','The provider reached the tool continuation limit.');
    if (provider==='openai') payload.input.push(...output);
    else if (provider==='anthropic') {payload.messages.push({role:'assistant',content:orderedBlocks});if(validID(container))payload.container=container;}
    else payload.contents.push({role:'model',parts:googleParts});
    const results=[];
    for (const call of calls) results.push({call,output:await session.execute({...call,arguments:parseJSON(call.arguments)})});
    if (provider==='openai') payload.input.push(...results.map(({call,output})=>({type:'function_call_output',call_id:call.id,output})));
    else if (provider==='anthropic' && results.length) payload.messages.push({role:'user',content:results.map(({call,output})=>({type:'tool_result',tool_use_id:call.id,content:output}))});
    else if (provider==='google') payload.contents.push({role:'user',parts:results.map(({call,output},i)=>({functionResponse:{name:call.name,response:parseJSON(output),...(googleParts.filter(p=>p.functionCall)[i].functionCall.id!==undefined?{id:call.id}:{})}}))});
    check();
  }

  sources.publish();
  if (liveText) { check(); onReplace(renderedText); check(); }

  // Artifact bytes are transferred only from the fixed provider API. Never fetch
  // model-written sandbox URLs, redirect targets, or arbitrary result URLs.
  for (const [index, artifact] of [...artifacts.values()].entries()) {
    check(); const id = `artifact_${index + 1}`; activity(id, 'code_execution', 'running', 'Saving generated file');
    try {
      let name = filename(artifact.name), mime, bytes;
      if (artifact.inline) {
        const { data, mimeType } = artifact.inline;
        if (typeof data !== 'string' || data.length > Math.ceil(FILE_LIMIT / 3) * 4 || data.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(data)) throw failure('INVALID_RESPONSE', 'The provider returned invalid generated file data.');
        bytes = Buffer.from(data, 'base64'); mime = mimeFor(name, mimeType);
        name += ({ 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp', 'text/csv': '.csv', 'application/pdf': '.pdf' })[mime] || '.bin';
      } else {
        if (!validID(artifact.file) || provider === 'openai' && !validID(artifact.container)) throw failure('INVALID_RESPONSE', 'The provider returned an invalid generated file reference.');
        let fileRoute;
        if (provider === 'openai') fileRoute = `/containers/${artifact.container}/files/${artifact.file}/content`;
        else {
          let metadata = ''; await consume('/files/' + artifact.file, { maxBytes: MODEL_LIMIT, onText: t => { metadata += t; } });
          const m = parseJSON(metadata); if (!object(m) || m.downloadable !== true || m.id !== artifact.file || !Number.isInteger(m.size_bytes) || m.size_bytes < 0 || m.size_bytes > FILE_LIMIT) throw failure('INVALID_RESPONSE', 'The provider file is unavailable or exceeds the download limit.');
          name = filename(m.filename); mime = mimeFor(name, m.mime_type); fileRoute = `/files/${artifact.file}/content`;
        }
        const chunks = []; await consume(fileRoute, { maxBytes: Math.min(FILE_LIMIT, FILE_TOTAL - artifactBytes), onBytes: chunk => chunks.push(Buffer.from(chunk)) }); bytes = Buffer.concat(chunks); mime ||= mimeFor(name);
      }
      if (bytes.length > FILE_LIMIT || artifactBytes + bytes.length > FILE_TOTAL) throw failure('RESPONSE_LIMIT', 'Generated files exceed the download limit.');
      artifactBytes += bytes.length; check();
      if (typeof onArtifact !== 'function') throw failure('UNSUPPORTED_OUTPUT', 'Generated file storage is unavailable.');
      await onArtifact({ name, mime, data: bytes.toString('base64') }); check(); activity(id, 'code_execution', 'complete', name);
    } catch (error) {
      check(); activity(id, 'code_execution', 'error', 'Generated file could not be saved. It may be unavailable or exceed the download limit.');
    }
  }
}

module.exports = { streamHostedCore };
