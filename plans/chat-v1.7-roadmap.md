# Chat v1.7 roadmap

Status: authorized implementation (2026-09-09). The user gave marching orders for the complete backlog below, including both dictation modes and chat/project pinning. Paid live API tests remain excluded without an explicit budget. Progress and verification are recorded in `plans/chat-v1.7-progress.md`.

## Release intent

Make Chat comfortable for everyday use while preserving the approved compact appearance and sidebar layout. Build tested increments with durable state and useful right-click actions. Voice-to-voice conversations belong to a later release.

## Conversation controls

- Copy messages as plain text or Markdown.
- Edit and resend a user message without destroying its original history.
- Retry failed responses without retyping.
- Regenerate responses with the current or another selected model.
- Keep and navigate response versions.
- Branch from a message while preserving the source conversation.
- Show the actual provider/model used for each response in details.
- Offer hover, right-click, and keyboard-accessible action parity.

Done when edits, retries, versions, and branches survive restart, preserve references, and cannot mutate an active response inconsistently.

## Reading, code, and generated files

- Syntax highlighting, language labels, and copy-code confirmation.
- Code wrapping controls and save-code-as-file.
- Handle wide tables and long links gracefully.
- Preview generated images, text, PDFs, and CSVs.
- Attach generated files to follow-up messages.
- Add generated files to projects.
- Consistent Preview, Save, Attach, and Add to project actions.
- Recoverable generated-file download errors.

Done when previews remain inert, supported files can be reused after restart, and failed downloads never appear as working artifacts. An interactive artifact editor is a stretch item requiring separate design.

## Search and organization

- Search message content as well as titles.
- Matching snippets, highlighting, and jump-to-message.
- Find within the current conversation.
- Pin/unpin conversations and projects, available through right-click and keyboard-accessible action menus.
- Keep pinned chats first within their existing list (general chats or their project), and pinned projects first in the Projects list; preserve the approved sidebar layout.
- Persist pin state across restarts. Unpinning returns an item to the normal ordering for its list.
- Archive/restore conversations.
- Markdown conversation export.
- Recoverable deletion and a Trash view.
- Context menus and accessible menu/button equivalents.

Done when results navigate to the correct message/version, archived/deleted scopes are explicit, and restore/export preserve content and references. Chat/project pinning must survive restart, retain project membership, and offer consistent Pin/Unpin actions wherever those items appear.

## Project context

- Project defaults for model and selected tools.
- Inspect the instructions and references that will be included.
- Search project files.
- File extraction status and actionable import errors.
- Context-limit guidance before sending.
- Explain how moving a conversation affects future context.
- Reuse generated files within projects.

Done when defaults apply predictably, explicit overrides win, and the displayed context matches what the native provider request receives. Large-document retrieval is a later item in the queue and needs its own bounded design.

## Connections to Notes and Tasks

- Save a response or selected text to Notes.
- Append to an existing note.
- Create a task from a response or selected text.
- Link created notes/tasks back to the source conversation.
- Expose these through compact message/selection menus.

Done when explicit user actions use public host commands/capabilities and preserve module boundaries. Model-driven workspace mutation is a separate scope requiring a review/approval design.

## Speech-to-text — added by the user

- Add a functional microphone button beside the composer controls.
- Add a dedicated Settings → Voice page with an explicit on-device/provider transcription choice.
- For on-device mode, show the selected local engine and its availability/setup status.
- For provider mode, select a compatible saved provider connection and transcription model; keep credentials in the existing native credential store.
- Include microphone selection, transcription language where supported, and a deliberate record/transcribe test with editable output.
- Use shared shadcn/Radix controls and preserve the existing Appearance page.
- Persist Voice settings and use them for new recordings in Chat. Capture the chosen configuration when recording starts so later settings changes cannot reroute in-progress audio.
- Clicking the microphone starts recording after the required device permission.
- Clear recording state, elapsed time, Stop, and Cancel.
- Stop requests transcription; show a transcribing state.
- Insert the transcript into an editable composer draft without sending it automatically.
- Preserve any text already in the draft; never silently overwrite it.
- Keep the recording/transcript associated with the originating chat if navigation occurs.
- Handle permission denial, unavailable input devices, empty audio, and transcription failure.
- Prevent concurrent recordings and duplicate transcription submissions.
- Discard canceled recordings and clean up temporary audio according to the agreed retention policy.
- Keyboard-accessible controls and reduced-motion support.
- Exercise recording/transcription states with fixtures without requiring unattended access to the user's microphone.

Done when a user can record, review/edit the transcription, and send it through ordinary Chat; cancellation never submits audio or a message. No spoken assistant playback, continuous listening, or voice-to-voice conversation in v1.7.

User decision: support both on-device and provider transcription, selected in Settings → Voice. No automatic fallback between them: a local transcription failure must not upload audio to a provider. Research must establish the specific engines/providers, supported macOS versions, languages, packaging, costs, and permission requirements. Unsupported provider connections must not appear as usable transcription choices. Voice-to-voice remains outside this release.

## Recovery, visibility, and polish

- Restore unsent drafts and the active conversation/reading position after restart.
- Preserve drafts across navigation and model changes.
- Jump to latest while retaining the user's reading position during streaming.
- Response timing and provider-reported usage.
- Clearly labeled cost estimates only where reliable pricing is available.
- Actionable authentication, rate-limit, unsupported-tool, and context-size errors.
- Long-thread performance checks.
- Keyboard navigation, Escape, focus restoration, and reduced motion.
- Migration checks against existing conversations and provider settings.
- Tested packaged build and a morning report of completed, blocked, and remaining work.

## Overnight execution agreement

- Order: conversation controls, code/files, search/organization, project defaults, zQ actions; recovery throughout. Dictation includes both modes and Settings → Voice; establish engine compatibility and the recording flow before implementation.
- Each implementation item needs dependencies, bounded file scope, acceptance checks, and a stopping condition.
- Preserve Appearance, sidebar geometry, credentials, and regular user data.
- Use isolated temporary stores and fixture providers for mutations and automated tests.
- Preflight required dependencies, native build tools, and package/launch commands while the user is present.
- Identify any proposed paid live API tests and obtain an explicit budget before running them.
- Source authorization does not override system/sandbox or macOS device permission requirements. Record a blocked item and continue independent approved work when possible.
- Research, tests, and UI simulation can proceed without granting microphone access; actual recording permission is handled by the user when testing/using dictation.
- Verification commands: `npm test`, `./node_modules/.bin/tsc --noEmit -p apps/desktop/tsconfig.json`, `npm run pack`; scoped protocol/lifecycle tests first. Quit the app before replacing its packaged files, then verify in the isolated workspace and restore the regular workspace.

Current architecture: React/TypeScript UI in `modules/chat`, native services/storage in `apps/desktop/electron`, provider adapters in `packages/providers`, public bridge types in `packages/module-api`, shared shadcn/Radix components in `packages/ui`. Native/schema changes require an updated shell capability as well as the Chat module version. No git metadata is currently available; do not assume commits or worktrees can be created.
