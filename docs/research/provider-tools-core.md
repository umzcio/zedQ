# Provider tools: OpenAI, Anthropic, Gemini

Researched 2026-09-09 against official pages opened or fetched during this task. No inference requests, account changes, or paid calls were made. This document distinguishes documented API behavior from zQ implementation recommendations. Scope: the existing Responses (`store:false`), Messages, and `streamGenerateContent` transports. Hosted tools are the recommended first release; custom function protocols are recorded for subsequent work.

Implementation scope subsequently selected: OpenAI/Anthropic hosted search and code; Gemini hosted code. Google Search remains unavailable until the Search Suggestions and retention/reuse requirements have a complete product flow. Each user turn starts fresh hosted execution state; only Anthropic's internal `pause_turn` continuations preserve native blocks/container state. Cross-turn sandbox persistence and the richer provider-state recommendation below are future work. Text streams through `onDelta` when the caller supplies `onReplace`; that callback finalizes the full answer with citations and removes temporary sandbox links. Generated artifacts are stored separately through the awaited `onArtifact` callback.

## Implementation decision

Implement a provider-native hosted-tools adapter, with normalized activity, citations, and artifacts for the chat UI. Preserve the native response alongside the displayed text. A text-only transcript cannot faithfully continue tool conversations: providers carry encrypted reasoning, result references, IDs, and execution state outside text. Keep hosted tool activity separate from client function requests; hosted code never means executing model code on this Mac.

Recommended adapter output: `{text, activity, citations, artifacts, providerState, usage}` in addition to streaming callbacks. `providerState` must be scoped to provider connection, model, and conversation branch. Provider switching may carry ordinary display text when appropriate, but must never replay another provider's opaque blocks. Google Search content also has the specific reuse restrictions below.

| Provider | Initial hosted web configuration | Initial hosted code configuration | Main completion concern |
| --- | --- | --- | --- |
| OpenAI Responses | `{type:"web_search"}` | `{type:"code_interpreter",container:{type:"auto"}}` | Preserve output items; fetch generated container files before expiry |
| Anthropic Messages | `{type:"web_search_20250305",name:"web_search",max_uses:5}` | `{type:"code_execution_20260521",name:"code_execution"}` | Continue `pause_turn`; persist full assistant blocks and container ID |
| Gemini generateContent | `{googleSearch:{}}` | `{codeExecution:{}}` | Preserve content parts and grounding metadata; display Search Suggestions |

The table's configurations follow the tool guides linked in the provider sections. The limit of five Anthropic searches and choice to start with its basic search version are zQ defaults, not provider requirements. Newer search versions can be supported separately once their automatic code execution and context behavior are intentionally handled.

## OpenAI

### Hosted web

Send `tools` to `POST /v1/responses`. Prefer GA `web_search` over the legacy preview name. The server returns `web_search_call` items; `action.type` distinguishes search, page-open, and page-find activity. Final assistant output has `url_citation` annotations carrying URL/title and text offsets. Citations must be visible and clickable. `include:["web_search_call.action.sources"]` requests the complete consulted-source list, which differs from cited sources. Optional controls include domain filters, `search_context_size`, and live-access control. Search context remains limited to 128k. Generic legacy Chat Completions does not accept Responses built-ins: its search path uses a specialized search model and `web_search_options`. Do not silently change the selected model to make a toggle work. [Official OpenAI web search guide](https://developers.openai.com/api/docs/guides/tools-web-search)

### Hosted code and files

The code tool requires a container. Auto mode creates one or reuses an active container represented in prior code-call context; default memory is 1 GB, with 4/16/64 GB alternatives. `code_interpreter_call` carries its container ID and code/output information. Generated-file annotations use `container_file_citation` with `container_id`, `file_id`, and `filename`. Input files are uploaded into the execution container. Containers expire after 20 minutes of inactivity; expired data cannot be recovered. Download artifacts while active. [Code Interpreter guide](https://developers.openai.com/api/docs/guides/tools-code-interpreter)

Fetch bytes using authenticated `GET /v1/containers/{container_id}/files/{file_id}/content`. These are provider API resources, not public download URLs. zQ should download through its trusted provider service, enforce size/MIME limits, save into its artifact storage, and replace generated sandbox links with local artifact references. Persist explicit download failures instead of leaving an apparently working link. [Container file content reference](https://developers.openai.com/api/reference/resources/containers/subresources/files/subresources/content/methods/retrieve)

### Streaming and continuation

Handle `response.output_item.added/done` by output index and item ID. Hosted activity events are `response.web_search_call.in_progress/searching/completed` and `response.code_interpreter_call.in_progress/interpreting/completed`. Code arrives through `response.code_interpreter_call_code.delta/done`; annotations through `response.output_text.annotation.added`. Keep code deltas outside the answer text. Reconcile streamed state against the completed output rather than appending the same final text twice. Treat response failure/incomplete events separately from tool completion; a completed tool does not establish successful overall completion. [Responses streaming reference](https://developers.openai.com/api/reference/resources/responses/streaming-events)

With `store:false`, replay the full prior output items, including reasoning items and their opaque `encrypted_content`. Current documentation says stateless reasoning returns encrypted content automatically; legacy `include:["reasoning.encrypted_content"]` remains accepted. Do not reconstruct history solely from the visible answer, and do not depend on stored `previous_response_id` state for zQ's stateless path. Preserve provider state privately rather than rendering encrypted content as reasoning. [Reasoning and stateless continuation](https://developers.openai.com/api/docs/guides/reasoning)

### Client function protocol (future phase)

Responses declarations use `{type:"function",name,description,parameters,strict:true}`. For strict object schemas, require every property and set `additionalProperties:false`; represent optional values with nullable types. The output `function_call` has `name`, JSON-string `arguments`, `id`, and a distinct `call_id`. Accumulate `response.function_call_arguments.delta` until done, validate, execute only registered authorized code, then append `{type:"function_call_output",call_id,output:"..."}` after the response output in the next request. Handle multiple calls and repeated rounds. `tool_choice` supports automatic, required, none, and named selection; `parallel_tool_calls:false` restricts parallel function calling. Chat Completions uses a different declaration wrapper (`function:{...}`), `delta.tool_calls[index]`, assistant `tool_calls`, and `role:"tool",tool_call_id` replies. [Function calling guide](https://developers.openai.com/api/docs/guides/function-calling)

### Capability and billing gates

Do not infer built-in support from “supports functions” or a broad `gpt-` prefix. Model pages must establish both tool and streaming support. For example, GPT-6 Astra lists streaming, web search, and Code Interpreter; GPT-5.5 Pro lists the tools but explicitly lacks streaming. A streaming-only implementation must disable that combination or add a real non-streaming transport. Older model pages may omit tool matrices; omission is not positive evidence. [GPT-6 Astra](https://developers.openai.com/api/docs/models/gpt-6-astra), [GPT-5.5 Pro](https://developers.openai.com/api/docs/models/gpt-5.5-pro), [GPT-4.1](https://developers.openai.com/api/docs/models/gpt-4.1)

Current GA web search costs $10/1,000 calls plus search-content tokens. Some small-model search content is charged as a fixed token block. Containers list $0.03/$0.12/$0.48/$1.92 for 1/4/16/64 GB per 20-minute session; the pricing page also describes eligible minute-based sessions with a five-minute minimum. Show that tools add charges; do not calculate an exact bill from answer tokens alone. [Official OpenAI pricing](https://developers.openai.com/api/docs/pricing)

## Anthropic

### Hosted search

Messages accepts versioned server tools. Basic `web_search_20250305` is the simplest initial choice. Newer `web_search_20260209` adds dynamic filtering and `_20260318` adds response inclusion controls. Search output interleaves `server_tool_use`, `web_search_tool_result`, and text blocks. Citations use `web_search_result_location` with URL, title, cited text, and `encrypted_index`; preserve the encrypted reference for later turns. Tool-level errors are inside result content, even when HTTP succeeds. Optional `max_uses` limits searches; allowed and blocked domains cannot both be supplied. Retain usage's `server_tool_use.web_search_requests`. [Web search guide](https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-search-tool)

### Server loop and version interactions

Never execute a `server_tool_use` locally or manufacture a client result for it. `pause_turn` means resend the full paused assistant content unchanged with the same tools, repeating with an application-level continuation cap. Mixed client/server turns instead stop with `tool_use`; return only client results and let the server finish deferred calls. Newer dynamic-filter search automatically provisions code; combining it with an explicit code tool requires version `20260120` or later. `allowed_callers:["direct"]` disables dynamic filtering, is required on models without programmatic tool calling, and changes ZDR eligibility. [Server tools guide](https://platform.claude.com/docs/en/agents-and-tools/tool-use/server-tools)

### Hosted code

Current code versions `20250825`, `20260120`, and `20260521` require no beta header. The latest adds accurate per-cell timeout guidance; `20260120+` supports persistent REPL/programmatic calling where the model supports it. Calls appear as `bash_code_execution` or `text_editor_code_execution` server blocks, with matching `*_tool_result` blocks. Bash results contain stdout, stderr, return code, and generated-file content. Capture top-level `container.id` for reuse. Containers expire 30 days after creation; `expires_at` is a shorter rolling timestamp, not that lifetime. Supported families include Opus 4.5–5, Sonnet 4.5/4.6/5, Haiku 4.5, Fable 5/5.1, and Mythos 5/5.1; Haiku lacks the newer REPL/programmatic behavior. Resources include 5 GiB RAM, 5 GiB storage, and one CPU. [Code execution guide](https://platform.claude.com/docs/en/agents-and-tools/tool-use/code-execution-tool)

### Generated files

Generated file IDs appear in `bash_code_execution_tool_result`; use `GET /v1/files/{file_id}/content` and metadata to download them. Files uploaded by the client cannot themselves be downloaded by this endpoint; only metadata marked `downloadable:true` qualifies. The Files API is now GA: remove the former `files-api-2025-04-14` beta header. Files are scoped to the provider workspace, so accept only IDs actually returned for this conversation. They persist until deletion or configured expiration. Input datasets use `container_upload` blocks. [Files guide and current migration notes](https://platform.claude.com/docs/en/build-with-claude/files)

zQ should obtain generated bytes promptly, retain provider file metadata privately, and show actual artifact availability. Preserve filenames from metadata after sanitizing them. Do not expose authenticated provider URLs or treat a model-written `/mnt/...` link as an accessible file. Add artifact actions (Open, Save As, Reveal when local, Copy name) consistently with existing zQ menus. Remote deletion requires deliberate lifecycle design because follow-up code may still need the resource.

### Streaming

Build content blocks by `index`: `content_block_start`, deltas, then `content_block_stop`. Accumulate `input_json_delta.partial_json` and parse after the block closes. Server result blocks arrive complete at block start; their arrival resolves the matching server call. `message_delta` supplies final stop reason and cumulative usage; require `message_stop`, and handle SSE `error` after HTTP 200. Ignore harmless unknown event types without treating unknown actionable content as executed. Preserve thinking signatures and non-text blocks in native state. [Streaming Messages](https://platform.claude.com/docs/en/build-with-claude/streaming), [server result streaming](https://platform.claude.com/docs/en/agents-and-tools/tool-use/server-tools)

### Client function protocol (future phase)

Declare `{name,description,input_schema}`; optional `strict:true` enforces inputs on supported models. Selection uses `{type:"auto"|"any"|"none"}` or `{type:"tool",name}`. Manual extended thinking forbids forced `any/tool`; adaptive thinking differs, and some new models also prohibit forcing. Use automatic selection by default. [Define tools](https://platform.claude.com/docs/en/agents-and-tools/tool-use/define-tools)

On `stop_reason:"tool_use"`, preserve assistant content and reply immediately with `role:"user",content:[{type:"tool_result",tool_use_id,content,is_error?}]`. Return every parallel call's result together, before any user text. When server tools remain unresolved, the result message must contain only result blocks. Tool errors belong in `is_error:true`, not fabricated successful content. This protocol also underlies Anthropic-defined client tools such as Bash; the named Bash tool is not the hosted code service. [Handle tool calls](https://platform.claude.com/docs/en/agents-and-tools/tool-use/handle-tool-calls)

### Billing

Search costs $10/1,000 searches plus token costs; failed searches are not billed. Code has 1,550 free container-hours per organization monthly, then $0.05/hour, with five-minute minimum execution time. Preloaded files may start billing even without a code call. With `web_search_20260209+` or `web_fetch_20260209+`, code adds no separate execution charge beyond tokens. Therefore basic search plus code and newer dynamic-filter search have different billing behavior. Keep server tool usage separate from token totals. [Claude pricing](https://platform.claude.com/docs/en/about-claude/pricing)

## Google Gemini

### Transport boundary

The current site also documents Interactions, whose steps and server state differ. zQ's existing transport is `POST /v1beta/models/{model}:streamGenerateContent?alt=sse`, which streams `GenerateContentResponse` objects with `candidates[].content.parts`, `groundingMetadata`, `finishReason`, and usage. Use the explicitly named **Generate Content API (Legacy)** guides below; do not copy Interactions `steps` or continuation IDs into this adapter. Accumulate candidate content and metadata through the terminal response, including parts without visible text. [generateContent reference](https://ai.google.dev/api/generate-content)

### Google Search

Use `tools:[{googleSearch:{}}]`. Search runs on Google's server without a client tool response. `groundingMetadata` carries `webSearchQueries`, `groundingChunks` (source URI/title), `groundingSupports` (text segments and source indices), and `searchEntryPoint.renderedContent` (Search Suggestions). Build citations from supports and chunks; a Sources list alone does not preserve claim associations. Search Suggestions are also required. Current guides list support for Gemini 2.5 and current Gemini 3 models, but older/deprecated catalog entries require separate checking. [Google Search grounding](https://ai.google.dev/gemini-api/docs/generate-content/google-search)

The Search terms are a real product requirement: display grounded results with their associated suggestions, do not add tracking of specific result/suggestion clicks, and do not repurpose results into a search index or automated collection. A chat-history exception permits grounded-result text storage up to two years for that user's history; other storage/reuse has narrower exceptions. Google retains grounding prompts/context/output for 30 days. zQ must resolve native grounding metadata retention and cross-provider transcript reuse before offering persistent Google Search; a general-purpose “save everything forever and replay anywhere” policy is not covered by these terms. This is an implementation concern identified from the source, not a request for new user approval. [Gemini API terms, Search section](https://ai.google.dev/gemini-api/terms)

### Hosted code and output

Use `tools:[{codeExecution:{}}]`. Parse `executableCode:{language,code}` and `codeExecutionResult:{outcome,output}` separately from text; Google runs Python and can iterate after execution errors. The documented runtime is 30 seconds; packages are fixed. I/O supports file input and output `inlineData` bytes, including plots. Persist validated `inlineData.mimeType/data` as artifacts. The guide contains contradictory legacy wording saying media artifacts cannot be returned, despite its I/O examples and output specification; implement the concrete parts schema and do not promise arbitrary artifact formats without tests. There is no separate code-enabling fee, but execution-related tokens contribute to billing; the guide's intermediate-token prose also warrants retaining raw usage rather than estimating from text. [Code execution and I/O](https://ai.google.dev/gemini-api/docs/generate-content/code-execution)

### Functions, opaque state, and tool combinations

Define `{functionDeclarations:[{name,description,parameters}]}`. A returned `functionCall` has name, object arguments, and (on Gemini 3) an ID. Preserve the entire model content and append a user `functionResponse` part containing the same name/ID and an object result. Support multiple calls and repeated rounds. Function-only requests default to `AUTO`; `ANY` forces calling, `NONE` disables it, and `VALIDATED` constrains calls while permitting text. Automatic execution described in the Python SDK does not apply to zQ's raw HTTP client. [Function calling guide, fetched directly when web extraction failed](https://ai.google.dev/gemini-api/docs/generate-content/function-calling)

Gemini 3 function turns require `thoughtSignature` replay; omitting it produces validation errors. Preserve original part boundaries and ordering, including empty-text signature parts. Do not interleave each parallel call with its result: preserve all model calls first, then all results. Gemini 2.5 signature behavior differs. Never use documented dummy signature escape hatches to conceal dropped native history. [Thought signatures](https://ai.google.dev/gemini-api/docs/generate-content/thought-signatures)

Gemini 3 can combine server tools and client functions using `toolConfig:{includeServerSideToolInvocations:true}`. Responses then include built-in `toolCall`/`toolResponse` parts with IDs, tool types, arguments/results, and signatures; code retains its own executable/result parts. Replay **all** parts and fields. With context circulation enabled, `AUTO` is unsupported and the default is `VALIDATED`. The flag also exposes built-in context without function declarations. Recommendation: initially use hosted tools alone; only enable circulation after lossless replay tests, which also improves observable search activity. [Tool combination guide](https://ai.google.dev/gemini-api/docs/generate-content/tool-combination)

### Billing and capability controls

Gemini 3 Search is billed per executed query, potentially several per prompt; Gemini 2.5 billing is per grounded prompt. Current Gemini 3 pricing lists 5,000 free search requests monthly shared across the family, then $14/1,000; model/tier details apply. Do not equate a chat send with one billable search. [Grounding billing explanation](https://ai.google.dev/gemini-api/docs/generate-content/google-search), [Gemini pricing](https://ai.google.dev/gemini-api/docs/pricing)

Use an explicit verified tool capability map, not `generateContent` support or the `gemini-` prefix. A model can generate chat while lacking a tool, and a catalog can retain obsolete names. Allow unknown capabilities to display an explanation rather than making a paid probing request. For new models, verify the specific official model page and test the fixture contracts before exposing toggles.

## Required fixture coverage before implementation is complete

These are zQ recommendations derived from the protocols above:

1. Responses search/code events interleaved with text; annotations both streamed and finalized; no doubled answer; final error after tool completion; container file download success, failure, and expiry.
2. Anthropic `pause_turn` with exact replay, repeated pauses and capped continuation; server tool result error inside HTTP 200; fragmented JSON; generated file IDs; result blocks at block start; cancellation between continuation requests.
3. Gemini executable/result/inline-data parts interleaved with text; metadata arriving late; grounding supports with multiple sources; missing suggestions; empty signature-bearing parts; terminal safety/finish errors.
4. Persist/reload and branch the same native conversation; switch provider/model without leaking opaque state; changing tools mid-conversation; unsupported model selected with remembered toggles.
5. UI activity is derived from actual provider events. Enabling a tool does not prove it ran. Interrupted activities remain interrupted, unknown outcomes remain unknown, and unavailable artifact downloads remain visibly unavailable.
6. Streaming network cancellation stops further continuation/download work; bound bytes, activity count, native state, and artifact size. Reuse existing trusted networking and storage boundaries; no provider credentials enter renderer state.

## Additional catalogue verification (2026-09-09)

The following official pages were opened during a second check of commonly selected models. Several older OpenAI model pages no longer contain hosted-tool tables; their streaming and function support alone does not establish hosted web/code support. Model-specific guidance supplies additional evidence where indicated.

| Exact OpenAI IDs | Streaming | Hosted web / Code Interpreter evidence |
| --- | --- | --- |
| `gpt-4.1`, `gpt-4.1-2025-04-14` | Supported | Both explicitly listed in the GPT-4.1 guidance. |
| `gpt-5`, `gpt-5-2025-08-07` | Supported | Both explicitly listed in the GPT-5 guidance. Web search cannot use `minimal` reasoning. |
| `gpt-5.1`, `gpt-5.1-2025-11-13` | Supported | Both explicitly listed in the GPT-5.1 guidance, including web with `none` reasoning. |
| `gpt-5.4`, `gpt-5.4-2026-03-05` | Supported | Model page explicitly lists both as supported Responses tools. |
| `gpt-5.4-nano`, `gpt-5.4-nano-2026-03-17` | Supported | Model page explicitly lists both as supported Responses tools. |
| `gpt-4o`, `gpt-4o-2024-08-06`, `gpt-4o-2024-11-20`, `gpt-4o-2024-05-13` | Supported | Responses hosted-tool support was not established by this bounded check; historical Assistants code examples do not establish the Responses path. |
| `gpt-5.2`, `gpt-5.2-2025-12-11` | Supported | Current guidance describes custom code tools and local shell, which must not be confused with hosted Code Interpreter. Individual hosted-tool support remains unverified here. |
| `gpt-5-mini`, `gpt-5-mini-2025-08-07`; `gpt-5-nano`, `gpt-5-nano-2025-08-07` | Supported | GPT-5 guidance names these family members but does not give individual tool matrices. Do not infer every family member's hosted-tool support from its singular GPT-5 statement. |

Streaming and snapshot sources: [GPT-4.1](https://developers.openai.com/api/docs/models/gpt-4.1), [GPT-4o](https://developers.openai.com/api/docs/models/gpt-4o), [GPT-5](https://developers.openai.com/api/docs/models/gpt-5), [GPT-5.1](https://developers.openai.com/api/docs/models/gpt-5.1), [GPT-5.2](https://developers.openai.com/api/docs/models/gpt-5.2), [GPT-5.4](https://developers.openai.com/api/docs/models/gpt-5.4), [GPT-5 mini](https://developers.openai.com/api/docs/models/gpt-5-mini), [GPT-5 nano](https://developers.openai.com/api/docs/models/gpt-5-nano), [GPT-5.4 nano](https://developers.openai.com/api/docs/models/gpt-5.4-nano).

Hosted-tool sources: [GPT-4.1 guidance](https://developers.openai.com/api/docs/guides/latest-model?model=gpt-4.1), [GPT-5 guidance](https://developers.openai.com/api/docs/guides/latest-model?model=gpt-5), [GPT-5.1 guidance](https://developers.openai.com/api/docs/guides/latest-model?model=gpt-5.1), [GPT-5.2 guidance](https://developers.openai.com/api/docs/guides/latest-model?model=gpt-5.2), [web-search limitations](https://developers.openai.com/api/docs/guides/tools-web-search). An unverified cell is a documentation gap, not evidence that the API rejects the tool. Dated IDs are the model page's named snapshots; do not allow arbitrary date suffixes on that basis.

Google's [Gemini 3.5 Flash model page](https://ai.google.dev/gemini-api/docs/models/gemini-3.5-flash) explicitly lists code execution and search grounding, with exact stable ID `gemini-3.5-flash` and preview ID `gemini-3-flash-preview`. The [Gemini 3 guide](https://ai.google.dev/gemini-api/docs/gemini-3) independently documents code execution for `gemini-3-flash-preview`. The [3.5 guide](https://ai.google.dev/gemini-api/docs/whats-new-gemini-3.5) explicitly retains GenerateContent support. Streaming is documented in the [GenerateContent text guide](https://ai.google.dev/gemini-api/docs/generate-content/text-generation), and hosted code in its [code guide](https://ai.google.dev/gemini-api/docs/generate-content/code-execution). This supports adding the two exact Flash IDs to code capabilities by combining model-specific code support with the documented transport; no exact-model combined streaming/code example was found in this check. The model page's unsupported Live API refers to a different protocol. Google web support remains subject to the integration constraints above.
