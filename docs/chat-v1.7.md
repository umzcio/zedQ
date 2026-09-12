# Chat v1.7 release report

Implemented and packaged on 2026-09-09. The updated app is open in the regular workspace. Appearance and sidebar geometry were preserved; all mutation tests used isolated data.

## Available now

- Edit/resend, retry, regenerate with another model, navigate response versions and branch conversations without discarding the original history.
- Compact message actions through hover controls, right-click and keyboard-accessible menus. Copy text/Markdown, save or append to Notes, create Tasks, and return through source links.
- Code highlighting, copy confirmation, wrapping and file saving; generated-file preview, download, follow-up attachment and project reuse.
- Message-content search including earlier versions, matching snippets and jump-to-message; find within a conversation and jump to latest.
- Pin/unpin chats and projects, archive, Trash/restore and Markdown export.
- Project model/tool defaults, full-text project file search and inspection of the instructions/references included in a request.
- Durable unsent drafts, attachment recovery, active conversation and reading position. Response details show model/provider, timing and usage when reported by the provider.
- Composer microphone and Settings → Voice: Apple on-device transcription or a compatible saved OpenAI connection, microphone/language choices, explicit Stop & transcribe and Cancel. Transcripts append to the originating editable draft and are never sent automatically.

## Verification

The full suite completed with **364 passing tests, no failures and one existing skip**. TypeScript checking and the arm64 packaged build passed. Packaged UI checks covered response versions, historical search, generated files, source navigation, pinning, Trash restore, Voice settings, focus/Escape behavior and a 240-message conversation. A draft and its CSV attachment survived a clean quit. The original isolated store was restored before reopening the regular workspace.

Voice recording/transcription states were exercised with fixtures. Actual microphone access, speech permission attribution and successful live recognition still require an attended packaged test. Provider transcription supports official saved OpenAI connections; on-device availability depends on the selected language and the Mac's speech support. Recordings are capped at 60 seconds, cancellation discards audio, and local failure cannot fall back to a provider upload.

No paid live provider calls or actual recordings were made. Cost estimates, voice-to-voice, interactive artifact editing and large-document retrieval are outside this build. This is a local development package; distribution signing/notarization remains separate.

Details: [execution ledger](../plans/chat-v1.7-progress.md), [Voice research](../plans/chat-v1.7-voice-research.md), [provider usage research](../plans/chat-v1.7-provider-usage.md).
