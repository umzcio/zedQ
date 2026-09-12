# Provider tool routing: xAI, Perplexity, OpenRouter

Researched 2026-09-09 against the official pages linked below. No paid inference requests were made. Payloads below are integration examples, not captured production responses. Search-index summaries proved stale for both Perplexity and OpenRouter; use the directly opened current pages and canonical endpoints.

## Execution boundaries

| Provider/API | Provider executes | Application executes | zQ consequence |
| --- | --- | --- | --- |
| xAI Chat Completions | No agentic built-ins | Function calls | Move tool-enabled turns to Responses |
| xAI Responses | Search, X search, Python, images, collections, remote MCP | `function_call` | Hosted tools need typed output handling, not a local function dispatcher |
| Perplexity Sonar `/v1/sonar` | Its integrated research/search | Do not infer a general tool executor from Sonar citations | Preserve existing Sonar behavior |
| Perplexity Agent `/v1/agent` | Explicit search/fetch/sandbox/people/finance tools, remote MCP | Custom functions | Separate protocol, catalog, artifact, and state integration |
| OpenRouter Chat Completions | Supported `openrouter:*` server tools; plugins transform requests | Standard functions | Web search can fit the existing route |
| OpenRouter Responses/Messages | Additional hosted shell capabilities | Custom functions and client-mode tools | Hosted shell is a separate integration, not a Chat plugin |

These boundaries follow [xAI's API comparison](https://docs.x.ai/developers/model-capabilities/text/comparison), [Perplexity tool overview](https://docs.perplexity.ai/docs/agent-api/tools/overview), [Sonar migration](https://docs.perplexity.ai/docs/agent-api/migrate-from-sonar/how-to), and [OpenRouter server tools](https://openrouter.ai/docs/guides/features/server-tools).

## xAI

### Requests and capabilities

Use `POST https://api.x.ai/v1/responses`, bearer authorization, and JSON. Responses takes `input` instead of `messages`, `max_output_tokens` instead of `max_tokens`, and defaults to storing responses. Explicit `store:false` suits zQ's locally owned conversation history. Chat Completions is now described as deprecated and supports functions only. [API comparison](https://docs.x.ai/developers/model-capabilities/text/comparison)

Example hosted request:

```json
{"model":"grok-4.6","input":[{"role":"user","content":"Research the latest release."}],"store":false,"stream":true,"max_output_tokens":8192,"tools":[{"type":"web_search"},{"type":"x_search"}],"include":["web_search_call.action.sources"]}
```

Grok chooses and executes built-ins inside that request. Current examples use `grok-4.6`; do not assume every historical Grok identifier supports every built-in. The documented built-in names include `web_search`, `x_search`, `code_interpreter`, `file_search`, and `image_generation`. [Tool overview](https://docs.x.ai/developers/tools/overview)

Web filters use `{"type":"web_search","filters":{"allowed_domains":["example.com"]}}` or `excluded_domains`; the lists are mutually exclusive and limited to five domains. `enable_image_understanding` exposes image inspection; `enable_image_search` allows image-search results in text. [Web search](https://docs.x.ai/developers/tools/web-search)

X search has tool-level `allowed_x_handles` or `excluded_x_handles` (mutually exclusive, up to 20), `from_date`, `to_date` (ISO dates), and image/video understanding flags. It searches posts, users, and threads. [X search](https://docs.x.ai/developers/tools/x-search)

### Tool output, continuation, and streams

Responses output types distinguish local requests from remote execution: `function_call` requires the client; `web_search_call`, `x_search_call`, `code_interpreter_call`, `file_search_call`, and `mcp_call` represent hosted activity. Do not execute a hosted event locally. SDK usage tracks attempted calls separately from successful, billable calls. `max_turns` bounds assistant iterations rather than individual parallel calls; each client continuation starts a fresh budget. The guide's `max_turns` examples are SDK examples; the REST reference exposes `max_tool_calls` in responses without an adequate rendered request-field explanation. Do not treat those names as interchangeable without confirming the wire schema. [Tool usage](https://docs.x.ai/developers/tools/tool-usage-details), [advanced usage](https://docs.x.ai/developers/tools/advanced-usage), [REST Responses](https://docs.x.ai/developers/rest-api-reference/inference/responses)

Text streaming uses `response.output_text.delta` with `delta`. Typed output items should be accumulated until a completed response, preserving IDs and final item payloads. Exact exhaustive tool-specific SSE schemas were not exposed in the opened rendered REST reference: fixture tests based on the Responses typed-item envelope are necessary, and a later authorized live smoke test should confirm provider-specific event sequences. Do not claim this research is live-wire verification. Large tool results are opt-in: `include` supports `web_search_call.action.sources`, `code_interpreter_call.outputs`, and `file_search_call.results`. [Streaming and sync](https://docs.x.ai/developers/tools/streaming-and-sync)

Custom-function example (for future client tools):

```json
{"type":"function","name":"lookup_note","description":"Read a selected note","parameters":{"type":"object","properties":{"id":{"type":"string"}},"required":["id"]}}
```

After an output item with `type:function_call`, `name`, JSON-string `arguments`, and `call_id`, execute only an allowlisted application function. Continue with `input:[{"type":"function_call_output","call_id":"call_1","output":"{\"text\":\"note content\"}"}]`, repeat tool definitions, and use `previous_response_id` when using stored state; alternatively replay the complete relevant output/input history. Parallel function calls default on; return all results before the next request. [Function calling](https://docs.x.ai/developers/tools/function-calling)

Responses enables inline citations by default. Text may contain `[[N]](url)` links, while `output_text.annotations` carries structured source data. Disabling inline citations with `include:["no_inline_citations"]` does not necessarily remove annotations; non-positional annotations can represent encountered rather than cited sources. Preserve that distinction in the UI. [Citations](https://docs.x.ai/developers/tools/citations)

### Python, generated files, collections, and cost

`{"type":"code_interpreter"}` provides hosted Python with common scientific libraries. The documented environment has no external network/filesystem access, is temporary between requests, and has unspecified memory/runtime constraints. The inspected code documentation does not provide a dependable generated-file download protocol. Expose computation/logs only if implemented; do not present arbitrary code outputs as downloadable artifacts without verifying actual file output schemas. [Code execution](https://docs.x.ai/developers/tools/code-execution)

Image generation is separately documented: `{"type":"image_generation"}` returns `image_generation_call` items, with raw base64 in `result` (no data-URL prefix). This can produce a validated local image artifact; it is distinct from Python file output. [Image tool](https://docs.x.ai/developers/tools/image-generation)

Collections require previously created/uploaded/processed documents. Responses uses `{"type":"file_search","vector_store_ids":["collection_id"],"max_num_results":10}`. Collection management needs a management key, while inference/search uses the normal inference key. This requires resource lifecycle UI and is not a zero-configuration toggle. [Collections search](https://docs.x.ai/developers/tools/collections-search), [REST authentication](https://docs.x.ai/developers/rest-api-reference/inference)

On the research date, web search, X search, and Python each cost $5/1,000 successful invocations in addition to model tokens; collections search costs $2.50/1,000, attachment search $10/1,000. X search pricing changes September 21, 2026 at noon Pacific to $5/1,000 fetched posts and $10/1,000 fetched profiles. Usage-based display must account for the change rather than permanently encoding per-call pricing. [Pricing](https://docs.x.ai/developers/pricing)

## Perplexity

### Sonar is not the Agent API

Keep zQ's existing `/v1/sonar` implementation and citation behavior. The migration guide now names `POST https://api.perplexity.ai/v1/agent` as the canonical Agent endpoint, taking Responses-shaped `input`. Sonar's `sonar` becomes `perplexity/sonar` in Agent examples; third-party models also use provider-qualified IDs. Agent search must be explicitly enabled. Search controls move under the tool's `filters`. [Migration guide](https://docs.perplexity.ai/docs/agent-api/migrate-from-sonar/how-to)

The current index has a separate Router `/v1/responses` API, while the Agent streaming cookbook still describes `/v1/responses` as an Agent alias. This is a documentation ambiguity; prefer `/v1/agent` for new hosted-tool work and do not conflate Router and Agent capabilities. [Official index](https://docs.perplexity.ai/llms.txt), [Agent quickstart](https://docs.perplexity.ai/docs/agent-api/quickstart), [streaming cookbook](https://docs.perplexity.ai/docs/cookbook/articles/streaming-citations/README)

Example future Agent payload:

```json
{"model":"perplexity/sonar","input":"Research the release and calculate its growth rate.","stream":true,"max_steps":4,"max_output_tokens":4096,"tools":[{"type":"web_search","filters":{"search_domain_filter":["example.com"]}},{"type":"fetch_url"},{"type":"sandbox"}]}
```

Built-ins are `web_search`, `fetch_url`, `sandbox`, `finance_search`, and `people_search`. Remote `mcp` and managed connectors are separate integrations; custom functions yield execution to the client. Do not imply enabling Agent sandbox grants access to zQ's local files. [Tools overview](https://docs.perplexity.ai/docs/agent-api/tools/overview)

`max_steps` is 1–100 and defaults to 1 for direct-model requests without a preset. Finance search requires at least 3 steps in that mode. Anthropic model requests require `max_output_tokens`; omission returns HTTP 400. Not every third-party model supports every feature, so a generic provider-level function capability is insufficient. [Agent reference](https://docs.perplexity.ai/api-reference/agent-post), [models](https://docs.perplexity.ai/docs/agent-api/models)

### Custom functions, continuation, citations

Function definitions are flat Responses tools: `type`, `name`, `description`, `parameters`, optionally `strict:true`. Functions return `function_call` items; parse their JSON-string `arguments` and return `function_call_output` matched by `call_id`. Replay original input plus model calls/results; preserve Gemini `thought_signature` when present. The current custom-functions guide illustrates explicit history replay. [Custom functions](https://docs.perplexity.ai/docs/agent-api/tools/custom-functions)

Stateful continuation accepts `previous_response_id` only for a completed prior response in the same account. Re-send desired instructions/tools/settings. **Perplexity `store:false` hides retrieval; it does not disable persistence or continuation.** zQ must not copy an OpenAI-style privacy assumption onto this flag. [Conversation state](https://docs.perplexity.ai/docs/agent-api/conversation-state)

SSE text arrives through `response.output_text.delta`; completion exposes `event.response.usage`. `response.reasoning.search_results` contains `results` per search. Accumulate every batch and map `[N]` references to each result's `id`, not its array offset. Non-streaming responses contain multiple `search_results` output items. Migration docs additionally name `response.output_item.*` and `response.reasoning.*` event families. [Output control](https://docs.perplexity.ai/docs/agent-api/output-control), [citation cookbook](https://docs.perplexity.ai/docs/cookbook/articles/streaming-citations/README)

### Sandbox and artifact resources

The sandbox is Linux with Python and bash, network access, runtime package installation, shared state within one response, and approximately 1 MiB capture per stdout/stderr stream. The exact execution timeout is not specified; 20 minutes is a billing window, not the runtime cap. Output is `sandbox_results` with `call_id`, `container_id`, `language`, `code`, status, and `results[]` entries containing stdout/stderr, `exit_code`, `duration_ms`, and status. Sandbox code can call Perplexity search/fetch/people tools even if those tools were not separately added to the request; those calls incur charges. [Sandbox](https://docs.perplexity.ai/docs/agent-api/tools/sandbox)

Generated files are signaled by `share_file` items and fetched separately: `GET /v1/agent/{response_id}/files`, then `GET /v1/agent/{response_id}/files/{file_id}/content`. These return metadata and raw bytes respectively. Artifact ingestion needs size limits, safe filenames, MIME/content validation, and durable local copies. Long jobs can use background requests with polling/cancellation. [Working with files](https://docs.perplexity.ai/docs/agent-api/working-with-files)

Search/people/finance tools cost $0.005 per invocation; fetch costs $0.0005. Sandbox costs $0.03 per container session plus tokens and any tools invoked inside it. Response usage includes itemized costs; model costs vary by model/service tier. Sonar keeps its distinct token/request/search-context charging. [Pricing](https://docs.perplexity.ai/docs/getting-started/pricing)

## OpenRouter

### Client functions and hosted search

Client functions retain the nested Chat Completions schema:

```json
{"type":"function","function":{"name":"lookup_note","parameters":{"type":"object","properties":{"id":{"type":"string"}},"required":["id"]}}}
```

Preserve the assistant message containing `tool_calls`, then append `role:tool`, `tool_call_id`, and string `content` for each result. Repeat `tools` on every request. Discover model support through `supported_parameters` containing `tools`; streaming arguments require accumulation before execution. An SDK's automatic loop still executes your supplied functions in the application, not on OpenRouter. [Client tools](https://openrouter.ai/docs/guides/features/tool-calling.md)

Server tools run within OpenRouter's loop; plugins run once as request/response processing. The current beta tool catalog includes search/fetch/datetime/images, shell/bash, apply-patch, model/tool discovery, and model consultation/delegation. The outer `max_tool_calls` defaults to and caps at 30; `stop_server_tools_when` can override it. [Server tools](https://openrouter.ai/docs/guides/features/server-tools)

Example bounded hosted search on existing Chat Completions:

```json
{"model":"google/gemini-3-flash-preview","messages":[{"role":"user","content":"Research the latest release."}],"stream":true,"max_tool_calls":2,"tools":[{"type":"openrouter:web_search","parameters":{"engine":"exa","max_results":5,"max_total_results":10,"max_uses":2}}]}
```

The search tool supports `auto`, `native`, `exa`, `firecrawl`, `parallel`, and `perplexity` engines. `max_results` is 1–25 (Perplexity 1–20). Native search ignores several result/context controls and forwards `max_uses` only for Anthropic; explicit Exa avoids that ambiguity for a bounded first implementation. The older `web` plugin and `:online` are deprecated in the server-search guide. Prices depend on the engine, in addition to model tokens. [Web search](https://openrouter.ai/docs/guides/features/server-tools/web-search)

Web fetch uses `openrouter:web_fetch` with optional `engine`, `max_uses`, `max_content_tokens`, `allowed_domains`, and `blocked_domains`. Exa/Parallel cost $1/1,000 fetches; OpenRouter direct fetch is free plus model tokens, Firecrawl is BYOK, native cost passes through. [Web fetch](https://openrouter.ai/docs/guides/features/server-tools/web-fetch)

Chat SSE uses `data:` JSON choices/deltas and `[DONE]`; handle keepalive comments and in-stream errors even after HTTP 200. Preserve annotations and report failure/truncation, never turn a client `tool_calls` finish into a successful answer. Search citation annotations use `type:url_citation` and nested `url_citation` fields (`url`, `title`, offsets/content). [Streaming](https://openrouter.ai/docs/api_reference/streaming), [web plugin citation schema](https://openrouter.ai/docs/guides/features/plugins/web-search)

### PDF parsing is not document search or Python

PDF messages use a `file` content part with `file.filename` and `file.file_data` (URL or base64 data URL). Configure `plugins:[{"id":"file-parser","pdf":{"engine":"cloudflare-ai"}}]`; other engines are `mistral-ocr` and `native`. `pdf-text` now redirects to `cloudflare-ai`. Cloudflare parsing is free, native is token-priced, OCR is charged separately even for BYOK. The rendered pricing page omitted numeric OCR prices, so they were not inferred. Preserve returned file annotations (`file.hash`, `name`, `content`) across turns to avoid repeat parsing. OCR forwards at most eight extracted images per request. [PDF inputs](https://openrouter.ai/docs/guides/overview/multimodal/pdfs)

### Hosted code exists, but needs a different route

`openrouter:shell` is available only on Responses/Messages, global `openrouter.ai`; Chat Completions returns 400. Configuration supports `engine:openrouter` and `environment:{type:container_auto}` or a container reference. Calls contain command arrays and return per-command stdout/stderr plus exit/timeout outcomes. Default timeout is two minutes, capped at five; default output is 16,384 characters per stream, capped at 65,536; at most 100 commands per call. Network is disabled by default; an explicit allowlist allows selected hosts. Sandbox compute is $0.0001/second with 30-second startup minimum. [Shell](https://openrouter.ai/docs/guides/features/server-tools/shell)

`openrouter:bash` is Messages-only and can have client or server execution semantics, so its presence is not proof that OpenRouter executes it. This is not a `code_interpreter` plugin. [Bash](https://openrouter.ai/docs/guides/features/server-tools/bash)

Containers save home-directory files after commands, sleep after five idle minutes, and retain saved files for 30 days after last use. Reuse preserves saved files, not running processes/environment state. Tool results report at most ten changed files. Attach up to 20 previously uploaded workspace files. Download through `GET /api/v1/containers/{container_id}/files/{file_id}/content`; promotion copies a file into longer-lived workspace storage. Session-derived container IDs have normalization/truncation rules; explicit per-conversation IDs are safer than assuming arbitrary zQ IDs are copied verbatim. [Containers](https://openrouter.ai/docs/guides/features/containers)

## Implementation recommendation for the current task

Implement xAI web/X search via Responses and OpenRouter hosted web search on Chat Completions, with separate protocol parsers and bounded request configuration. Keep Perplexity Sonar search working. Record other researched capabilities as requiring separate resource/protocol work; do not expose nonfunctional toggles. In particular, Python file generation, PDF indexing, remote shell, MCP, managed connectors, and application function execution are not interchangeable capabilities.

Use the existing secure provider transport (pinned URLs, no redirects, bounded request/wire/text sizes, idle/total deadlines, abort propagation). Every send supplies fresh selected tools. Preserve tool status and source information separately from answer text. Reject unexpected client-execution requests. Treat code, arguments, logs, filenames, and citations as untrusted provider data. Artifact writes belong to host-owned storage and must be tested in an isolated workspace.

Before broader capability release, obtain authorized wire fixtures for provider-specific tool events, code outputs, unknown events, limits, and cancellation. Deterministic tests can verify parsers and safety boundaries without paid calls, but cannot establish model availability or actual billing behavior.
