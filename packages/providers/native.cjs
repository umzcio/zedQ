const { createSources } = require('./sources.cjs');
const { createTelemetry } = require('./usage.cjs');
const { createTransport, sseParser, failure, object, parseJSON, MODEL_LIMIT, TEXT_LIMIT, REQUEST_LIMIT } = require('./transport.cjs');

function imageType(data) {
  const bytes = Buffer.from(data, 'base64');
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png';
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg';
  if (bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  throw failure('INVALID_REQUEST', 'Chat images must be PNG, JPEG, or WebP.');
}
function validateRequest(model, messages, onDelta) {
  if (typeof model !== 'string' || !model.trim() || model.length > 512 || !Array.isArray(messages) || !messages.length || messages.length > 10000 || typeof onDelta !== 'function' ||
    !messages.every(m => object(m) && ['system', 'user', 'assistant'].includes(m.role) && typeof m.content === 'string' && Object.keys(m).every(k => ['role', 'content', 'images'].includes(k)) &&
      (m.images === undefined || m.role === 'user' && Array.isArray(m.images) && m.images.length <= 10 && m.images.every(i => typeof i === 'string' && i.length <= 1398104 && i.length % 4 === 0 && /^[A-Za-z0-9+/]+={0,2}$/.test(i))))) throw failure('INVALID_REQUEST', 'Chat requires a model and valid text messages.');
  for (const m of messages) for (const data of m.images || []) imageType(data);
}
function idValid(id) { return typeof id === 'string' && !!id.trim() && id.length <= 512; }
function stringArray(value) { return Array.isArray(value) && value.every(item => typeof item === 'string'); }
function groqChat(m) {
  return m.active !== false && !unsupportedName(m.id) &&
    !/(?:^|[-_/])(?:whisper|guard|safeguard|orpheus|speech)(?:[-_/]|$)/i.test(m.id) &&
    (!m.input_modalities || m.input_modalities.includes('text')) && (!m.output_modalities || m.output_modalities.includes('text'));
}
// Groq's standard catalog has no modality field; only documented vision IDs
// present in the active catalog get the fallback capability.
const GROQ_VISION_MODELS = new Set(['qwen/qwen3.6-27b', 'qwen/qwen3.8-27b']);
function citationURL(value) {
  if (typeof value !== 'string' || value.length > 8192 || /[\x00-\x1f\x7f]/.test(value)) return;
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return;
    return url.href.replace(/[<>]/g, c => c === '<' ? '%3C' : '%3E');
  } catch { return; }
}
function unsupportedName(id) { return /(?:^|[-_/])(?:embedding?s?|realtime|audio|tts|transcrib\w*|image|imagine|imagen|veo|sora|moderation|search|deep-research)(?:[-_/]|$)/i.test(id); }
// Fine-tune account/suffix components describe ownership, not capabilities.
// Preserve the full ID in requests while inspecting only the underlying model.
function openAIBase(id) { return id.replace(/^ft:/, '').split(':')[0]; }
function openAIChat(id) {
  const base = openAIBase(id);
  return (base === 'chat-latest' || base === 'chatgpt-4o-latest' || /^(?:gpt-(?:3\.5-turbo|4(?:o|[.-]|$)|[5-9](?:[.-]|$))|o[1-9](?:-|$))/.test(base)) &&
    !unsupportedName(base) && !/(?:^|-)(?:instruct|base|completion|completions)(?:-|$)/.test(base);
}
function openAILegacyChat(id) { return /^(?:gpt-3\.5-turbo(?:-|$)|gpt-4(?:-|$)|chatgpt-4o-latest$)/.test(openAIBase(id)); }
function openAIImages(id) {
  const base = openAIBase(id);
  if (!openAIChat(id) || /^(?:o1-(?:mini|preview)|o3-mini)(?:-|$)/.test(base)) return false;
  if (base === 'chat-latest' || base === 'chatgpt-4o-latest') return true;
  if (/^gpt-4-turbo(?:$|-\d{4}-\d{2}-\d{2}$)/.test(base) || /^gpt-4-(?:\d{4}-)?vision-preview$/.test(base)) return true;
  return /^(?:gpt-(?:4o(?:-|$)|4\.(?:1|5)(?:-|$)|[5-9](?:[.-]|$))|o[134](?:-|$))/.test(base);
}
function openAIOutputLimit(id) {
  const base = openAIBase(id);
  // These legacy families have a 4,096-token generation cap, even where the
  // context window is much larger. Modern models retain the bounded 8,192 cap.
  return /^gpt-3\.5-turbo(?:-|$)|^gpt-4-(?:turbo|\d{4}|vision)/.test(base) ? 4096 : 8192;
}

function createCloudProvider(provider, { apiKey, ...transportOptions }, normalize) {
  if (apiKey !== undefined && (typeof apiKey !== 'string' || apiKey.length > 8192 || /[\s\x00-\x1f\x7f]/.test(apiKey))) throw failure('INVALID_API_KEY', 'Enter a valid API key.');
  if (provider !== 'vllm' && !apiKey) throw failure('MISSING_API_KEY', 'Add an API key for this provider.');
  const headers = provider === 'anthropic' ? { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' } : provider === 'google' ? { 'x-goog-api-key': apiKey } : apiKey ? { Authorization: `Bearer ${apiKey}` } : {};
  const consume = createTransport(transportOptions);
  let metadata = new Map(), metadataBase;

  async function json(baseUrl, route, signal) {
    let text = '';
    await consume(normalize(baseUrl) + route, { headers, signal, maxBytes: MODEL_LIMIT, onText(chunk) { text += chunk; } });
    const data = parseJSON(text);
    if (!object(data)) throw failure('INVALID_RESPONSE', 'The provider returned an invalid model list.');
    if (Object.hasOwn(data, 'error')) throw failure('PROVIDER_ERROR', 'The provider could not list models.');
    return data;
  }

  async function listModels(baseUrl, {signal} = {}) {
    const base = normalize(baseUrl), found = new Map(), cursors = new Set(); let cursor, count = 0;
    // /models is public: a successful catalog fetch alone cannot validate a key.
    if (provider === 'openrouter' && !object((await json(base, '/key', signal)).data)) throw failure('INVALID_RESPONSE', 'The provider returned invalid API key information.');
    for (let page = 0; page < 10; page++) {
      const route = provider === 'anthropic' ? '/models?limit=100' + (cursor ? '&after_id=' + encodeURIComponent(cursor) : '') : provider === 'google' ? '/models?pageSize=100' + (cursor ? '&pageToken=' + encodeURIComponent(cursor) : '') : provider === 'xai' ? '/language-models' : '/models';
      const payload = await json(base, route, signal); const models = provider === 'google' || provider === 'xai' ? payload.models : payload.data;
      if (!Array.isArray(models) || (count += models.length) > 1000 || !models.every(m => object(m) && idValid(provider === 'google' ? m.name : m.id))) throw failure('INVALID_RESPONSE', 'The provider returned an invalid model list.');
      for (const m of models) {
        if ((provider === 'google' && !stringArray(m.supportedGenerationMethods)) ||
          (provider === 'openrouter' && (!object(m.architecture) || !stringArray(m.architecture.input_modalities) || !stringArray(m.architecture.output_modalities))) ||
          (provider === 'groq' && ((m.active !== undefined && typeof m.active !== 'boolean') || ['input_modalities', 'output_modalities'].some(field => m[field] !== undefined && !stringArray(m[field])))) ||
          (provider === 'xai' && ['input_modalities', 'output_modalities'].some(field => m[field] !== undefined && !stringArray(m[field]))) ||
          (provider === 'vllm' && ['input_modalities', 'capabilities'].some(field => m[field] !== undefined && !stringArray(m[field])))) throw failure('INVALID_RESPONSE', 'The provider returned invalid model capabilities.');
        const id = provider === 'google' ? m.name.replace(/^models\//, '') : m.id;
        // Batch variants run through OpenRouter's separate asynchronous API.
        if (provider === 'openrouter' && id.endsWith(':batch')) continue;
        const allowed = provider === 'openrouter' ? m.architecture.input_modalities.includes('text') && m.architecture.output_modalities.includes('text') : provider === 'groq' ? groqChat(m) : provider === 'google' ? m.supportedGenerationMethods?.includes('generateContent') && !unsupportedName(id) : provider === 'openai' ? openAIChat(id) : provider === 'xai' ? (!m.output_modalities || m.output_modalities.includes('text')) : provider === 'vllm' ? (!Array.isArray(m.capabilities) || m.capabilities.includes('completion') || m.capabilities.includes('chat')) && !unsupportedName(id) : true;
        if (allowed) found.set(id, m);
      }
      const more = provider === 'anthropic' ? payload.has_more : provider === 'google' ? !!payload.nextPageToken : false;
      if (provider === 'anthropic' && typeof payload.has_more !== 'boolean') throw failure('INVALID_RESPONSE', 'The provider returned invalid model pagination.');
      if (!more) { metadata = found; metadataBase = base; return [...found.keys()]; }
      cursor = provider === 'anthropic' ? payload.last_id : payload.nextPageToken;
      if (typeof cursor !== 'string' || !cursor || cursor.length > 2048 || cursors.has(cursor)) throw failure('INVALID_RESPONSE', 'The provider returned invalid model pagination.');
      cursors.add(cursor);
    }
    throw failure('RESPONSE_LIMIT', 'The provider model list exceeded the page limit.');
  }

  async function supportsImages(baseUrl, model) {
    const base = normalize(baseUrl);
    if (!idValid(model)) return false;
    if (provider === 'openai') return openAIImages(model);
    if (provider === 'google') return /^gemini-/.test(model.replace(/^models\//, '')) && !unsupportedName(model);
    if (metadataBase !== base || !metadata.has(model)) await listModels(base);
    const m = metadata.get(model);
    if (provider === 'anthropic') return m?.capabilities?.image_input?.supported === true;
    if (provider === 'openrouter') return m?.architecture.input_modalities.includes('image') === true;
    if (provider === 'groq') return !!m && (m.input_modalities ? m.input_modalities.includes('image') : GROQ_VISION_MODELS.has(model));
    // Standard vLLM model metadata does not expose modalities. Let the server
    // decide when unknown; explicit text-only capabilities still reject images.
    if (provider === 'vllm' && m && !m.input_modalities && !m.capabilities) return null;
    return m?.input_modalities?.includes('image') === true || m?.capabilities?.includes?.('vision') === true;
  }

  // Server tools and client functions are distinct capabilities. Do not infer
  // function support from an OpenAI-compatible endpoint or a display label.
  async function supportsLocalTools(baseUrl, model, {signal,tools=[]} = {}) {
    const base=normalize(baseUrl);
    if(signal?.aborted)throw failure('ABORTED','The provider request was stopped.');
    if(!idValid(model)||unsupportedName(model))return false;
    if(provider==='openai') {
      const id=openAIBase(model);
      return openAIChat(model) && !/^o1-(?:mini|preview)(?:-|$)/.test(id) && !/^(?:gpt-4-0314|gpt-4-32k-0314|gpt-3\.5-turbo-0301)$/.test(id) && /^(?:chat-latest$|chatgpt-4o-latest$|gpt-(?:3\.5-turbo|4(?:o|[.-]|$)|5(?:[.-]|$)|6-astra(?:-|$))|o[134](?:-|$))/.test(id);
    }
    // Sonnet/Opus 5 retain the Messages client-tool contract; see docs/research/provider-document-tools.md.
    if(provider==='anthropic')return /^(?:claude-(?:3(?:-|\.)|(?:sonnet|opus|haiku)-4(?:-|\.|$)|(?:sonnet|opus|fable|mythos)-5(?:-|\.|$)))/.test(model);
    if(provider==='google') {const id=model.replace(/^models\//,'');return /^gemini-(?:2\.5|3)(?:[.-]|$)/.test(id) && (!tools.length || /^gemini-3(?:[.-]|$)/.test(id));}
    if(provider==='xai')return /^grok-4(?:[.-]|$)/.test(model);
    if(provider==='groq')return new Set(['openai/gpt-oss-20b','openai/gpt-oss-120b','qwen/qwen3.6-27b','qwen/qwen3.8-27b','minimaxai/minimax-m2.7','llama-3.3-70b-versatile','llama-3.1-8b-instant']).has(model);
    if(!['openrouter','vllm'].includes(provider))return false;
    try {if(metadataBase!==base || !metadata.has(model))await listModels(base,{signal});}
    catch(error){if(signal?.aborted)throw failure('ABORTED','The provider request was stopped.');return false;}
    const info=metadata.get(model);
    return provider==='openrouter' ? Array.isArray(info?.supported_parameters)&&info.supported_parameters.includes('tools') : info?.capabilities?.some(c=>['tools','tool_calling'].includes(c))===true;
  }

  async function streamChat({ baseUrl, model, messages, signal, onDelta, tools = [], onTool, onArtifact, onReplace, onUsage, onModel, onSources, localTools = [], onLocalTool }) {
    validateRequest(model, messages, onDelta);
    require('./hosted-tools.cjs').validateHostedTools(provider,model,tools);
    if(!Array.isArray(localTools))throw failure('INVALID_REQUEST','Provide local tool definitions as an array.');
    if(localTools.length && !await supportsLocalTools(baseUrl,model,{signal,tools}))throw failure('UNSUPPORTED_TOOL','Local document tools are unavailable for this model or tool combination.');
    if (provider === 'openrouter' && model.endsWith(':batch')) throw failure('INVALID_REQUEST', 'Batch models cannot be used in a live chat. Choose the standard model.');
    const telemetry=createTelemetry({onUsage,onModel});
    const base = normalize(baseUrl); let route, payload;
    const protocol = provider === 'openai' && openAILegacyChat(model) ? 'chat' : provider;
    const info = metadataBase === base ? metadata.get(model.replace(/^models\//, '')) : undefined;
    const declaredLimit = provider === 'anthropic' ? info?.max_tokens : provider === 'google' ? info?.outputTokenLimit : provider === 'openrouter' ? info?.top_provider?.max_completion_tokens : provider === 'groq' ? info?.max_completion_tokens : undefined;
    const maxTokens = Math.min(provider === 'vllm' ? 2048 : provider === 'openai' ? openAIOutputLimit(model) : 8192, Number.isInteger(declaredLimit) && declaredLimit > 0 ? declaredLimit : Infinity);
    // The host creates fresh adapters for sends. When catalog metadata is not
    // cached, retain these providers' defaults rather than exceeding a model's
    // (potentially much smaller) output cap with our generic 8,192-token limit.
    const outputLimit = ['openrouter', 'groq'].includes(provider) && !(Number.isInteger(declaredLimit) && declaredLimit > 0) ? {} : provider === 'groq' ? { max_completion_tokens: maxTokens } : { max_tokens: maxTokens };
    if(tools.length || localTools.length){
      const args={baseUrl:base,model,messages,signal,onDelta,tools,onTool:typeof onTool==='function'?onTool:()=>{},onArtifact,onReplace,onUsage,onModel,onSources,localTools,onLocalTool,maxTokens,outputLimit};
      const config={apiKey,...transportOptions};
      if(provider==='openai' && protocol==='chat' || ['vllm','groq'].includes(provider))return require('./local-chat.cjs').streamLocalChat(provider,config,args);
      if(['openai','anthropic','google'].includes(provider))return require('./hosted-core.cjs').streamHostedCore(provider,config,args);
      return require('./hosted-routing.cjs').streamHostedRouting(provider,config,args);
    }
    const system = messages.filter(m => m.role === 'system').map(m => m.content).join('\n\n');
    const images = (m, convert) => (m.images || []).map(data => convert(data, imageType(data)));
    if (protocol === 'openai') {
      route = '/responses';
      payload = { model, stream: true, store: false, max_output_tokens: maxTokens, input: messages.map(m => ({ role: m.role, content: m.images?.length ? [{ type: 'input_text', text: m.content }, ...images(m, (data, mime) => ({ type: 'input_image', image_url: `data:${mime};base64,${data}` }))] : m.content })) };
    } else if (provider === 'anthropic') {
      route = '/messages';
      payload = { model, stream: true, max_tokens: maxTokens, ...(system ? { system } : {}), messages: messages.filter(m => m.role !== 'system').map(m => ({ role: m.role, content: m.images?.length ? [{ type: 'text', text: m.content }, ...images(m, (data, mime) => ({ type: 'image', source: { type: 'base64', media_type: mime, data } }))] : m.content })) };
    } else if (provider === 'google') {
      const id = model.replace(/^models\//, '');
      if (!/^[A-Za-z0-9._-]+$/.test(id)) throw failure('INVALID_REQUEST', 'Choose a valid Gemini model.');
      route = '/models/' + encodeURIComponent(id) + ':streamGenerateContent?alt=sse';
      payload = { ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}), contents: messages.filter(m => m.role !== 'system').map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }, ...images(m, (data, mimeType) => ({ inlineData: { mimeType, data } }))] })), generationConfig: { maxOutputTokens: maxTokens } };
    } else {
      route = provider === 'perplexity' ? '/v1/sonar' : '/chat/completions';
      payload = { model, stream: true, ...(provider === 'openai' ? { store: false, stream_options: { include_usage: true } } : {}), ...(provider === 'openrouter' ? { modalities: ['text'] } : {}), ...outputLimit, messages: messages.map(m => ({ role: m.role, content: m.images?.length ? [{ type: 'text', text: m.content }, ...images(m, (data, mime) => ({ type: 'image_url', image_url: { url: `data:${mime};base64,${data}` } }))] : m.content })) };
    }
    const body = JSON.stringify(payload);
    if (Buffer.byteLength(body) > REQUEST_LIMIT) throw failure('INVALID_REQUEST', 'Chat history exceeded the request size limit.');
    let complete = false, textBytes = 0, chatFinished = false, explicitCitations = false;
    const citations = new Map(), sourceTitles = new Map(), sourceMetadata = createSources(onSources);
    const check = () => { if (signal?.aborted) throw failure('ABORTED', 'The provider request was stopped.'); };
    const emit = (content = '', thinking = '') => {
      if (typeof content !== 'string' || typeof thinking !== 'string') throw failure('INVALID_RESPONSE', 'The provider returned an invalid text delta.');
      textBytes += Buffer.byteLength(content) + Buffer.byteLength(thinking);
      if (textBytes > TEXT_LIMIT) throw failure('RESPONSE_LIMIT', 'The provider generated more than 2 MiB of text.');
      check(); if (content || thinking) onDelta({ content, thinking }); check();
    };
    const record = (text, event) => {
      check();
      if (text === '[DONE]' && (protocol === 'chat' || ['xai', 'vllm', 'openrouter', 'groq', 'perplexity'].includes(provider))) {
        if (!chatFinished) throw failure('EARLY_EOF', 'The provider ended the stream before a finish reason.');
        return (complete = true);
      }
      const p = parseJSON(text);
      if (!object(p)) throw failure('INVALID_RESPONSE', 'The provider returned an invalid stream event.');
      if (Object.hasOwn(p, 'error') || p.type === 'error' || event === 'error' || p.type === 'response.failed') throw failure('PROVIDER_ERROR', 'The provider could not generate a response. Check the model and account access.');
      telemetry.observe(protocol === 'openai' ? 'responses' : protocol, p);
      if (provider === 'perplexity') {
        if (Array.isArray(p.search_results)) for (const s of p.search_results.slice(0,100)) { const url=citationURL(s?.url); if(url && sourceTitles.size<100)sourceTitles.set(url,s?.title); }
        const explicit = Array.isArray(p.citations);
        const sources = explicit ? p.citations : !explicitCitations && Array.isArray(p.search_results) ? p.search_results.slice(0, 100).map(source => source?.url) : undefined;
        if (sources) {
          if (explicit) explicitCitations = true;
          citations.clear();
          for (let index = 0; index < Math.min(sources.length, 100); index++) {
            const url = citationURL(sources[index]);
            if (url) citations.set(index + 1, url);
          }
        }
      }
      if (protocol === 'openai') {
        if (p.type === 'response.output_text.delta' || p.type === 'response.refusal.delta') emit(p.delta);
        else if (p.type === 'response.reasoning_summary_text.delta' || p.type === 'response.reasoning_text.delta') emit('', p.delta);
        else if (p.type === 'response.incomplete') throw failure('INCOMPLETE', 'The provider reached its output limit before completing.');
        else if (p.type === 'response.completed') {
          if (p.response?.status !== 'completed') throw failure('INVALID_RESPONSE', 'The provider returned an invalid completion.');
          complete = true;
        } else if (p.type === 'response.output_item.added' && p.item?.type?.includes('call')) throw failure('UNSUPPORTED_OUTPUT', 'Tool calls are not supported in this chat.');
      } else if (provider === 'anthropic') {
        if (p.type === 'content_block_delta') {
          if (!object(p.delta)) throw failure('INVALID_RESPONSE', 'The provider returned an invalid content delta.');
          if (p.delta.type === 'text_delta') emit(p.delta.text);
          if (p.delta.type === 'thinking_delta') emit('', p.delta.thinking);
          if (p.delta.type === 'input_json_delta') throw failure('UNSUPPORTED_OUTPUT', 'Tool calls are not supported in this chat.');
        } else if (p.type === 'content_block_start' && ['tool_use', 'server_tool_use'].includes(p.content_block?.type)) throw failure('UNSUPPORTED_OUTPUT', 'Tool calls are not supported in this chat.');
        else if (p.type === 'message_delta') {
          if (p.delta?.stop_reason === 'max_tokens') throw failure('INCOMPLETE', 'The provider reached its output limit before completing.');
          if (p.delta?.stop_reason === 'tool_use') throw failure('UNSUPPORTED_OUTPUT', 'Tool calls are not supported in this chat.');
          chatFinished = ['end_turn', 'stop_sequence', 'refusal'].includes(p.delta?.stop_reason);
        } else if (p.type === 'message_stop') {
          if (!chatFinished) throw failure('EARLY_EOF', 'The provider ended the stream before a finish reason.');
          complete = true;
        }
      } else if (provider === 'google') {
        if (p.promptFeedback?.blockReason) throw failure('PROVIDER_ERROR', 'The provider declined this prompt.');
        if (p.candidates !== undefined && !Array.isArray(p.candidates)) throw failure('INVALID_RESPONSE', 'The provider returned invalid candidates.');
        for (const c of p.candidates || []) {
          if (!object(c) || (c.index !== undefined && c.index !== 0)) throw failure('INVALID_RESPONSE', 'The provider returned an unexpected candidate.');
          if (c.content?.parts !== undefined && !Array.isArray(c.content.parts)) throw failure('INVALID_RESPONSE', 'The provider returned invalid content parts.');
          for (const part of c.content?.parts || []) {
            if (!object(part) || part.functionCall || part.toolCall || part.inlineData || part.executableCode) throw failure('UNSUPPORTED_OUTPUT', 'The provider returned unsupported non-text content.');
            if (part.text !== undefined) emit(part.thought ? '' : part.text, part.thought ? part.text : '');
          }
          if (c.finishReason) {
            if (c.finishReason === 'MAX_TOKENS') throw failure('INCOMPLETE', 'The provider reached its output limit before completing.');
            if (c.finishReason !== 'STOP') throw failure('PROVIDER_ERROR', 'The provider stopped before completing this response.');
            complete = true;
          }
        }
      } else {
        if (!Array.isArray(p.choices) || p.choices.length > 1) throw failure('INVALID_RESPONSE', 'The provider returned invalid chat choices.');
        for (const c of p.choices) {
          if (!object(c) || !object(c.delta) || (c.index !== undefined && c.index !== 0)) throw failure('INVALID_RESPONSE', 'The provider returned an invalid chat delta.');
          if (c.delta.tool_calls || c.delta.function_call || c.finish_reason === 'tool_calls') throw failure('UNSUPPORTED_OUTPUT', 'Tool calls are not supported in this chat.');
          emit(c.delta.content ?? '', c.delta.reasoning_content ?? c.delta.reasoning ?? '');
          if (c.finish_reason) {
            if (c.finish_reason === 'length') throw failure('INCOMPLETE', 'The provider reached its output limit before completing.');
            if (c.finish_reason !== 'stop') throw failure('PROVIDER_ERROR', 'The provider stopped before completing this response.');
            chatFinished = true;
          }
        }
      }
      return complete;
    };
    await consume(base + route, { headers, body, signal, onText: sseParser(record) });
    // Sonar can end after the finish chunk without [DONE]. Wait for EOF so any
    // trailing citation/usage chunks are processed before saving the answer.
    if (provider === 'perplexity' && chatFinished) complete = true;
    if (!complete) throw failure('EARLY_EOF', 'The provider closed the response before completion.');
    if (provider === 'perplexity') {
      for (const [number,url] of citations) sourceMetadata.add(url,sourceTitles.get(url),number);
      sourceMetadata.publish();
    }
    if (citations.size) {
      if(provider==='perplexity')onTool?.({id:'sonar-search',kind:'web_search',status:'complete',detail:`${citations.size} sources`});
      const entries = [...citations].sort((a, b) => a[0] - b[0]), seen = new Set();
      const sources = entries.filter(([, url]) => { if (seen.has(url)) return false; seen.add(url); return true; });
      emit('\n\nSources\n\n' + sources.map(([number, url]) => `- [${number} · ${new URL(url).hostname.replace(/[\\`*_{}\[\]()<>]/g, '\\$&')}](<${url}>)`).join('\n') + '\n\n' + entries.map(([number, url]) => `[${number}]: <${url}>`).join('\n'));
    }
  }
  return { listModels, supportsImages, supportsLocalTools, streamChat };
}

module.exports = { createCloudProvider };
