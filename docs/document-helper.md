# Fixed document helper

The desktop renders Chat documents and artifact-editor revisions through `DocumentHelper.app`, an embedded App Sandbox XPC service. App users need no Docker, Python installation, or runtime download. The helper adds approximately 142 MiB to this development bundle. Builds target Apple silicon and macOS 13+; platform verification was run on macOS 26.

## Boundary

The trusted host parses Markdown into headings, paragraphs, lists, code blocks and tables. It sends protocol version 1, operation `render_document`, and a document containing `format`, `title`, `blocks` and `typography`. The only formats are DOCX, XLSX, PPTX and PDF. The operation has no code, shell, path, package-install, network, or runtime-selection argument. Both endpoints validate the request; the host independently checks canonical base64, file size, MIME/extension agreement, Office ZIP structure and document parts, or PDF signature/trailer before committing anything. These checks are not a complete PDF/Office conformance or malware scanner.

The caller is authenticated by an XPC code-signing requirement. The service has only App Sandbox; its supervisor, worker and bundled Python inherit that sandbox. There is no network entitlement and no custom Seatbelt profile. The worker runs only the bundled zQ renderer, with pinned Python, document libraries and font resources. Spreadsheet text is literal, including strings beginning with `=`; this operation does not calculate formulas.

Requests are limited to 1 MiB, document source to 100 KiB (Chat applies its existing 100,000-byte limit), output to one file of at most 4 MiB, and stdout/stderr to 6 MiB. One host job runs at a time with at most eight waiting jobs. Execution and cross-process admission share a 30-second deadline. Native CPU and per-file limits, bounded document dimensions, and a sampled private-job file watchdog provide additional limits; macOS does not provide a hard RAM quota here. App Sandbox cannot sample another process's memory through the prototype's `proc_pid_rusage` method, so the supported supervisor only samples private-job files.

Cancellation is terminal for an XPC connection. It terminates the supervised worker and prevents artifact commits. The next job waits for cleanup's lease. The supervisor observes service exit, reaps the worker and clears its private job directory before releasing admission. Simultaneous supervisor/worker failures are not a kernel-enforced lifetime guarantee. This boundary is for fixed trusted operations, not arbitrary hostile scripts.

## Chat, skills and revisions

Existing artifact cards, previews, downloads, note/task attachments, context menus and version history remain in use. `read_document` exposes a stored source revision; `revise_document` creates a new immutable file after checking the expected version. Old bytes remain unchanged. Imported documents without stored editable source cannot be round-tripped by these tools.

Installed standard skills can supply instructions and readable references that guide these tools. Loading a skill does not execute its bundled scripts or install its dependencies. Activity distinguishes loaded instructions from document creation/revision on this Mac. Arbitrary Python/JS, LibreOffice, OCR, formula recalculation and Linux tools remain outside this helper.

PDFs embed the available fonts and support ordinary Latin, Greek and Cyrillic text with accent normalization for display. Unsupported glyphs or text requiring complex-script/RTL shaping fail explicitly with a DOCX suggestion. Proper shaping plus text extraction is future work; PDF output never silently substitutes missing glyphs. Original source remains unchanged in the artifact version.

## Build and verify

`npm run build` and `npm run pack` build the helper automatically. `npm run documents:build` builds it alone. Build-time preparation downloads the SHA-256-pinned CPython archive and hash-locked wheels into `.local-data/document-helper/runtime`; it never modifies system Python. Bundled runtime provenance, lockfile and dependency/font licenses remain in XPC Resources.

Local builds use ad hoc signing with a caller hash requirement. Ad hoc Python has no Team ID, so Hardened Runtime library validation cannot load its ad hoc extensions; development signing keeps App Sandbox without Hardened Runtime. Setting `ZQ_NATIVE_SIGNING_IDENTITY` to an Apple-issued identity enables Hardened Runtime, timestamps and a designated caller requirement, signing all extensions with that identity. Release identity signing, whole-app signing/notarization and distribution validation still require a release pipeline; local verification does not establish them.

```sh
npm run documents:build
.local-data/document-helper/runtime/python/bin/python3.12 -I -B apps/desktop/native/document-helper/test_renderer.py
ZQ_TEST_DOCUMENT_HELPER=1 node --test --test-concurrency=1 apps/desktop/tests/document-helper-native.test.cjs apps/desktop/tests/chat-document-helper.test.cjs
ZQ_TEST_DOCUMENT_HELPER=1 node apps/desktop/tests/artifact-revisions.browser.cjs
```

Platform and Chat tests use disposable jobs and artifact stores. The browser fixture verifies the actual helper's DOCX bytes in the existing right-hand preview, selection of old revisions, navigation cleanup and right-click revision flow. Do not run native suites concurrently against the same built helper identity while testing process interruption.

The earlier `native/skill-helper-prototype` remains a development experiment and is not copied into app resources or exposed to Chat. See the [execution decision](native-helper-execution-decision.md).
