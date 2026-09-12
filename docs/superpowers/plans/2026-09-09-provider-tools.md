# Provider Tools Implementation Plan

> **For agentic workers:** Use the executing-plans workflow for the native/UI integration; independent protocol research and adapter work uses dispatching-parallel-agents.

**Goal:** Execute supported provider-hosted tools from Chat with explicit selection, activity, sources, and durable generated files.

**Architecture:** Optional tool selection extends the existing native send API. Dedicated hosted adapters retain existing plain-chat paths. Native ChatService validates capabilities and stores bounded output while the Chat module renders shared UI primitives.

**Tech Stack:** Electron, CommonJS native services, React, TypeScript, shared Radix components, Node test runner.

**Spec:** `docs/superpowers/specs/2026-09-09-provider-tools-design.md`

## Global constraints

- No sidebar or Appearance redesign; no paid inference tests; no reading real provider keys.
- Credentials and network execution remain native; preserve redirect denial and existing response deadlines/limits.
- Only explicit user actions open external URLs or save generated files.
- Fixture work uses isolated temporary stores; packaged UI work uses the isolated workspace.

## Tasks

- [x] Research current official tools, stream shapes, continuation, artifacts, resource requirements, and limits for all nine offered providers plus legacy Groq. Write evidence to `docs/research/provider-tools-*.md`.
- [x] Add core hosted adapters in `packages/providers/hosted-core.cjs` with protocol tests for OpenAI, Anthropic, and supported Gemini execution. Test tool opt-in payloads, fragmented streams, citations, continuation, artifacts, errors, and cancellation before integrating.
- [x] Add routing hosted adapters in `packages/providers/hosted-routing.cjs` with tests for xAI Responses and OpenRouter hosted search. Keep Perplexity Sonar unchanged; document the separate Agent API.
- [x] Add native lifecycle tests in `apps/desktop/tests/chat-tools.test.cjs`: selected tools reach the provider; unsupported tools fail before history changes; activity survives restart; stop ignores late callbacks; malformed output cannot poison storage; file bytes are absent from public snapshots.
- [x] Implement lifecycle/storage helpers in `apps/desktop/electron/chat-tools.cjs` and extend `chat-service.cjs`, `chat-store.cjs`, shared chat types, and IPC. Settle pending activity on all terminal paths; apply aggregate size bounds.
- [x] Add `modules/chat/ChatTools.tsx` for tool selection/activity and generated-file actions. Preserve per-conversation draft choices and clear unavailable choices on model changes. Use shared menus/collapsibles and include right-click Save for generated files.
- [x] Add native safe source opening, functional Markdown links, provider capability routing, module version/capability, and documentation of implemented versus deferred tools.
- [x] Run focused tests, full tests, TypeScript/build, review, package, and isolated UI checks. Restore the regular app.

No git metadata exists in this workspace; commits and worktrees are unavailable.

## Verification outcome

- 311 automated tests: 310 passed, zero failed, one opt-in Keychain test skipped.
- TypeScript and macOS package build passed. Unsigned development package behavior remains unchanged.
- Isolated packaged UI verified: tool choices/toggle count, expandable activity, generated-file context menu, native Save dialog and byte-for-byte CSV export, and Bedrock's transparent glyph. The CUA accessibility snapshot retained a closed context menu over the first native sheet; canceling and using the direct Save button verified the full export. No paid cloud prompt or real credential was used.
- Restored the prior isolated fixture stores and reopened the regular workspace on Connections; all existing provider rows remained present.
- Provider protocol fixtures cover hosted execution and errors. Live successful execution against the user's cloud accounts was not tested.
