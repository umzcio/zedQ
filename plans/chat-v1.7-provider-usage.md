# Provider-reported usage — 2026-09-09

All current adapters accept optional `onUsage({inputTokens?,outputTokens?,cachedInputTokens?,reasoningTokens?})` and `onModel(model)` callbacks. Usage notifications are cumulative snapshots of the full response. Repeated snapshots are not added. Separate Anthropic hosted `pause_turn` continuation requests are added once each. The host should replace its current usage snapshot, not add callback values.

Only provider counters and model identifiers are exposed. Missing fields remain missing, valid zeroes remain zero, and malformed fields are ignored. Counters must be nonnegative safe integers. Model identifiers are bounded valid UTF-8 without whitespace/control characters. There are no token estimates, prices, cost calculations, discovery calls, or extra network requests.

| Adapter | Source | Normalization |
| --- | --- | --- |
| OpenAI Responses / xAI hosted Responses | `response.usage`, `response.model` | Input/output plus cached input and reasoning breakdown |
| OpenAI legacy Chat Completions | Final `usage`, top-level `model` | Explicit `stream_options.include_usage` only for this official OpenAI endpoint |
| Anthropic | `message_start.message.usage` + cumulative `message_delta.usage`; start model | Total input = uncached input + cache creation + cache read; output remains provider total |
| Google | `usageMetadata`, `modelVersion` | Output = candidate tokens + thought tokens when reported; thoughts also shown as reasoning subset |
| OpenRouter, Groq, xAI plain chat, vLLM, Perplexity | `usage`, top-level `model` (Groq `x_groq.usage` also accepted) | Prompt/completion plus optional cached/reasoning detail; trailing usage-only chunks are consumed |
| Ollama | Final `prompt_eval_count`, `eval_count`, reported `model` | Direct input/output counters |
| Bedrock | `metadata.usage`; optional `trace.promptRouter.invokedModelId` | Total input = uncached `inputTokens` + reported `cacheReadInputTokens` + `cacheWriteInputTokens`; direct output and cache-read breakdown; selected inference-profile ID is never invented as a reported model |

OpenRouter's current API automatically includes usage and explicitly deprecates opt-in parameters, so none are added there. Other compatible endpoints retain their current request protocol; usage remains unavailable if the server does not send it. Reasoning is part of output, and cached input is part of input where the provider supplies those breakdowns. Hosted tool charges and non-token billing are outside this feature.

Primary documentation actually retrieved:

- [Official OpenAI Responses usage and model schema](https://developers.openai.com/api/reference/cli/resources/responses/methods/retrieve)
- [Official OpenAI Chat Completions stream options](https://developers.openai.com/api/reference/cli/resources/chat/subresources/completions/methods/create)
- [Anthropic cumulative streaming usage](https://platform.claude.com/docs/en/build-with-claude/streaming) and [input/cache accounting](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)
- [Google UsageMetadata](https://ai.google.dev/api/generate-content#UsageMetadata)
- [Ollama chat response](https://docs.ollama.com/api/chat)
- [Bedrock ConverseStream](https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_ConverseStream.html), [TokenUsage](https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_TokenUsage.html), and [PromptRouterTrace](https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_PromptRouterTrace.html)
- [Bedrock prompt-caching accounting](https://docs.aws.amazon.com/bedrock/latest/userguide/prompt-caching.html) explicitly states that Converse `inputTokens` excludes cache reads and writes; these are added only when valid nonnegative safe integers are reported, and an overflowing total is omitted.
- [OpenRouter usage accounting](https://openrouter.ai/docs/cookbook/administration/usage-accounting)
- [xAI usage fields](https://docs.x.ai/developers/advanced-api-usage/prompt-caching/usage-and-pricing)
- [Groq API schema](https://console.groq.com/docs/api-reference)

Fixture tests cover native and hosted adapters, cumulative-versus-continuation accounting, cached/reasoning fields, actual model versions, final usage-only chunks, malformed/absent values, valid zeroes, Bedrock binary EventStream decoding, and bounded model identifiers. No paid calls or real credentials were used.
