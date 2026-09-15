# Product backlog

## Deferred — connectors (entire workstream)

Deferred at the user's request on 2026-09-14. Pause all connector implementation, expansion, polish, and verification until explicitly resumed. Existing shipped connector functionality remains available. The next active project should be outside connectors and is not yet selected.

### Email attachments

- Attach chat files and generated documents to Gmail drafts.
- Download incoming email attachments into chat.
- Include filenames, sizes, and recipients in the native send review.
- Preserve original file bytes, enforce chat-scoped file access, and test uploads/downloads and denied sends in an isolated workspace.

### Microsoft 365 verification

Verify work-account authentication, tool discovery, and representative Email, Calendar, OneDrive, and Teams actions. Distinguish tenant/admin restrictions from app errors. Test mutations in isolated fixtures; real account checks should be read-only unless explicitly requested.

### Further connector work

- Larger/resumable Google Drive uploads and general local-file uploads.
- Additional connectors and research integrations.
- Connector discovery, setup, tool selection, and permission UI improvements.
- Further connector reliability and compatibility verification.

## Chat queue keyboard focus

- The queue browser regression times out when expecting focus to return to “Edit queued message 1” after a successful save. Reproduced on both the current changes and unchanged ChatView on 2026-09-15. Investigate dialog close autofocus and disabled trigger restoration; retain keyboard access and preserve queued content. This is separate from PDF reading and response continuation.

## Already shipped

Gmail draft creation and reviewed sending, Google Calendar actions, and Google Drive document uploads remain available.

### Google Drive uploads (2026-09-14)

Save document artifacts available in the current chat to a chosen Drive folder. Review the exact file/version, destination, and inherited folder access before upload. Return the created file link only after confirmation. Do not overwrite existing files or alter sharing. Implemented for PDF, Word, Excel, and PowerPoint document artifacts up to 5 MB. Verified with isolated unit/integration tests and a packaged create → review → upload fixture. Larger/resumable uploads and general local-file uploads remain future work.
