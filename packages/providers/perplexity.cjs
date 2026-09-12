const { createCloudProvider } = require('./native.cjs');
const { createTransport, failure, object, parseJSON, MODEL_LIMIT } = require('./transport.cjs');

// Sonar has a published catalog, not the Agent/Router API's /models catalog.
// https://docs.perplexity.ai/api-reference/sonar-post
const SONAR_MODELS = Object.freeze(['sonar', 'sonar-pro', 'sonar-reasoning-pro', 'sonar-deep-research']);

function createPerplexityProvider(options, normalize) {
  const native = createCloudProvider('perplexity', options, normalize);
  const consume = createTransport(options);
  return {
    async listModels(baseUrl) {
      let text = '';
      // Authenticate using the read-only async request index. Its contents are
      // discarded; never generate a billable completion just to test a key.
      await consume(normalize(baseUrl) + '/v1/async/sonar', {
        headers: { Authorization: `Bearer ${options.apiKey}` }, maxBytes: MODEL_LIMIT,
        onText(chunk) { text += chunk; },
      });
      const payload = parseJSON(text);
      if (!object(payload) || Object.hasOwn(payload, 'error') || !Array.isArray(payload.requests)) {
        throw failure('INVALID_RESPONSE', 'Perplexity could not verify this connection.');
      }
      return [...SONAR_MODELS];
    },
    async supportsImages(baseUrl, model) {
      normalize(baseUrl);
      // Official media examples explicitly document Sonar Pro image input.
      return model === 'sonar-pro';
    },
    async streamChat(args) {
      if (!SONAR_MODELS.includes(args.model) || typeof args.onDelta !== 'function') throw failure('INVALID_REQUEST', 'Choose a supported Sonar model and response handler.');
      // Sonar reasoning models prefix their answer with a streamed <think>
      // block. Keep that in the existing Thinking disclosure, including tags
      // split over SSE chunks, without interpreting tags elsewhere in an answer.
      let phase = 'prefix', pending = '';
      const deliver = (content = '', thinking = '') => { if (content || thinking) args.onDelta({ content, thinking }); };
      const delta = ({ content = '', thinking = '' }) => {
        if (thinking) deliver('', thinking);
        pending += content;
        if (phase === 'prefix') {
          const prefix = pending.trimStart();
          if ('<think>'.startsWith(prefix) && prefix !== '<think>' && pending.length < 1024) return;
          if (prefix.startsWith('<think>')) { phase = 'thinking'; pending = prefix.slice(7); }
          else phase = 'answer';
        }
        if (phase === 'thinking') {
          const end = pending.indexOf('</think>');
          if (end !== -1) { deliver('', pending.slice(0, end)); pending = pending.slice(end + 8); phase = 'answer'; }
          else {
            let keep = 0;
            for (let n = 1; n < 8 && n <= pending.length; n++) if (pending.endsWith('</think>'.slice(0, n))) keep = n;
            deliver('', pending.slice(0, pending.length - keep)); pending = pending.slice(pending.length - keep); return;
          }
        }
        deliver(pending); pending = '';
      };
      await native.streamChat({ ...args, onDelta: delta });
      if (phase === 'thinking') throw failure('INCOMPLETE', 'Perplexity stopped before completing its answer.');
      deliver(pending);
    },
  };
}

module.exports = { createPerplexityProvider };
