# Product backlog

## Deferred — email attachments

Deferred at the user's request on 2026-09-14. Gmail draft creation and reviewed sending already work; attachment support is separate future work.

- Attach chat files and generated documents to Gmail drafts.
- Download incoming email attachments into chat.
- Include filenames, sizes, and recipients in the native send review.
- Preserve original file bytes, enforce chat-scoped file access, and test uploads/downloads and denied sends in an isolated workspace.

## Completed — Google Drive uploads (2026-09-14)

Save document artifacts available in the current chat to a chosen Drive folder. Review the exact file/version, destination, and inherited folder access before upload. Return the created file link only after confirmation. Do not overwrite existing files or alter sharing. Implemented for PDF, Word, Excel, and PowerPoint document artifacts up to 5 MB. Verified with isolated unit/integration tests and a packaged create → review → upload fixture. Larger/resumable uploads and general local-file uploads remain future work.

## Next — Microsoft 365 verification

Verify work-account authentication, tool discovery, and representative Email, Calendar, OneDrive, and Teams actions. Distinguish tenant/admin restrictions from app errors. Test mutations in isolated fixtures; real account checks should be read-only unless explicitly requested.
