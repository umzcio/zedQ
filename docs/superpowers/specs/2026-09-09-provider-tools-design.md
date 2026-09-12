# Provider-hosted tools

User authorization: proceed with provider tool execution and thoroughly research each API. A scope question offered workspace reference search as an addition; without that expansion, this release implements provider-hosted tools.

Keep tools opt-in in a compact shared Radix menu beside the model picker. Only offer implemented capabilities for the selected provider/model. Sonar's existing search remains intrinsic. Preserve the sidebar, Appearance settings, model curation, and ordinary chat paths.

The native provider layer owns requests, credentials, hosted execution, bounded continuation, and artifact downloads. Chat stores a small activity history and downloaded output files; public snapshots omit file bytes. Tool calls never authorize local commands, workspace mutation, or external communication. Function-call protocols for future workspace tools are documented separately from hosted tools.

Each selected tool is validated natively before sending. Activity has a stable ID, tool kind, running/complete/error status, and bounded detail. Stop, failure, shutdown, and recovery settle running activity. Tool output and artifacts share existing storage capacity checks. No automatic retries of generation requests.

Generated files are downloaded from pinned authenticated provider routes, persisted locally, and saved to a user-selected path. Links open only on an explicit click through a native HTTP(S)-only opener. Raw provider HTML, JavaScript, and remote image loads remain disabled.

Each user turn starts a fresh hosted execution context. This release does not promise persistent vendor containers across turns. Same-turn continuations must preserve provider-native blocks and signatures. Provider features with unmet configuration, artifact, or display requirements are documented and omitted rather than presented as functional.

Validation uses protocol fixtures, isolated durable-store tests, full existing tests, TypeScript, packaged build, and isolated UI inspection. No paid cloud prompts or real key access are needed. Native API/schema changes require a bundled shell update and a new Chat capability.
