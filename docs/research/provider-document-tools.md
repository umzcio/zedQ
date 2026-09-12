# Provider document functions

Implemented against official API documentation checked September 10, 2026. This extends the existing local artifact executor; it does not add a generic shell, MCP client, file browser, or arbitrary workspace mutation tools.

## Wire protocols and capability gates

| Adapter | Function calls and continuation | zQ capability decision |
| --- | --- | --- |
| OpenAI | Responses `function` tools, complete `response.output` plus matching `function_call_output`; optional schema fields retained with `strict:false` | Known text model families; unsupported old snapshots, o1-mini/preview and specialist models excluded. Legacy GPT-3.5/GPT-4 use Chat Completions. |
| Anthropic | Messages `input_schema`, assembled `tool_use` blocks, following user `tool_result` | Known Claude 3/4 and Sonnet/Opus/Fable/Mythos 5 families; retain native server search/code and pause continuation |
| Google | GenerateContent `functionDeclarations.parametersJsonSchema`, `functionCall`, `functionResponse` | Gemini 2.5/3 text families. Combining local functions and hosted code is gated to Gemini 3. |
| xAI | Responses function calls, full native output, matching function outputs | Grok 4 family; selected web/X tools remain available |
| OpenRouter | Chat Completions function tools and correlated tool-role results | Selected model must advertise `tools` in `supported_parameters`. Server web search remains opt-in, with its shared two-search budget. |
| AWS Bedrock | ConverseStream toolSpec inputSchema, binary streamed toolUse, user toolResult | Exact documented Claude 4/4.1/4.5/4.6 and Nova micro/lite/pro/premier/2-lite IDs in adapter allowlist; known inference profile prefixes supported. Other models stay disabled. |
| Groq (existing connections) | Chat Completions local tools | Documented GPT-OSS, Qwen 3.6/3.8, MiniMax M2.7 and Llama 3.1/3.3 IDs. Compound systems excluded. |
| vLLM | Chat Completions local tools | Requires explicit `tools`/`tool_calling` capability metadata; absent metadata does not establish server parser/template support. |
| Perplexity | Existing Sonar search | No local function integration; separate Agent API is outside this connection's scope. |

OpenAI's [function-calling guide](https://developers.openai.com/api/docs/guides/function-calling) specifies replaying response output with correlated function results. Stateless reasoning uses `reasoning.encrypted_content` with `store:false`, per the [Responses API reference](https://developers.openai.com/api/reference/cli/resources/responses/methods/create). Original reasoning output is passed back unchanged rather than reconstructed from displayed text.

Anthropic's [tool-definition](https://platform.claude.com/docs/en/agents-and-tools/tool-use/define-tools) and [tool-call handling](https://platform.claude.com/docs/en/agents-and-tools/tool-use/handle-tool-calls) guides specify the Messages blocks. zQ preserves signed thinking, redacted blocks, server tool results, and container continuity within a response. The native Messages payload does not include OpenAI-specific `include` fields.

The [Sonnet 5 migration guide](https://platform.claude.com/docs/en/models/sonnet-5/migration-guide) confirms continued client-side tool support, and the tool-definition guide documents Opus 5 client tools. Both IDs must pass the local-function gate even when no hosted tools or installed skills are selected. An outdated gate omitted them and consequently suppressed the document schemas and document instructions. Unknown model families remain rejected; the Models API's `code_execution` capability describes a different feature and is not used as a proxy for client functions.

Google's [GenerateContent function guide](https://ai.google.dev/gemini-api/docs/generate-content/function-calling), [FunctionDeclaration reference](https://ai.google.dev/api/generate-content#FunctionDeclaration), and [tool-combination guide](https://ai.google.dev/gemini-api/docs/generate-content/tool-combination) document the current legacy GenerateContent surface used by zQ. Every returned part is retained, including signatures and code results. Function IDs are echoed when supplied; unsigned or signed parts are never merged. Google's separate Interactions API is not silently substituted.

xAI documents mixed hosted/client execution and complete native history replay in [advanced tool usage](https://docs.x.ai/developers/tools/advanced-usage) and [function calling](https://docs.x.ai/developers/tools/function-calling). zQ accepts whole calls and validates any streamed argument fragments against the final output. No provider-side conversation storage is requested.

OpenRouter's [function calling](https://openrouter.ai/docs/guides/features/tool-calling), [server web search](https://openrouter.ai/docs/guides/features/server-tools/web-search), and [reasoning tokens](https://openrouter.ai/docs/guides/best-practices/reasoning-tokens) describe the mixed route. zQ retains reasoning_details and annotations with each assistant tool message, honors known model output caps, and reduces/removes the hosted search allowance across local continuations.

Bedrock uses [client-side tool use](https://docs.aws.amazon.com/bedrock/latest/userguide/tool-use-client-side.html) and preserves [reasoning signatures/redacted data](https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_ReasoningContentBlockDelta.html). Model references include [Claude Sonnet 4.6](https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-anthropic-claude-sonnet-4-6.html), [Nova Converse](https://docs.aws.amazon.com/nova/latest/userguide/using-converse-api.html), and [Nova 2 tools](https://docs.aws.amazon.com/nova/latest/nova2-userguide/using-tools.html). Server-tool-use blocks are not executed locally.

vLLM requires configured auto-tool choice, a compatible parser, and a suitable chat template; these are operator choices, as documented in [vLLM tool calling](https://docs.vllm.ai/en/latest/features/tool_calling/). Groq's [supported tool models](https://console.groq.com/docs/tool-use/overview) distinguish local tools from Compound's built-in execution. Perplexity's [integration guidance](https://docs.perplexity.ai/docs/getting-started/integrations/agno) distinguishes Sonar from richer agent orchestration; zQ does not advertise unimplemented Sonar function calls.

## Execution and data behavior

The shell advertises only three document functions. A complete, valid terminal response is required before execution. The whole call batch is checked against current and earlier call IDs before any new dispatch. Repeated identical IDs reuse the result; changed IDs fail. Calls are limited to 12 per response, four document writes, 120 KiB of tool JSON, and the original shared request deadline. Callback waits honor cancellation, including while rendering; canceled work cannot commit a later artifact version. Provider-specific request, stream, activity, file, and output limits remain enforced.

The formatter creates PDF/DOCX/XLSX/PPTX from bounded source text and typography. Revisions require reading an accessible base and preserve immutable version history. Imported provider-created files without editable source remain downloadable and viewable but cannot be rewritten by these functions. Existing artifact UI and context menus are reused; this change adds no new list, tab, card, or menu surface.

## Validation

Tests use isolated temporary stores and synthetic API streams. `cloud-document-revisions.test.cjs` drives the real native adapters through ChatService and ArtifactService for OpenAI, Anthropic, Gemini, xAI and OpenRouter: create, read, revise, reload, verify original bytes and saved typography. It also stops an OpenAI revision while rendering to verify no late commit.

`anthropic-document-tools.test.cjs` covers Sonnet 5/Opus 5 capability gates, schema and correlated result continuation through the native Anthropic adapter, and both models creating actual DOCX packages through ChatService. It verifies the document XML, saved artifact content, matching response attachment, and reload from isolated stores with no hosted tools or skills enabled.

Provider fixtures cover Bedrock binary frames, schemas, source retention, reasoning signatures, argument fragments, matching results, duplicated/changed IDs, malformed/incomplete output, shared budgets, output caps, cancellation and timeout cleanup. Browser regression checks exercise the actual composer, revision preview, historical version selection, right-click revision and pane navigation. Cloud account access, billing, and live inference are not established by these fixtures. No paid cloud calls or normal-workspace test mutations were used.
