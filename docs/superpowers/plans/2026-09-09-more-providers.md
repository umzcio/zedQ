# Additional Chat providers

Add Perplexity Sonar, OpenRouter and Groq to the existing provider setup, curated model selection, favorites/defaults and secure native credential storage. Preserve the current Settings design and use official local logo assets.

- Native fixed endpoints and provider schema, with a new shell capability for compatibility.
- OpenRouter authenticated key check before its public catalog; Groq authenticated catalog filtered to chat.
- Perplexity's published Sonar catalog after a read-only authenticated check; stream answers and preserve numbered web sources. Do not confuse Agent API model discovery with Sonar models.
- Deterministic protocol, credential and persistence tests; no paid inference tests or normal-workspace test data.
- Package the desktop shell and verify the provider setup UI, then restore the regular workspace.

Completed: native adapters/schema/capability, official assets and existing UI
registration, deterministic tests and reviewed compatibility fixes, packaged
build and isolated light/dark/auth-failure checks. OpenRouter batch-only models
are excluded; uncached OpenRouter/Groq output limits use provider defaults.
Regular workspace reopened after verification.
