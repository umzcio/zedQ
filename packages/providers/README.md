# Native model providers

`@zq/providers` is used by the desktop main process. Construct an adapter with
`createProvider(provider, { apiKey, fetchImpl?, idleMs?, totalMs? })`. The API key
belongs only in this constructor; the package does not persist credentials.
`createOllamaProvider` and `normalizeBaseUrl` retain their existing behavior.

`normalizeConnection({ provider, baseUrl })` returns only `{ provider, baseUrl }`.
Cloud bases are fixed official HTTPS URLs. Ollama and vLLM accept validated HTTP
or HTTPS endpoints without credentials, query strings, or fragments. A vLLM base
is normalized to end in `/v1`, including when a reverse proxy has a base path.

All adapters implement `listModels(baseUrl)`, `supportsImages(baseUrl, model)`,
and `streamChat({ baseUrl, model, messages, signal, onDelta })`. Messages contain
`role`, string `content`, and optional user `images` as base64. New adapters infer
PNG/JPEG/WebP MIME types from byte signatures. `onDelta` receives
`{ content, thinking }`. Optional hosted execution adds `tools`, `onTool`,
`onArtifact`, and `onReplace`. `hostedToolOptions(provider, model)` returns only
verified implemented choices; native validation rejects unsupported selections.
`onReplace(content)` reconciles final source markup with streamed text without
adding the answer twice. Artifact callbacks receive bounded base64 bytes only
inside the native host. Hosted tools never execute a local function or command.
See [the capability matrix](../../docs/providers.md#provider-hosted-tools-chat-160)
and [official API research](../../docs/research/provider-tools-core.md).

`supportsImages` normally resolves a boolean. For vLLM it resolves `null` when a
served model has no modality metadata, allowing the host to try an image request
and let the server decide. Explicit text-only metadata resolves `false`.

## Protocols and discovery

| Provider | Protocol | Discovery |
| --- | --- | --- |
| OpenAI | Responses; legacy GPT-3.5/GPT-4 and ChatGPT-4o use Chat Completions; `store: false` | `/models`, filtered to supported text/chat model families |
| Anthropic | Messages | `/models`, up to 10 pages / 1,000 models |
| Google | Gemini `streamGenerateContent?alt=sse` | `/models`, `generateContent` support, up to 10 pages / 1,000 models |
| xAI | Chat Completions | `/language-models`, text output and input modalities |
| vLLM | Chat Completions | `/v1/models`, excludes explicit embedding-only capabilities |
| Perplexity | Sonar `/v1/sonar`, streamed text/reasoning and numbered source links | Published Sonar catalog after read-only authenticated `/v1/async/sonar` check |
| OpenRouter | Chat Completions | Authenticated `/key` check, then `/models`, filtered by text input/output modalities |
| Groq (legacy saved connections) | Chat Completions | Authenticated `/models`, active chat models only |
| AWS Bedrock | Native ConverseStream via AWS SDK | Regional foundation models and system inference profiles, filtered to supported streaming chat |
| Ollama | Existing NDJSON `/api/chat` | Existing `/api/tags` |

Discovery selects model IDs returned by the account/server, except Perplexity,
which exposes its published Sonar catalog. No model is enabled automatically. OpenAI model metadata does not describe endpoint or image
capabilities, so family/name filtering is conservative and may need updating as
new model families appear. Legacy instruct/base/completion-only variants are
excluded. Fine-tune capability checks use the underlying model name while
requests preserve the full fine-tune ID. Known vision aliases include GPT-4
Turbo, ChatGPT-4o, and `chat-latest`; text-only Turbo previews and o3-mini do not
advertise image support. Google generation methods do not fully describe
modalities either; known image/audio/video generation names are excluded.
vLLM deployments must serve generation models with a chat template. Standard
vLLM model metadata cannot prove chat or image support; the server remains the
authority for those requests.

Each SSE request has a 90-second idle deadline and a fixed 10-minute deadline,
including connection and body reads. Limits are 12 MiB for request JSON, 4 MiB
for streamed wire bytes, 2 MiB for generated text/thinking, and 1 MiB per model
metadata page. Cloud generation requests allow up to 8,192 output tokens, reduced
to a smaller discovered Anthropic/Google model limit when available. Legacy
OpenAI families with smaller limits use a conservative 4,096-token cap; vLLM keeps
a 2,048-token cap. Reaching an output cap is reported as incomplete. The adapter
does not retry generation automatically.

Redirects are refused; keys stay in headers. HTTP and provider failures never
include raw response bodies. Arbitrary fetch/body exceptions are replaced with
a generic network error so errors persisted by the host cannot contain a key,
request body, or transport diagnostics. Abort cancels readers and late responses.
Only provider terminal events complete streams; EOF alone is insufficient.

Conversation history contains text and images only. Provider-issued opaque
reasoning signatures/state are not retained. Native thinking deltas are surfaced
when the provider sends them; this package does not enable model-specific
extended-thinking options or claim every model exposes reasoning text.

## Validation and official references

Run `node --test apps/desktop/tests/cloud-providers.test.cjs apps/desktop/tests/chat-provider.test.cjs`
from the repository root. Tests use fixture transports, with no paid inference.
Fixtures cover request serialization, fragmented UTF-8/SSE, terminal and error
events, model pagination/filtering, limits, deadlines, abort and redirect safety.

Protocols were checked against official documentation on 2026-09-09:

- [OpenAI conversation state](https://developers.openai.com/api/docs/guides/conversation-state), [streaming](https://developers.openai.com/api/docs/guides/streaming-responses), [image inputs](https://developers.openai.com/api/docs/guides/images-vision), and [models](https://developers.openai.com/api/reference/resources/models/methods/list).
- OpenAI model-specific checks: [legacy instruct](https://developers.openai.com/api/docs/models/gpt-3.5-turbo-instruct), [GPT-3.5 Turbo](https://developers.openai.com/api/docs/models/gpt-3.5-turbo), [GPT-4](https://developers.openai.com/api/docs/models/gpt-4), [GPT-4 Turbo](https://developers.openai.com/api/docs/models/gpt-4-turbo), [Turbo Preview](https://developers.openai.com/api/docs/models/gpt-4-turbo-preview), [ChatGPT-4o](https://developers.openai.com/api/docs/models/chatgpt-4o-latest), [Chat Latest](https://developers.openai.com/api/docs/models/chat-latest), and [o3-mini](https://developers.openai.com/api/docs/models/o3-mini). Legacy endpoint descriptions are clearer about Chat Completions than Responses, so legacy models use the former.
- [Anthropic Messages](https://platform.claude.com/docs/en/api/messages/create), [streaming events](https://platform.claude.com/docs/en/build-with-claude/streaming), and [model pagination/capabilities](https://platform.claude.com/docs/en/api/models/list).
- [Gemini content and streaming](https://ai.google.dev/api/generate-content) and [model discovery](https://ai.google.dev/api/models).
- [xAI Chat Completions](https://docs.x.ai/developers/rest-api-reference/inference/chat-completions) and [language model metadata](https://docs.x.ai/developers/rest-api-reference/inference/models). xAI recommends Responses for new integrations; its supported stateless Chat Completions interface is used here.
- [vLLM OpenAI-compatible server](https://docs.vllm.ai/en/latest/serving/online_serving/openai_compatible_server/).

## Additional providers (September 9, 2026)

OpenRouter uses `https://openrouter.ai/api/v1`; Groq uses
`https://api.groq.com/openai/v1`; Perplexity uses `https://api.perplexity.ai`.
Setup checks never generate a paid completion. Perplexity discards the read-only
async index after validating its response; it does not import remote history.
Its Sonar catalog is separate from Perplexity Agent/Router model IDs. Sonar Pro
accepts image attachments; other Sonar models currently use text attachments.
Leading Sonar `<think>` blocks feed the existing Thinking disclosure. Citation
URLs become persisted numbered Markdown references and source links after a
successful response, with HTTP(S) validation and bounded size/count.

Official references: [Sonar API](https://docs.perplexity.ai/api-reference/sonar-post),
[read-only authentication check](https://docs.perplexity.ai/api-reference/async-sonar-get),
[Sonar media](https://docs.perplexity.ai/docs/sonar/media),
[OpenRouter key](https://openrouter.ai/docs/api/api-reference/api-keys/get-current-key),
[OpenRouter models](https://openrouter.ai/docs/guides/overview/models),
[Groq API](https://console.groq.com/docs/api-reference).

## AWS Bedrock

Bedrock uses `https://bedrock-runtime.{region}.amazonaws.com`, pinned by native
validation. API keys stay in the native client configuration (Bearer token only),
with no environment mutation or AWS profile fallback. The official AWS SDK
decodes the native EventStream. No generation retries are enabled.

References: [ConverseStream](https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_ConverseStream.html),
[API key use](https://docs.aws.amazon.com/bedrock/latest/userguide/api-keys-use.html),
[foundation models](https://docs.aws.amazon.com/bedrock/latest/APIReference/API_ListFoundationModels.html),
[inference profiles](https://docs.aws.amazon.com/bedrock/latest/APIReference/API_ListInferenceProfiles.html),
[model API compatibility](https://docs.aws.amazon.com/bedrock/latest/userguide/models-api-compatibility.html),
[regional endpoints](https://docs.aws.amazon.com/general/latest/gr/bedrock.html).
