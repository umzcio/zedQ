# Chat Module Implementation Plan

> Execute inline using superpowers:executing-plans, checking each task before proceeding.

**Goal:** Working desktop Chat with Ollama connections, model selection, streaming/stop, saved history, and explicit note context.
**Architecture:** Native ChatService owns a separate atomic chat.json store and bounded Ollama provider requests. A typed IPC surface exposes snapshots and events to a Chat hook, contextual sidebar, conversation view, and Settings connection editor. Existing Notes/Tasks data stays in workspace.json. No renderer network access or executable model output.
**Tech stack:** Existing Electron 44.2.0, React 19.2.8, TypeScript 7.0.2, Radix/shadcn; built-in Node fetch/AbortController.
**Spec:** User-approved next-module proposal in conversation; docs/zq-product-spec-v0.1.md.

## Constraints
- Preserve compact two-nav shell and all appearance/accent choices. Use shared shadcn controls.
- Ollama endpoint: http://127.0.0.1:11434/. No local service startup or model downloads.
- First provider is Ollama. Cloud provider adapters are subsequent work.
- Only explicitly selected note snapshots accompany a submitted message; local files are never implicitly attached.
- Note content is reference data, not tool instructions. Chat has no tools or computer/file execution.
- Old workspace data remains readable. Corrupt chat storage must not silently reset.
- No Git repository exists, so no commit/worktree steps apply.

## Task 1: Native provider and data integrity
Files: electron/chat-provider.cjs, chat-store.cjs, chat-service.cjs; tests/chat.test.cjs.
- [x] Write failing checks for chunked UTF-8/NDJSON, in-stream errors/truncated completion, abort, redirects and request bounds; chat persistence, isolated context snapshots, duplicate sends, stopping, interruption recovery, corrupt data.
- [x] Implement provider `listModels(baseUrl)` and `streamChat({baseUrl,model,messages,signal,onDelta})`. Fixed /api/tags and /api/chat paths; only http(s), no embedded credentials, redirects or fallback endpoints. Enforce total, idle, line and response limits.
- [x] Implement ChatStore load/save with private atomic versioned JSON, bounded schema, corruption preservation.
- [x] Implement ChatService snapshot, saveConnection, createConversation, configureConversation, send, stop, shutdown. Persist submitted user/assistant pair before network I/O; checkpoint partial replies; mark interrupted runs on startup. Validate selected note IDs against native workspace state.
- [x] Run tests; fix failures before renderer integration.

## Task 2: IPC and UI
Files: electron/main.cjs/preload.cjs; src/chat-types.ts, useChat.ts, ChatView.tsx, ConnectionsSettings.tsx; App/Navigation/module registry.
- [x] Expose narrow trusted chat IPC and revisioned snapshot subscription. Stop/save streams before close acknowledgement; stop when renderer exits.
- [x] Enable Chat module with compact searchable conversation rows and New chat. Preserve UI draft per conversation while navigating during the session.
- [x] Add Connections in Settings: name, Ollama endpoint, Test connection/model list, Save/edit, multiple endpoints. Offer the supplied endpoint in the initial form, without silently making requests.
- [x] Chat toolbar selects saved connection and model, refreshes model list, persists choices; composer attaches selected notes, streams replies, shows errors/stopped/interrupted status and Stop action. Native service determines history/context sent.
- [x] Keep model text inert. Show connection target/context clearly. Switching views does not stop a run.
- [x] Type-check/build and inspect native UI with isolated data.

## Task 3: Verification and delivery
- [x] Run complete tests/build. Probe the supplied endpoint; use an installed small/loaded model for one short live Chat check if available, without downloads.
- [x] Verify packaged app connection setup, model selection, sent message/result, Stop and saved history, plus Notes/Tasks navigation. Check close/restart persistence and safe errors.
- [x] Package updated app, document capabilities/limits, reopen normal workspace.
