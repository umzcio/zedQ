# Local providers and Bedrock: tool execution research

Checked against current official documentation on 2026-09-09. Scope: Ollama native `/api/chat`, vLLM Chat Completions, AWS Bedrock `ConverseStream` using the saved bearer API key, and existing hidden Groq connections. No inference requests, credentials, account changes, or source changes were used for this research.

## Protocol choices for zQ

| Provider | Client tool declaration | Incoming arguments | Result correlation | Executor |
|---|---|---|---|---|
| Ollama native | `tools[].function.parameters` | Object in `message.tool_calls[].function.arguments` | `tool_name`, plus call ordering | zQ |
| vLLM Chat Completions | `tools[].function.parameters` | JSON string fragments in indexed SSE tool deltas | `tool_call_id` | zQ |
| Bedrock ConverseStream | `toolConfig.tools[].toolSpec.inputSchema.json` | JSON string fragments in indexed binary EventStream blocks | `toolUseId` | zQ for client tools |
| Groq Chat Completions | `tools[].function.parameters` | Chat Completions tool-call data | `tool_call_id` | zQ for client tools |

The following sections substantiate these mappings. Do not collapse these protocols into a single wire format. A shared execution interface can accept a validated `{id, name, arguments}` while each adapter owns assembly and continuation serialization.

## Ollama native chat

Send the existing `model`, `messages`, and `stream: true` fields, adding function definitions. `arguments` in an Ollama response is an object, unlike OpenAI-compatible JSON-string arguments. The native chat reference documents `tools`, `think`, `done`, and `done_reason`; it does not document native `tool_choice` or `parallel_tool_calls` parameters. Do not assume that fields from Ollama's separate OpenAI-compatible endpoint work here. [Native chat reference](https://docs.ollama.com/api/chat).

Illustrative declaration and reply shapes:

```js
tools: [{
  type: 'function',
  function: {
    name: 'zq_find_notes',
    description: 'Find notes by title',
    parameters: {
      type: 'object',
      properties: { query: { type: 'string' } },
      required: ['query']
    }
  }
}]
// Assistant message:
{ role: 'assistant', content: '', thinking: '', tool_calls: [
  { function: { name: 'zq_find_notes', arguments: { query: 'meeting' } } }
] }
// Subsequent tool result:
{ role: 'tool', tool_name: 'zq_find_notes', content: '{"matches":[]}' }
```

Streaming requires accumulating `thinking` and `content` strings and appending tool calls supplied by each message chunk. The official streaming example appends call objects; it does not concatenate JSON argument strings. Preserve the assembled assistant message, then append all results and call chat again with the same tool definitions. Repeat until no calls remain. Parallel examples include repeated calls to the same function with different arguments, so a function name is not a unique invocation identity. Native examples use `function.index` for call ordering and `tool_name` on results rather than requiring an OpenAI `tool_call_id`. zQ should create internal invocation IDs without altering native correlation semantics. [Tool calling and streaming examples](https://docs.ollama.com/capabilities/tool-calling).

Model discovery: `POST /api/show` with `{model}` returns a `capabilities` array and the model's template. This is a read-only capability lookup, preferable to inferring support from the provider name. The endpoint's example is not an exhaustive capability enumeration. Use explicit server capability metadata when available; treat older/missing metadata as unknown rather than advertising universal support. [Show model details](https://docs.ollama.com/api-reference/show-model-details).

Provider-managed web access is separate: Ollama exposes authenticated `POST https://ollama.com/api/web_search` and `/api/web_fetch`. Search takes `query` and optional `max_results` (default 5, maximum 10). This requires an Ollama account API key, unlike zQ's current keyless local Ollama connection. The documented agent still executes these APIs in its application loop and sends results back. It recommends roughly 32K or more context for search agents. A local model does not gain web access merely by declaring a function. [Ollama web search](https://docs.ollama.com/capabilities/web-search).

**Implementation recommendation:** accept complete object arguments only on the native path; bound depth, serialized size, call count, and names. Wait for successful turn termination before execution. Treat an incomplete stream as an unexecuted turn. Retain raw assistant fields for continuation independently of the text displayed in the UI.

## vLLM Chat Completions

Use the standard function envelope shown above and `tool_choice: 'auto'`. Automatic choice requires server flags `--enable-auto-tool-choice` and a matching `--tool-call-parser`; the chat template must handle prior assistant calls and tool-role results. Some tokenizer templates already support this; others require `--chat-template`. Named choice and `required` use structured outputs. `required` is documented from vLLM 0.8.3 onward. `none` disables calls, although tool definitions remain in the prompt unless the operator enables `--exclude-tools-when-tool-choice-none`.

Current strict-mode behavior is more capable than older vLLM releases: auto-mode constraints require an opted-in `strict: true` tool, a structural-tag-capable parser, and enabled `VLLM_ENFORCE_STRICT_TOOL_CALLING` (currently default true). Otherwise arguments can violate the schema. Named/required calls use constrained decoding. These guarantees do not establish semantic correctness. Parser choice depends on model family; do not pick a parser from zQ or change a user's server implicitly. [vLLM tool calling](https://docs.vllm.ai/en/latest/features/tool_calling/).

The official streaming example groups fragments by `delta.tool_calls[].index`, takes the supplied call ID/name, and concatenates `function.arguments`. Follow-up appends the complete assistant tool-call message (including reasoning) and one `role: 'tool'` message per call with `tool_call_id`, `name`, and string `content`, then requests another completion. [Current streaming and continuation example](https://docs.vllm.ai/en/latest/examples/tool_calling/openai_chat_completion_client_with_tools/).

Illustrative continuation:

```js
{ role: 'assistant', content: null, tool_calls: [{
  id: 'call_a', type: 'function',
  function: { name: 'zq_find_notes', arguments: '{"query":"meeting"}' }
}] }
{ role: 'tool', tool_call_id: 'call_a', name: 'zq_find_notes',
  content: '{"matches":[]}' }
```

**Implementation recommendation:** use a map keyed by index for all entries in each delta, not only the first entry or most recent call ID. IDs/names can be absent in later fragments. Reject conflicting identities, unknown tools, duplicate IDs, invalid final JSON, and calls from unsuccessful/truncated turns. Parse once complete, validate the resulting object, and execute only registered functions. `/models` success does not verify the operator's parser/template configuration; preserve an actionable setup error instead of silently falling back to executing textual pseudo-calls.

Do not describe vLLM as having no server tools at all. Its separate Responses API has an official MCP example using `--tool-server demo`, `tools: [{type:'mcp', server_label, server_url}]`, and additional environment settings. That is a different API and operator deployment, not a built-in capability of zQ's current Chat Completions adapter. [vLLM Responses MCP example](https://docs.vllm.ai/en/latest/examples/tool_calling/openai_responses_client_with_mcp_tools/).

## AWS Bedrock ConverseStream

Keep the existing regional runtime endpoint, SDK binary EventStream decoder, bearer-only configuration, and model/profile IDs. Tool specifications are request data; they do not require local AWS credentials. Bearer keys authenticate Bedrock and Bedrock Runtime APIs, subject to the key's IAM permissions. [API key reference](https://docs.aws.amazon.com/bedrock/latest/userguide/api-keys-reference.html).

The exact request field is `toolConfig`, with a nonempty `tools` array when supplied. Each client function occupies a `toolSpec` entry. [ToolConfiguration](https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_ToolConfiguration.html).

```js
toolConfig: {
  tools: [{ toolSpec: {
    name: 'zq_find_notes',
    description: 'Find notes by title',
    inputSchema: { json: {
      type: 'object',
      properties: { query: { type: 'string' } },
      required: ['query']
    } }
  } }],
  toolChoice: { auto: {} }
}
```

Tool names must match `[a-zA-Z0-9_-]+` and be 1–64 characters. `strict` is an optional `toolSpec` boolean for structured output enforcement. Do not infer universal model support for strict mode from the schema alone. [ToolSpecification](https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_ToolSpecification.html).

`toolChoice` is a union: `{auto:{}}` is the default; `{any:{}}` requests at least one tool; `{tool:{name}}` forces a specific tool where the model supports it. There is no documented `none` member; omit tools when disabled. The API reference's forced-choice compatibility text names Claude 3 and Nova, so avoid advertising it for every newer model without model-specific evidence. [ToolChoice](https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_ToolChoice.html).

### Binary stream assembly

The stream's `contentBlockIndex` identifies independently assembled blocks. Tool blocks begin with `contentBlockStart.start.toolUse`, carrying `name` and `toolUseId`. IDs are 1–64 characters matching `[a-zA-Z0-9_.:-]+`. An optional `type: 'server_tool_use'` explicitly distinguishes server activity. Never dispatch that as a zQ function. [ToolUseBlockStart](https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_ToolUseBlockStart.html).

Tool argument fragments arrive as `contentBlockDelta.delta.toolUse.input`, a **string**, not the final input object. Concatenate per block; parse and validate only after the block finishes. [ToolUseBlockDelta](https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_ToolUseBlockDelta.html).

Collect normal text, reasoning, and tool blocks in original order. `contentBlockStop` closes a block; `messageStop.stopReason === 'tool_use'` ends a tool-requesting turn. Continue reading terminal metadata and require a clean stream rather than executing as soon as a fragment happens to parse. `max_tokens`, errors, cancellation, and unfinished blocks must not execute pending actions. These are zQ execution recommendations applied to the documented event structure. [ConverseStream](https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_ConverseStream.html).

### Continuation and reasoning

Reconstruct the assistant message using native `toolUse` blocks with parsed JSON `input`. Add a user message containing corresponding `toolResult` blocks and resend history plus the same tool configuration. AWS's client-side example explicitly appends the assistant output before the results and requests another response. [Client-side tool use](https://docs.aws.amazon.com/bedrock/latest/userguide/tool-use-client-side.html).

```js
{ role: 'assistant', content: [{ toolUse: {
  toolUseId: 'call_a', name: 'zq_find_notes', input: { query: 'meeting' }
} }] }
{ role: 'user', content: [{ toolResult: {
  toolUseId: 'call_a', content: [{ json: { matches: [] } }]
} }] }
```

Results support an array of typed content blocks. Prefer `{json:...}` or `{text:...}` initially. `status: 'success' | 'error'` is optional and the current reference limits its support to Nova and Claude 3/4. For other families use a textual/JSON error result without assuming this field works. [ToolResultBlock](https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_ToolResultBlock.html).

Reasoning text alone is insufficient native continuation data. If replaying reasoning, retain the text and its `signature` unchanged; UI concatenation cannot reconstruct that signature. [ReasoningTextBlock](https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_ReasoningTextBlock.html). **Implementation recommendation:** preserve ordered native blocks, signature fragments, and opaque/redacted reasoning separately from the user-facing thinking disclosure. Do not copy reasoning between providers/models. Capability checks must distinguish Converse chat support from tool support; AWS maintains model-specific API compatibility. [Model API compatibility](https://docs.aws.amazon.com/bedrock/latest/userguide/models-api-compatibility.html).

### Hosted tools and Mantle are separate

AWS describes client-side function execution across several APIs, server-side Lambda/AgentCore execution currently on Responses, and Anthropic-defined client tools using Messages request shapes. These are separate modes. [Tool-use modes](https://docs.aws.amazon.com/bedrock/latest/userguide/tool-use.html).

The hosted Responses integration registers MCP-style Lambda or AgentCore connectors, backed by AWS permissions; AgentCore examples require `require_approval: 'never'` and IAM-authenticated gateways. AWS also documents automatically available session-scoped `notes` and `tasks` tools for GPT-OSS on Mantle Responses. They are provider session state, unrelated to zQ Notes/Tasks. This does not expose local zQ functions automatically. [Server-side tool use](https://docs.aws.amazon.com/bedrock/latest/userguide/tool-use-server-side.html).

Converse's `Tool` union now includes `systemTool` as well as `toolSpec` and `cachePoint`; `SystemTool` selects a provider-defined tool by name. The opened reference does not supply an authoritative model/name matrix. Consequently the initial implementation should allow only registered client `toolSpec`s and treat hosted/system tool support as unconfigured, not claim the API cannot represent it. [Tool union](https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_Tool.html), [SystemTool](https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_SystemTool.html).

Claude predefined computer, bash, editor, memory, and bundled client toolsets still require application execution and returned results. Their Messages-specific types and beta controls cannot simply be placed in Converse `toolSpec`. Fine-grained streaming can produce incomplete JSON; no execution should occur before complete validated arguments. The AWS Claude page explicitly says Anthropic's `web_search_20250305` server tool is unsupported on Bedrock. [Claude-specific tool use](https://docs.aws.amazon.com/bedrock/latest/userguide/model-parameters-anthropic-claude-messages-tool-use.html).

## Hidden legacy Groq connections

Retain function-call support on saved connections using Chat Completions tool definitions, assistant call history, and `role:'tool'` results correlated by ID. `tool_choice` supports auto, required, none, and a named function; Groq documents model attempts violating forced/disabled choice as possible HTTP 400 errors. Its streaming guide accumulates tool calls and checks `finish_reason:'tool_calls'` before execution. **Recommendation:** use the defensive OpenAI-compatible indexed fragment assembler rather than assuming every streamed array entry is a complete call. [Groq local tool calling](https://console.groq.com/docs/tool-use/local-tool-calling).

Current support varies: Qwen 3.6 and Llama chat models support parallel calls; Qwen 3.8 and GPT-OSS do not in the current table. Compound/Compound Mini support hosted tools, not client functions or remote MCP. Do not apply a provider-wide tools flag to every Groq model. [Groq tool overview](https://console.groq.com/docs/tool-use/overview).

Compound uses `compound_custom.tools.enabled_tools` with web search, website visits, code execution, and Wolfram Alpha; its `executed_tools` are already-run events. GPT-OSS supports `browser_search` and `code_interpreter` tool types. Neither event should invoke a local function again. These are separate optional provider services, not prerequisites for zQ's client tools. [Groq built-in tools](https://console.groq.com/docs/tool-use/built-in-tools).

## Engineering conclusions and deterministic verification

These are implementation recommendations, not additional provider guarantees:

- Keep discovery/connection testing read-only. Discover model capabilities or report unknown; do not generate a paid tool call merely to validate a key.
- Preserve complete assistant turns, including tool-only turns, ordered calls, opaque native reasoning, and results. Tool history cannot be reconstructed from displayed text.
- Execute after a successful, completely assembled turn. Schema validation, tool-name lookup, invocation identity, workspace scope, and operation authorization belong in the native executor.
- Bound tools per request, calls per turn, argument bytes/depth, result bytes, total loop turns, total duration, and accumulated context. Published provider pages do not establish a uniform portable maximum; choose explicit zQ limits and identify them as application limits.
- Correlate each call once. A network retry must not repeat a completed mutation. Stop/cancel must prevent future tool dispatch and follow-up inference.
- Keep hosted execution events observational; never rerun them locally. Do not add environment/profile-based credentials or let tool arguments override provider endpoints.
- Test repeated same-name Ollama calls, partial OpenAI-compatible argument fragments/interleaved indices, Bedrock tool/text/reasoning blocks, signatures, tool-only turns, error results, unknown names, cancellation, stream truncation, output-limit termination, and loop exhaustion using fixtures. Test actual mutations only in an isolated workspace.

Open questions before enabling additional advanced modes: vLLM server version/parser capabilities; Bedrock system-tool name/model matrix; model-specific strict/forced-choice support; and rich tool-result modalities. None blocks a bounded client-function loop on explicitly supported models.
