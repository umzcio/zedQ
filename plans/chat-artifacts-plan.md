# Chat artifacts and sources implementation plan

Authorized design: user approved clickable citations/source lists, real PDF/DOCX/XLSX/PPTX files, a Chat Artifacts sidebar entry, save/attach to Notes/Tasks, immutable versions with explicit Update to latest, and context-menu parity. Audio-provider work and Skills/Connectors/MCPs/Plugins remain parked.

Goal: persistent artifacts independent of chat history, useful across modules, with honest provider web-source display.
Architecture: native ArtifactService owns a separate atomic metadata store and bounded version bytes; Chat owns the library and creator UI. Public artifact bridge and commands connect modules. Provider adapters emit normalized source metadata alongside existing inline citations.
Tech stack: existing Electron/React/TypeScript/shadcn; native JS document libraries, no arbitrary code execution.

Global constraints: preserve Appearance/sidebar geometry, except adding the approved Artifacts navigation row. Keep normal workspace free of fixtures. No real microphone/paid API tests. No git metadata exists; work in current authorized tree, no commits/worktree removal. Delete is recoverable/hides library entry and retains bytes referenced by Notes/Tasks.

## 1. Sources
- [x] Normalize bounded HTTP(S) source URLs/titles from provider-native search annotations through onSources(sources), preserving inline citations.
- [x] Persist sources on each response/version, render expandable titles/domains and clickable links, including honest missing-source state after completed search.
- [x] Fixture tests for provider formats, hostile URLs, dedupe and trailing chunks; typecheck.
Files: packages/providers/*, modules/chat/ChatSources.tsx, native chat schema/callback integration.

## 2. Real document creation
- [x] Add renderArtifact({format:'pdf'|'docx'|'xlsx'|'pptx',title,content}) -> {name,mime,data(base64),previewText}; bounded source <=100KB, bounded bytes <=10MB. No execution, external fetches, macros or formulas from model text.
- [x] Preserve headings/paragraphs/lists/tables sensibly; XLSX uses Markdown tables or text rows; PPTX splits titled sections into slides with bounded content.
- [x] Verify actual file structures/content with fixture tests and render available previews.
Files: apps/desktop/electron/artifact-renderer.cjs, tests/artifact-renderer.test.cjs, dependency manifests.

## 3. Native library/version storage and bridge
- [x] Separate artifact metadata+version storage, native immutable version IDs/sequence, source chat/message/version provenance, snapshots without file bytes; atomic writes, bounded reads, corrupt-store preservation, no symlink following.
- [x] APIs list/create/importGenerated/rename/delete/restore/version/preview/save; create optionally appends version to existing same-format artifact with expectedLatestVersionId conflict guard. Server-generated files imported idempotently and indexed across conversation versions; do not group unrelated same-name files automatically.
- [x] Update native IPC/public capability plumbing. Tests: restart, same-name independence, revisions, stale update conflict, source-file idempotency, deleted-chat independence, failure rollback.

## 4. Library and creator UI
- [x] Artifacts sidebar row, search/filter compact library and accessible/context menus. Open/rename/download/attach/version/delete; deleted scope/restore.
- [x] Create artifact from any response as a real format; edit content to create a new version; import existing provider files; selected version preview/download and source chat navigation.
- [x] Shared shadcn selectors/dialogs, Escape and focus return. Document previews inert, explicitly text/content previews for Office rather than pretending exact rendering.

## 5. Notes/Tasks attachment integration
- [x] Explicit public commands to attach {artifactId,versionId,name} to new/existing Notes/Tasks; immutable version references persisted with workspace state.
- [x] Shared artifact attachment UI with open/download/detach/Update to latest; retain specific attached version on later artifact edits/deletion. Handle unavailable artifacts gracefully. Module boundaries maintained.

## 6. Verification/release
- [x] Focused tests then full suite/typecheck. Review sources/doc renderer and integrated store/UI for missing behavior.
- [x] Package with app cleanly quit, isolated UI mutation check across formats/versions/Notes/Tasks, restore original isolated data and reopen regular app.
- [x] Durable release report with actual results and any limitations.

Completed 2026-09-09. Verification and limits: [release report](../docs/chat-artifacts.md).
