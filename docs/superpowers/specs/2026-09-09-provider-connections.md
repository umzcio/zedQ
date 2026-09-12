# Provider connections

Continue the approved provider setup after the module foundation. Support named Ollama, vLLM, OpenAI, Anthropic, Google Gemini and xAI connections through the existing Chat model picker. Keep model selection per conversation. Preserve sidebar appearance, project context, attachments, streaming, cancellation and save-on-close.

Provider HTTP adapters live in `packages/providers`. The native desktop owns credentials and connection persistence; Chat owns connection settings. Cloud endpoints are fixed official HTTPS origins. Local server endpoints remain editable. Test connection lists models without generating a paid reply. Only the user's approved Ollama server may be used for a live inference test.

Store API keys as actual macOS Keychain generic password items through a small Security.framework helper. Exchange secrets through stdin, never argv or environment. Connection JSON contains only credential references; snapshots expose only whether a key exists. Namespace Keychain items by workspace. Write replacement keys under new references, atomically switch connection metadata, and retain a cleanup journal for retired keys. Never silently fall back to plaintext. API key fields are write-only and clear on save/cancel.

Use shared shadcn/Radix selects, dialogs and context menus. Connection rows offer Edit, Test and Delete, with the same actions available using keyboard-accessible buttons. Deleting a connection preserves chats and clears their model connection. Prevent changing credentials/provider configuration while affected responses run, and prevent a send racing a pending edit.

The Chat manifest requires `providers.v1`, which older shells reject because it exceeds their bundled capabilities. This native service addition ships with a desktop build. Work and Code execution, subscriptions, provider billing and multi-Mac sync are outside this increment.

Validation: provider wire-format fixtures and failure/abort tests; connection migrations, credential redaction, replacement/deletion failure recovery and race tests; complete existing suite and desktop build; isolated packaged-app UI test; restore the user's normal workspace. Cloud inference remains unverified until user keys are entered.
