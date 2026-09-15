# Downloaded PDF reading and response continuation

The reported Drive workflow downloaded and displayed a PDF but supplied the model only an attachment notice. A follow-up `read_document` rejected imported files because they lacked editable source. The same workflow could exceed Ollama's remaining tool allowance in a batch and stop before the final summary; the UI placed its failure above the full response.

## Changes

- Reuse the bounded PDF worker for connector downloads and chat-scoped imported PDF reads. Supply extracted text as reference data while preserving the original attachment. Keep reading separate from revision permission: imported PDF text does not authorize lossy layout rewrites.
- Bound decoding, worker memory/time, and serialized text. Abort stops worker extraction. Explicitly report absent text layers, unsupported PDFs, and excerpts; extraction failure does not turn a successful download into a failed action.
- Skip an entire over-budget Ollama batch and request a final summary without tools. Keep the 16-action execution limit and incomplete status.
- Preserve partial failed/interrupted narrative in subsequent context with an incomplete marker. Existing downloaded artifacts remain available through `read_document`.
- Place failure details below the response with a Continue response action for the latest failed answer. Reuse current model/tool selections; do not overwrite unsent drafts or bypass queued messages.

These repairs are authorized by the user's two reported failures. Other connector work remains deferred. No new lists or user-owned item types were introduced; existing message/file context menus remain unchanged. Feature UI stays in Chat; file processing stays in the shell. No host API or storage-schema changes.

## Verification

- Four new regression cases failed before implementation: downloaded PDF text, imported PDF reread, partial failed context, and over-budget batch summary. They pass after the changes.
- Focused connector/document/Ollama suite: 54 passed. Additional PDF excerpt, unreadable-file, cancellation, and empty-text-layer tests passed.
- Full desktop suite: 798 passed, 52 skipped, three native-runner tests blocked by the active Xcode license state. Reran those three with `DEVELOPER_DIR=/Library/Developer/CommandLineTools`; all passed (801 passing cases across the runs).
- TypeScript check passed. Long-response browser fixture confirms footer visibility at the bottom, continuation dispatch, and preservation of an unsent draft. Approval disclosure browser fixture passed.
- Queue browser focus assertion times out after saving an edited queued message. Reproduced the same failure using unchanged `HEAD` ChatView; recorded separately in `plans/backlog.md`.
- Single-module Chat build, all bundled modules, renderer build, and arm64 packaging passed. Reused unchanged native helper binaries; no Xcode license acceptance or native source changes.
- `node apps/desktop/tests/chat-pdf.packaged.cjs .local-data/pdf-release/mac-arm64/zQ.app/Contents/MacOS/zQ` passed: real packaged PDF extraction and artifact storage with synthetic connector/model; continuation rereads the local PDF with exactly one connector download. Disposable profile removed afterward.
- Signed module update verified against the target shell using a copy of module storage. Installed tested shell and Chat 1.18.14, restarted the regular app, verified matching app archive hash and activated module version with no pending update. Backup: `.local-data/app-backups/pre-pdf-reading-2026-09-15/`.

## Limits

This extracts existing PDF text; it does not add OCR for scanned images, visual reasoning over pages, or general imported Office-file reading. PDF extraction remains limited to 10 MB, 100 pages, and 100 KB extracted text; provider excerpts are explicitly marked. Tests use synthetic documents, not the user's Google account or registration files.
