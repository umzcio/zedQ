# Provider Connections Implementation Plan

**Goal:** Connect the existing Chat module to six provider types with native Keychain credentials.

**Architecture:** Provider adapters consume the existing native prompt/delta contract. A connection manager owns metadata, credential lifecycle and concurrency; ChatService routes model listing and generation. The module UI uses only the public bridge.

**Tech stack:** Electron 44, Node, React 19, TypeScript 7, shared shadcn/Radix UI, Swift Security.framework helper.

**Spec:** `docs/superpowers/specs/2026-09-09-provider-connections.md`

- [x] Add adapters in `packages/providers` and fixture tests in `apps/desktop/tests/cloud-providers.test.cjs`. Export `createProvider(provider, {apiKey})` and `normalizeConnection({provider,baseUrl})`; preserve Ollama exports. Test wire formats, terminal events, error redaction, timeouts, cancellation and image input.
- [x] Add `provider-keychain.cjs`, `native/provider-keychain.swift` and `scripts/build-keychain.mjs`. Expose async `get(id)`, `set(id,key)`, `delete(id)` using workspace-scoped Keychain accounts. Test subprocess protocol and failures with no real credentials.
- [x] Add connection lifecycle tests before native edits. Extend store schema with provider union, credential references and cleanup journal; extend public input with write-only `apiKey`, `removeApiKey`, snapshots with `hasApiKey` and `updatedAt`. Keep legacy Ollama records valid.
- [x] Route ChatService through connection-specific adapters. Serialize key changes, reject send/edit/delete races, remove connection without deleting chats. Add bridge `deleteConnection`, expand `testConnection` to accept a connection draft while retaining string input compatibility.
- [x] Build compact connection settings with shared selects/dialogs/context menus, masked key input and Edit/Test/Delete actions. Clear secrets after save/cancel, retain current model picker with refresh on connection edits. Add `providers.v1` compatibility requirement.
- [x] Run `npm test`, `npm run build`, `npm run pack`. Verify packaged helper and isolated UI, then reopen normal workspace. Update provider documentation with supported scope and actual test results.

Execution continues in this session under the user's authorization. Independent adapters and Keychain helper are delegated using the dispatching-parallel-agents skill; root owns service, UI and integration. No Git repository exists in this workspace.

Validation completed: 215 automated tests passed, 0 failed, 1 opt-in real Keychain test skipped in the default suite; the real Keychain test passed separately (all 8 credential tests). Final TypeScript/build/package passed. Packaged UI verified all six provider choices, masked write-only credentials, key-preserving rename, right-click Edit/Test/Delete, deletion cleanup and shared model search. Live approved Ollama discovery returned 13 models and streamed “Hi there! 👋”; response/model selection persisted. Synthetic UI key was absent from chat JSON and confirmed deleted from Keychain. Package inspection verified Chat 1.1.0/providers.v1, native provider adapter and exclusion of private signing keys. Existing Vite shared-icon chunk-size warning remains. Normal workspace reopened after testing.
