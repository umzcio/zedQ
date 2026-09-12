# Chat Skills Implementation Plan

> **For agentic workers:** Use the existing parallel-agents workflow for independent native-library and feature-UI work; root owns integration and validation. Track each deliverable below.

**Goal:** Implement the approved Skills library with reusable instructions/references, chat/project selection, and consistent Edit/Rename/Duplicate/Export/Delete actions.

**Architecture:** Skills are a Chat-owned feature in `modules/chat`, with durable records and prompt assembly in the native Chat service. Settings contributes a distinct Skills surface through `@zq/module-api`. Selection and per-message snapshots use the existing Chat store, so retries, versions and branches preserve the skill content used when a message was sent.

**Tech Stack:** React/TypeScript, shared shadcn/Radix, native CommonJS Chat service and validated atomic JSON storage. No new dependencies.

**Spec:** Approved conversation design: Settings → Skills; reusable instructions and reference files; enable for chats/projects; right-click Edit/Rename/Duplicate/Export/Delete. Existing Appearance and sidebar geometry are preserved.

## Global constraints

- Feature UI/state/styles stay in modules/chat; shell owns trusted file dialogs, IPC and persistence.
- Use existing text/PDF attachment extraction. Each skill: name 256 UTF-8 bytes, description 1000, instructions 16000; at most ten text/PDF files and 100 KB instructions plus extracted text. Library maximum 100 skills. A message may enable at most ten skills and shares the existing 100 KB total context bound.
- Chat selection null/omitted inherits project; explicit [] disables skills. New draft selection persists and is carried into its conversation. Deleting a library skill removes future selections but preserves sent snapshots.
- Project skill changes affect future messages. Each sent user message records exact skill instructions and references; retries use that snapshot.
- Only explicit selection activates skills. Reference text is quoted data; it cannot grant host tools or arbitrary filesystem access.
- Export is a portable .zqskill.json file containing instructions and extracted references. It uses the native Save dialog. Third-party package import, scripts and connectors are separate scope.
- All mutation tests use isolated temporary stores; no test data in the regular workspace.

## Interfaces

`ChatSkill = {id,name,description,instructions,files:Attachment[],createdAt,updatedAt}`. Native file records include extracted text; public file metadata uses existing Attachment shape.

`ChatSnapshot.skills?:ChatSkill[]`; `ChatProject.skillIds?:string[]`; `Conversation.skillIds?:string[]|null`; `ChatDraft.skillIds?:string[]|null`; sent `ChatMessage.skillContext?:ChatSkill[]` (public metadata omits file text).

`ChatBridge.saveSkill({id?,name?,description?,instructions?}) -> ChatSkill`; `duplicateSkill(id) -> ChatSkill`; `deleteSkill(id) -> null`; `addSkillFiles({id,attachmentIds}) -> null`; `removeSkillFile({id,attachmentId}) -> null`; `exportSkill(id) -> boolean`.

`saveDraft`/`send` accept optional `skillIds:string[]|null`. `updateProject` accepts `skillIds:string[]`. `inspectContext` accepts optional skillIds. Existing API methods otherwise retain signatures.

## Tasks

- [x] Native library: create `apps/desktop/electron/skill-schema.cjs` and `chat-skills.cjs`; tests `skills.test.cjs`. Validate bounded skill records and selections, CRUD/files, duplicate with fresh identity, export extracted source. Mutation through host.change; no direct store writes. Fail-first tests for persistence, invalid inputs, file bounds, deletion cleanup and atomic failure.
- [x] Root persistence/prompt integration: update chat-store, chat-service, chat-lifecycle, preload/main and module-api. Optional fields preserve old stores. Resolve selection on send; clone exact skill data into user message; include latest-message instructions and bound references. Add isolated tests for inheritance/overrides, retry after edit/delete, branch/restart, context inspection parity and oversized rejection before history mutation.
- [x] Feature UI: `SkillsSettings.tsx`, `SkillPicker.tsx`, `skills.css` in modules/chat. Shared dialogs/menus; list/search, create/edit/reference preview/removal, rename/duplicate/export/delete, empty states and keyboard menu parity. Root mounts Settings surface and wires composer/project selection. Protect pending edits and async ownership on navigation/close.
- [x] Shell compatibility: add settings-skills surface and settings section; advertise `skills.v1`, bump Chat module version and require updated shell. Keep existing module fallback/isolation checks.
- [x] Integration: useChat draft selection, composer picker/context inspector and project defaults. Selected skills visible through compact control; no empty-context row. Browser fixture tests actual settings CRUD/actions and picker inheritance using isolated fixtures.
- [x] Verification: focused tests, full npm test, TypeScript, browser checks, scoped review, clean quit before npm run pack, package content checks, reopen regular workspace, document completed behavior/limits.

No git metadata exists in this checkout; do not fabricate commits or worktrees. Native tests are isolated in temporary directories.

## Completed validation

- Full suite: 525 tests, 524 pass, one existing skip, zero failures.
- TypeScript and four isolated browser suites pass: library/picker, actual chat controller/composer, shell Settings/modal navigation, artifact revision regression.
- Native and integration reviews resolved the explicit-null project fallback mismatch; no remaining Skills-specific findings.
- Chat 1.9.0 single-module build verifies against the target shell API and trusted signature.
- Desktop packaged after clean quit; packaged native files match source and bundled Chat advertises skills.v1. Regular app reopened after package checks.
