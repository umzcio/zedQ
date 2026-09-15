# Model connections

Open **Settings → Connections → Add provider**. Choose Ollama, vLLM,
OpenAI, Anthropic, Google Gemini, xAI, Perplexity, OpenRouter or AWS Bedrock,
give the connection a name, and enter the server endpoint or provider API key.
Bedrock also asks for an AWS region. Multiple connections to the same
provider are supported.

**Test connection** retrieves the models available to that account/server; it
does not send a generation prompt. In Chat, open the model picker, choose the
connection and search its models. Each conversation remembers its selection.
Endpoint URLs appear in server settings, not in the model picker.

Connection rows offer Edit, Test and Delete through buttons and right-click.
Leave the key field empty while editing to preserve its saved key. Enter a new
key to replace it. A vLLM connection can remove its optional key. Changing a
server endpoint with saved credentials requires explicitly replacing or removing
the key. Stop active responses before editing or deleting their connection.
Deleting a connection keeps its conversations and messages; select another
connection and model to continue them.

## Credential storage

The desktop process stores keys as macOS Keychain generic-password items using
`apps/desktop/native/provider-keychain.swift`. The renderer never receives saved
keys; it receives only a `hasApiKey` flag. Keys are passed to the helper through
bounded stdin, not command arguments, environment variables, logs or JSON files.
The service namespace includes a hash of the workspace directory, keeping test
and regular workspaces separate.

Replacement uses a new Keychain reference and an atomic connection metadata
change. A cleanup journal records retired keys; cleanup retries next launch if
Keychain is locked or removal fails. A failed replacement preserves the prior
working connection. There is no plaintext fallback and no iCloud key sync.

`npm run build` compiles the helper; `npm run pack` includes it as a native app
resource. Development builds use an ad-hoc signature. Source changes to the
helper may cause macOS to request Keychain authorization again. Releases should
set `ZQ_KEYCHAIN_SIGN_IDENTITY` to the stable signing certificate and retain the
helper identifier `dev.zedq.desktop.provider-keychain`. See Apple's
[code-signing and Keychain guidance](https://developer.apple.com/library/archive/technotes/tn2206/_index.html).

## Architecture and limits

- `modules/chat`: connection settings, dialogs and model picker.
- `packages/providers`: provider request formats, model discovery and streaming.
- `apps/desktop/electron/chat-connections.cjs`: connection lifecycle, routing and credentials.
- `packages/module-api`: write-only connection inputs and public snapshots.

Chat 1.1.0 requires the `providers.v1` host capability. This native service change
ships with the desktop shell; older shells reject the new module. Subsequent
compatible Chat UI updates can continue to ship independently.

Requests use provider APIs. Code CLI subscriptions, Work execution and multi-Mac
sync are separate future work. No API keys are bundled. Cloud inference must be
verified with a real account key. Model discovery and image support depend on
provider metadata; vLLM without modality metadata lets its server decide whether
an image request is supported. See [provider protocols and validation](../packages/providers/README.md).

## Verification

Tests cover existing Chat persistence, attachments, project context, cancellation,
provider wire formats, incomplete streams, bounds, redirect rejection, credential
redaction, replacement failures, deletion and concurrent connection edits.

The packaged app was checked in the isolated UI workspace: the approved Ollama
server returned 13 models, the shared picker filtered them, and a synthetic
provider key was saved, kept hidden during editing, renamed and deleted. The
key's absence from chat JSON and its removal from Keychain were checked. No
normal-workspace data or real provider credentials were changed by these tests.

Final checks on September 9, 2026: 215 automated tests passed (one opt-in real Keychain test skipped in the default run); all eight Keychain tests passed separately with that real test enabled. TypeScript, build and macOS packaging passed. Live Ollama generation returned a greeting and persisted its selected model and reply. Cloud generation was not attempted without real account keys.

## Curated models

Connections → Add provider now tests the connection and opens an unselected model checklist. Saving adds the provider and its selected models atomically. Existing connections expose Manage models in their row and right-click menu. The checklist supports search, refresh, Select all/Select shown, and Clear all; refresh never automatically enables new models. Saved choices remain available for editing when discovery fails.

Chat's model picker searches enabled models across every saved connection, grouped by connection with a Favorites section. Each row has matching right-click and ellipsis actions for favorite, default, and hide. New chats use the enabled default first, an enabled previous chat choice second, then the first enabled model. Hiding prunes favorites/default without changing existing conversation models or messages; continuing an existing chat with a hidden model is supported.

Native ChatStore persists enabledModels/favoriteModels per connection and one defaultModel choice. Legacy connections migrate only model IDs used by their saved chats, bounded to 1,000 distinct IDs. Model discovery is performed on setup/test or Manage models, never just to render the Chat picker. Native validation enforces unique bounded IDs and favorite/default membership. Credentials still use Keychain and are omitted from public snapshots.

Provider marks are bundled into the Chat module; sources and asset treatments are documented in `modules/chat/provider-branding.md`. Exact IDs remain visible beneath friendly labels where applicable and are used unchanged for requests.

Ollama and vLLM model rows support Rename model label through matching right-click and ellipsis menus in Chat and Manage models. Labels are scoped to connection/model ID, used in the picker, composer and checklist, and included in search alongside exact IDs. Reset label removes the alias. Native saves patch one label atomically (up to 80 characters, one line, 1,000 aliases per connection), preserving IDs, request routing, existing chats, favorites and defaults. Labels survive hiding and connection edits. Old stores default to an empty label map.

Model-label verification: 230 tests passed, zero failed, one opt-in Keychain test skipped; packaged build passed. Isolated UI verified rename through Chat context menu, label and ID search/display, checklist ellipsis → nested dialog → reset, unchanged selected checkbox, and focus return. Native tests verify restart persistence and original model ID sent to the adapter. Regular workspace reopened; test label reset.

## Perplexity, OpenRouter and Groq

Chat 1.4.0 adds these providers through the existing Add provider → Choose models
flow, with official bundled logos. They use Keychain credentials, curated model
choices, favorites/defaults and matching model context menus. No models are
enabled automatically. Perplexity exposes Sonar models and retains source links
in saved answers. OpenRouter and Groq discover supported chat models remotely.

This addition requires the `providers.v2` shell capability because native routing
and persisted provider types changed. Older shells reject the new Chat module;
update the desktop shell together with this module. Existing connections and
model preferences remain compatible.

Additional-provider verification: 255 automated tests passed, zero failed, one
opt-in Keychain test skipped. TypeScript and macOS packaging passed. Isolated
app checks covered all nine tiles, new provider names/key fields, light/dark
logos, Escape/focus return, and a real HTTP 401 from Perplexity's read-only
authentication endpoint using a deliberately invalid unsaved key. Switching
providers cleared the key and error; no test connections were saved. No paid
requests or valid cloud account keys were used, so live generation for these
three providers remains to be checked after keys are added.

## AWS Bedrock

Bedrock replaces Groq in the Add provider grid. Existing saved Groq connections
remain readable and usable for compatibility. Bedrock uses an API key stored in
Keychain plus an explicitly selected supported US AWS region; AWS profile/SSO is not part of
this setup. Changing a saved region requires explicitly supplying its key.

The native AWS SDK adapter uses ConverseStream, so supported Claude models use
their native Bedrock API. Model discovery uses ListFoundationModels and
ListInferenceProfiles, filtered for supported streaming chat models, with exact
discovered inference-profile IDs preserved. Discovery requires those IAM
permissions; generation requires InvokeModelWithResponseStream and model access.
Model discovery does not itself prove invocation entitlement. Setup never sends
a paid generation prompt or changes AWS resources.

Chat 1.5.0 requires the `bedrock.v1` shell capability. The native AWS SDK
dependencies ship with the updated desktop shell. Shared shadcn region controls,
curated model selection and existing model actions remain in place.

Bedrock verification: 272 automated tests passed, zero failed, one opt-in
Keychain test skipped; native SDK tests use deterministic binary response
fixtures. Packaged app reached AWS with an unsaved invalid test key and showed
the expected HTTP 403 with region/permission guidance. No AWS resources or
paid prompts were created. Live successful generation awaits a valid account
key. The region control uses the shared SelectField, matching the dialog input
font size/height, and offers N. Virginia (us-east-1) and Oregon (us-west-2) only.

## Provider-hosted tools (Chat 1.6.0)

The composer offers a compact Tools menu for models with verified implemented capabilities. Selection is opt-in and remembered with the chat. Provider usage charges apply. Text continues to stream; final citation markup is reconciled once the response finishes. Activity expands to show queries/code/output, sources open in the browser on click, and downloaded generated files have Save actions on click and right-click.

| Connection | Implemented tools | Scope |
| --- | --- | --- |
| OpenAI | Web search, Code Interpreter | Verified streaming Responses models; legacy Chat Completions unchanged |
| Anthropic | Web search, code execution | Verified model families; native Messages, bounded pause continuation |
| Gemini | Code execution | Verified generateContent models; output images/files saved locally |
| xAI | Web search, X search | Supported Grok 4 families via Responses |
| OpenRouter | Web search | Native server search tool, two-search limit, selected model retained |
| Perplexity | Existing Sonar web search | Automatic sources/activity; separate Agent API tools are not yet integrated |
| Ollama / vLLM / Bedrock | No provider-hosted tools | Local document functions are separate; see below |

Every user turn starts a fresh hosted execution context. Generated files are downloaded immediately, stored on this Mac, and saved to a path the user chooses. Each file is limited to 4 MB, with 8 MB/10 files per response. Existing attachments remain prompt reference material; this release does not upload them as native sandbox datasets or maintain vendor containers across turns. Model switching carries display text, not opaque provider tool/session state.

Google Search is withheld until its required Search Suggestions display and grounded-history retention/reuse flow are implemented. xAI hosted code, Perplexity Agent tools, OpenRouter shell, file/vector-store search, image generation, remote MCP/connectors, and general zQ workspace functions require additional specific integrations. The menu does not expose unimplemented tools. Bedrock's Converse tool requests must not be confused with automatically executing local code or its separate hosted Responses tools.

The native catalogue is conservative: unknown model/tool combinations are not tested using billable prompts. See the full researched protocols, source URLs, limitations, and future function execution requirements:

- [OpenAI, Anthropic, Gemini](research/provider-tools-core.md)
- [xAI, Perplexity, OpenRouter](research/provider-tools-routing.md)
- [Ollama, vLLM, Bedrock, legacy Groq](research/provider-tools-local-bedrock.md)

Chat 1.6.0 requires `provider-tools.v1` and the updated desktop shell for activity/artifact persistence, tool selection, source opening, and native generated-file saving. Existing chat stores migrate without dropping connections or history. Bedrock's product glyph now uses a transparent monochrome mask, without the green architecture-icon background.


Provider-tools verification: 310 automated tests passed, zero failed, one opt-in Keychain test skipped. TypeScript/build/macOS package passed. The isolated app verified tool selection, activity expansion, generated-file right-click menu and native Save, byte-for-byte fixture CSV export, and Bedrock's transparent logo. Regular workspace restored. Provider protocols were exercised with deterministic wire fixtures, not paid cloud inference; live account-level tool access remains unverified.


## Local document tools (Chat 1.7)

Chat now supplies `create_document`, `read_document`, and `revise_document` to supported OpenAI, Anthropic, Gemini, xAI, OpenRouter, and Bedrock models, alongside the existing Ollama integration. Existing hidden Groq connections use the same executor for documented function-capable models. vLLM requires explicit `tools`/`tool_calling` model capability metadata; a standard vLLM catalog without that metadata stays disabled because zQ cannot verify its parser/template configuration. Perplexity's current Sonar connection remains search-only. Gemini 2.5 can use document functions with hosted code execution off; Gemini 3 supports combining them.

These functions use the existing local document formatter and versioned Artifacts store. No extra composer switch is required. Generated cards and preview panes keep their existing menus, downloads, version selection, and Notes/Tasks attachment behavior. Only documents already in the visible chat or explicitly selected for revision enter the model's context. Document contents are sent to the selected provider when the model reads them; this is the same selected-provider boundary as chat attachments.

Provider-specific wire formats, capabilities, official API references, and validation are recorded in [document tool integration](research/provider-document-tools.md). Native adapter changes require this desktop shell update; they are not an independent Chat module update.

Keychain authorization requests are serialized within the desktop credential store so concurrent connector restores do not stack native password dialogs. Each launched request allows two minutes for interactive approval; waiting in the queue does not consume that timeout. Cancellation releases the queue. Development ad-hoc signing still cannot promise durable trust across changed helper binaries.

The helper build preserves exact signed bytes in `.local-data/native-keychain`, shared by the main checkout and its worktrees. Unchanged Swift source, target architecture, and signing identity reuse that executable even after compiler or build-script changes. Each reuse verifies its SHA-256 receipt and native signature; a corrupt cache fails without replacing the installed helper. The cache contains no credentials. `ZQ_KEYCHAIN_FORCE_REBUILD=1` explicitly rebuilds it and can trigger fresh Keychain authorization with ad-hoc signing. Actual native source changes still require a stable signing certificate for durable release trust.
