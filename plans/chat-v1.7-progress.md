# Chat v1.7 execution ledger

Plan: `plans/chat-v1.7-roadmap.md`. Authorized 2026-09-09.

## Tasks and acceptance

1. Complete — Native conversation lifecycle: alternate suffix histories, edit/regenerate/branch/version switching, provenance/timing; fixture tests prove restart, reference preservation, atomic failure and active-response guards.
2. Complete — Recovery/organization: durable drafts/view state, pin chats/projects, archive/Trash/restore, historical content search/export. Sidebar geometry preserved.
3. Complete — Message and code UI: compact context/hover/keyboard actions, versions, code highlighting/copy/wrap/save, find/jump.
4. Complete — Files/project context: inert generated previews/reuse, project defaults/full-text file search/context inspection; bounded imports and fixture tests.
5. Complete — Notes/Tasks actions: explicit public commands and source navigation, no sibling implementation imports.
6. Implemented; attended live validation remaining — Voice: researched Apple on-device and saved OpenAI transcription, Settings Voice, reusable recorder; captured settings, cancellation/permission/error fixtures. No real microphone/paid API tests.
7. Complete — Integration/review/package: full tests, typecheck, scoped review, package and isolated UI verification. Original isolated store restored and packaged app reopened in the regular workspace.

## Decisions

- Existing checkout has no git metadata. Work in authorized source tree; isolated stores for all mutation tests. Do not manufacture git/worktree history.
- Versions preserve the suffix following the edited/regenerated message. Selecting a version restores its following messages as well. Explicit Branch creates a separate conversation.
- Retain Trash until explicitly restored or permanently deleted by a future dedicated action; no automatic deletion policy.
- Voice local mode must enforce on-device recognition and never silently upload on failure. Fixture-only unattended tests.
- Preserve project/chat row dimensions and indentation. Pin sorting stays within the existing lists.

## Verification

- Baseline before v1.7: 311 tests, 310 pass, 1 skip (v1.6).
- Final `npm test`: 365 tests, **364 pass, 0 failures, 1 existing skip**. Log: `.local-data/v17-final-tests.log`.
- Desktop TypeScript check: passed.
- `npm run pack`: passed; arm64 packaged app includes the native speech helper. Log: `.local-data/settings-pack.log`.
- Packaged UI: response versions, historical search/jump, generated CSV preview and follow-up attachment, Notes source navigation, pin/unpin, Trash restore, Voice settings, nested Escape and Appearance preservation checked.
- Clean quit persisted the unsent draft, generated-file attachment, pin state and restored conversation.
- A 240-message fixture loaded and searched successfully; finding message 10 jumped to the correct older message. This is a functional long-thread check, not a measured performance benchmark.
- Fixture workspace preserved at `.local-data/v17-ui-verified`; preexisting isolated workspace restored. Regular app reopened with the user's existing conversations and provider selection.

## Remaining and deferred

- Actual packaged microphone permission, macOS speech authorization and live transcription need an attended test. No recording or paid provider calls were performed. See `chat-v1.7-voice-research.md`.
- Cost estimates are omitted: provider-reported token counters are available, but account-specific/tool billing is not estimated. See `chat-v1.7-provider-usage.md`.
- Voice-to-voice, interactive artifact editing and large-document retrieval remain later scope as agreed.
- Development app packaging remains unsigned at the app level; distribution signing/notarization is not part of this run.
