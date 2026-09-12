# Chat artifacts and sources

Implemented and packaged on 2026-09-09. The regular workspace is open in the updated arm64 app. Mutation checks used isolated data, which was preserved separately before restoring the original test workspace.

## Available

- Chat responses retain provider-reported web sources across saved response versions. Expand Sources for clickable titles and domains, with Open and Copy actions. Existing inline citations remain clickable. Older searched responses without source metadata label extracted links as linked sources; searches without returned links say so.
- Chat has a compact Artifacts library with search, format filters, saved versions, source-chat navigation and a Deleted collection. Visible menus and right-click actions include rename, download, version history, create a new version, attach to Notes/Tasks, delete and restore.
- Create real PDF, DOCX, XLSX and PPTX files from response content or the library. Headings, lists and Markdown tables become document structure. Revisions save immutable versions; existing provider-generated files are imported independently of chat history.
- Notes and Tasks persist exact artifact/version references. They offer preview, download, detach and explicit Update to latest. Updating an artifact does not silently change an attachment. Deleting an artifact is recoverable and retains saved version files.
- Tasks Active includes every unfinished status: Inbox, Next, Doing and Waiting. The same filter is used by Board, List and the Active count.

## Verification

- Full suite: **399 tests, 398 passed, zero failures, one existing skip**. Log: `.local-data/artifacts-final-tests.log`.
- Desktop TypeScript checking passed. The arm64 package built successfully; log: `.local-data/settings-pack.log`.
- Renderer tests inspect actual PDF/Office files, content, Unicode handling, pagination and bounded imports. Native tests cover immutable versions, stale revision conflicts, same-name files, restart, deleted-chat independence, corrupt storage, symlink rejection and interrupted writes.
- A rasterized PDF sample was visually inspected: headings, lists, paragraphs and its table fit cleanly. Office files passed structural/content checks; visual rendering in Office applications was not completed.
- Packaged UI checks covered source titles/domains, all four artifact formats, version selection, native PDF creation and download, a second PDF version, rename, delete/restore, attachment to an existing Task, explicit Note attachment update and Escape dismissal.
- After a clean quit, a fresh native service loaded all five test artifacts and verified all seven version files. The Note still referenced DOCX v2 and the Task DOCX v1.
- The original isolated workspace was restored. In the regular workspace, both original llm-img tasks were confirmed under Active: `test` in Inbox and `tw` in Next. Board and List were also checked with isolated fixtures.
- Final scoped review found no unresolved defects in Tasks visibility, original generated-file version resolution, library availability when Chat loading fails, or attachment-update deduplication.

## Current limits

The in-app document viewer renders actual PDF pages, formatted DOCX pages, XLSX worksheets and PPTX slides from the selected saved version. Browser rendering can differ from Word/PowerPoint in pagination, unavailable fonts and advanced objects; Excel charts, drawings and conditional formatting are not fully rendered. Downloads retain the original file bytes. Creation formats trusted text rather than running model-generated code. XLSX formula-looking values remain text. PDF uses bundled fonts by default, embeds supported selected fonts, and rejects unsupported glyphs explicitly instead of silently dropping them; DOCX is the fallback for unsupported scripts. Source lists depend on what the provider returns and do not manufacture citations.

No paid live provider calls or microphone recordings were used. Audio-provider work remains parked. This remains a local development package; distribution signing/notarization is separate. Native storage/IPC additions require this shell update alongside the bundled module updates.

Implementation checklist: [chat artifacts plan](../plans/chat-artifacts-plan.md).

## Natural-language document creation fix — 2026-09-10

The initial release exposed document creation through manual UI but did not make it callable by Ollama. Tool-capable Ollama models now receive `create_document(format, title, content)` and can create PDF/DOCX/XLSX/PPTX directly from a chat request. zQ executes the bounded local formatter, shows a document activity and downloadable response file, and saves its editable source in Artifacts. Successful tool results are returned to the model before it confirms creation. Native tool calls and reasoning are replayed according to [Ollama's tool-calling protocol](https://docs.ollama.com/capabilities/tool-calling).

This local function integration currently covers Ollama models reporting the `tools` capability. Other providers retain their existing hosted tools and manual artifact creation. The local formatter has no arbitrary path or shell access. Calls, content, output and total execution time are bounded; cancellation prevents late commits. Identical successful calls in one response reuse the original file, including when storage committed with a disk-flush warning.

Verification: **431 tests passed, zero failures, one existing skip**. New fixtures cover native round trips, capability checks, malformed/truncated calls, cancellation, storage warnings and generated-file persistence. The exact Montana prompt was tested live against `qwen3.8:27b` at the authorized model-server endpoint in an isolated workspace. It produced `Montana.docx` (9,156 bytes); the Office archive and poem text were verified. The live log is `.local-data/document-tool-live.log`; full tests are `.local-data/document-tools-all-tests.log`.

The arm64 package and typecheck passed. A second live run through the packaged Regenerate flow produced another valid DOCX (9,126 bytes), with preview, download and attachment actions verified. Both response artifacts survived a clean quit. The original test workspace was restored and the regular app reopened with the user's original conversation intact.


## Formatted right-hand viewer — 2026-09-10

Generated-file cards, the library and Notes/Tasks attachments open the same resizable pane beside Chat. The toolbar includes immutable version selection, zoom, download, expand/restore and close. Header right-click and the visible actions menu expose rename, version creation, attachment, source-chat navigation and delete/restore. Escape dismisses the topmost menu/dialog before the pane. Narrow windows show a full-width viewer; automatic previews do not hide a narrow composer.

The shell returns exact integrity-checked version bytes through `artifacts.document`. Before Office rendering it validates every ZIP member, including styles and media, against compressed and actual expanded limits. Office parsing/rendering runs in an opaque-origin iframe with no host bridge, remote connections, forms, active objects or document scripts. PDF uses a bundled PDF.js worker and page canvases. The document libraries are loaded only when needed.

Viewer implementation: [right-pane plan](../plans/artifact-right-pane.md). Verification: 442 desktop tests passed (one existing skip), plus three document-viewer tests covering production bundles and all four renderers with zero remote requests. Fourteen isolated controller scenarios covered navigation races and focus. Packaged checks covered formatted pages/slides/cells, exact version selection, resizing, expand/restore, Escape layering and iframe Escape, chat input, Notes/Tasks navigation with unsaved task edits preserved, and a PDF download identical to stored bytes. A live request to qwen3.8:27b on the authorized model-server server created `Welcome Note.docx` (8,989 bytes), automatically opened its formatted pane without taking composer focus, and survived restart. Logs: `.local-data/artifact-pane-tests.log`, `.local-data/settings-pack.log`.

Final packaged cold and warm Word reopen checks passed after the font/layout fix and removal of the pane translate animation. Test data is preserved at `.local-data/artifact-pane-ui-verified`; the original isolated workspace was restored.

## Revisions through chat — 2026-09-10

Tool-capable Ollama models now receive `read_document` and `revise_document`. Follow-up requests read the saved source, preserve unchanged content and formatting, and append a version to the same artifact. An open preview supplies its exact version as context; an older version can be used as the basis for a new version without replacing newer history. Generated-file cards, the library, and the preview header expose **Revise in chat…** through their visible and right-click menus. The action opens the document alongside its source conversation (or a new chat when the original is unavailable). New replies automatically open the resulting version; the version selector retains the originals.

Typography supports document title, section-heading and body sizes in points. Content-only revisions inherit saved typography. PDF, DOCX, XLSX and PPTX still use the bounded text/table formatter, not arbitrary code execution. Imported files without editable source are rejected for revision rather than reconstructed from a lossy preview. The model can access only artifacts represented in the visible conversation or explicitly selected by the user. Each revision requires reading its base first, checks the latest version before and after rendering, and respects cancellation. A repeated successful call returns the original result instead of creating another version. Existing Notes/Tasks references remain pinned to their saved versions.

Verification: **466 passed, zero failures, one existing skip** (`.local-data/artifact-revision-suite.log`), TypeScript and arm64 packaging passed. Regression tests cover all four revision formats, immutable bytes across restart, inherited typography, unrelated-library isolation, explicit older-version selection, malformed arguments, imported files, concurrent edits and cancellation. The browser test uses the actual composer/controller/preview and checks selection in the send payload, automatic Version 2 rendering, Version 1 reopening, pane dismissal on chat navigation, right-click revision from cards/library, and navigation during delayed source-chat creation. Successive edits in one response also retain the updated base. Run it with `node apps/desktop/tests/artifact-revisions.browser.cjs`.

A real `qwen3.8:27b` run on the configured Ollama server created `Team plan.docx`, then read it, reduced the section headings to 14 points, and added the requested Summary. One artifact held both versions, with the original bytes unchanged. All mutations were isolated in `.local-data/artifact-revision-live-0nVE2M`; the regular workspace was untouched. Log: `.local-data/artifact-revision-live.log`.

This is a shell-and-module update: the native tool executor and stored optional typography/context fields changed. Other providers retain their existing capabilities; equivalent local function execution across providers remains separate work.

## Document tools across providers — 2026-09-10

The existing create/read/revise workflow now extends to supported OpenAI, Anthropic, Gemini, xAI, OpenRouter, and Bedrock models. Each adapter preserves its native tool history and returns local document results before the model continues. Existing hidden Groq connections have a documented-model path; vLLM requires explicit tool capability metadata. Sonar remains search-only, and Gemini 2.5 requires hosted code execution to be off for local document tools. See [provider capabilities and official API references](research/provider-document-tools.md).

Verification: **513 passed, zero failures, one existing skip** in the final desktop suite (`.local-data/provider-tools-tests.log`). Isolated native ChatService tests create and revise real DOCX/PDF/XLSX/PPTX files, reload their stored versions, and verify original bytes, typography and response-file linkage. Bedrock uses real SDK binary event fixtures. Malformed/incomplete call batches, historical-ID conflicts, capped output, reasoning preservation, source retention, callback deadlines and stopped rendering are covered. The actual composer/preview browser regression passed (`.local-data/provider-artifact-browser.log`). These are API fixtures; no new paid cloud inference calls were performed.

Typecheck/build and arm64 packaging passed. All six provider implementation files were byte-compared with their packaged copies. The app was cleanly quit and reopened after packaging. The regular workspace received no test mutations; native test stores were temporary and removed after verification. This change updates native adapters in the desktop shell and reuses the existing artifact UI, commands and version schema.

## Font families — Chat 1.16.0

Document tools accept `fontFamily` plus optional `titleFontFamily`, `headingFontFamily` and `bodyFontFamily`. Supported choices are Arial, Times New Roman, Georgia, Verdana, Courier New, Bradley Hand, Brush Script MT and Comic Sans MS. Bradley Hand provides casual handwriting and Brush Script MT provides flowing script. Explicit role choices override the base font, including saved overrides; whole-document revisions should update existing role overrides consistently. Omitted fields retain defaults or the saved version's typography. Code blocks can retain monospace formatting.

The choices reach native Word styles, spreadsheet cells, slide text and tables, and embedded PDF fonts. PDF font files resolve only through fixed macOS system paths; model-provided paths, URLs, CSS and unsupported names are rejected. The existing bundled Noto glyph fallback preserves supported Unicode characters. Font-only edits preserve all source text and create another immutable version.

The right-hand Office viewer reads the exported font choices directly, with its existing isolated sandbox and network restrictions unchanged. Fonts are referenced by name in Office files and may be substituted on another device that lacks them; PDF embeds the selected fonts. See [PDFKit's font documentation](https://pdfkit.org/docs/text.html#fonts) for the embedding mechanism.

Verification: 639 desktop tests (638 passed, one existing skip), four shared preview/security browser tests, TypeScript and focused font-only revision tests. Preview checks use actual generated DOCX/XLSX/PPTX bytes and inspect rendered font families. Word and PDF handwriting samples were visually inspected. Tests use isolated fixtures and temporary stores; no test artifacts were added to the normal workspace.

Independent review also corrected mixed-font PDF baseline alignment and shaped-run spacing. A Latin/Devanagari regression checks that the Noto fallback is actually used, shares the handwriting baseline, and advances by the shaped width; the rendered sample was visually inspected.
