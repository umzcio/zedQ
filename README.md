# zQ / zedQ

A modular personal desktop workspace. The first desktop foundation is in `apps/desktop`; the original browser design preview remains in `prototype`.

## Run the desktop app

Requirements: macOS 13+ on Apple Silicon for the current packaged build; Node 26 and npm 11 for development. Other Macs need their macOS/architecture checked before distribution.

```sh
npm ci
npm run rebuild:native -w @zq/desktop
npm run modules:keygen # once, or set ZQ_MODULE_SIGNING_KEY to an existing private key
npm run build
npm run desktop
```

Electron may download its runtime on first launch. Native rebuild is explicit: do not add `electron-builder install-app-deps` as a workspace postinstall hook; it caused recursive installs with this workspace layout.

The build also prepares and bundles a pinned document runtime. Chat and artifact revisions create DOCX, XLSX, PPTX and PDF through an App Sandbox helper without Docker or a separate Python install for users. See [document helper capabilities, limits and verification](docs/document-helper.md).

```sh
npm test
npm run pack
```

App bundle: `apps/desktop/release/mac-arm64/zQ.app`. This is a local development build, not a signed/notarized distribution or auto-updating release. Drag it into Applications if you want a stable Dock location. The app runs without the Vite server.

## What works

- Compact top navigation with outline icons, centered workspace search (⌘K), one contextual sidebar, and a header appearance menu. Light/dark/system use neutral surfaces with four accent palettes.
- Scratch notes, manual Kanban, search, linked tasks, persistent appearance and basic workspace layout.
- Local UTF-8 files up to 2 MiB: native Open File, explicit Save/Save As, disk reload, recoverable drafts, and external-edit conflict detection. Dotfiles are selectable.
- Saved data lives in `~/Library/Application Support/zQ/workspace.json`; local file grants and recovery drafts live separately in `files.json`. Both are private versioned atomic JSON stores. File drafts (including .env content) remain local; they are not indexed or synchronized.
- Scratchpad edits autosave; local file edits autosave a recovery draft, while Cmd+S writes the original file. File warnings offer reload or saving a copy. Closing a file view retains its recovery draft.
- Quit flushes pending work. A save failure keeps the app open unless the user explicitly chooses to quit without saving.

The desktop starts with one blank note and no sample tasks. Browser prototype data is separate and is not silently imported. Cross-Mac sync, memory, Work, and Code modules are not implemented yet. HQ, Notes, Tasks and Chat now own their code in separate modules and load from independently built, signed packages. Settings → Modules installs local or HTTPS updates and stages rollback for the next launch. These are trusted first-party modules, not a public third-party plugin sandbox. See [module architecture and release guide](docs/modules.md).

## Runtime validation

```sh
ZQ_OLLAMA_URL=http://127.0.0.1:11434/ npm run check:runtime
```

This development command starts a temporary real PTY shell, verifies detach/reattach to the same process, checks replay, terminates it, and lists models at the explicitly selected Ollama endpoint. It does not install/start Ollama, download models, run inference, or fall back to a different endpoint. Without `ZQ_OLLAMA_URL`, Ollama is skipped. Terminal proof is process-lifetime persistence only: it is not the deferred tmux/Herdr integration and does not survive quitting its owning process.

Set `ZQ_DATA_DIR` to an absolute disposable directory for isolated app verification. Do not run two clients against the same data directory; the app enforces a single instance. Normal app launches use Application Support.

## Structure

- `apps/desktop/electron`: native persistence, file grants, IPC, app lifecycle and execution proofs.
- `apps/desktop/src`: React shell, navigation frame, search, Settings and module loader.
- `modules/hq`, `modules/notes`, `modules/tasks`, `modules/chat`: independently built feature code, controllers and styles.
- `packages/module-api`: versioned host, lifecycle, commands and service contracts.
- `packages/ui`: shared shadcn components and theme primitives.
- `packages/providers`: native model provider implementations.
- `scripts`: individual module builds, signing and key generation.
- `docs`: product specification, research and implementation records.

Exact current stable versions checked September 7, 2026: Electron 44.2.0 (embedded Node 24.20.0), React 19.2.8, TypeScript 7.0.2, Vite 8.2.2, Tailwind 4.3.3, electron-builder 26.15.3, node-pty 1.1.0. Root package-lock pins the dependency graph.

Document tabs support drag-to-reorder, a shared shadcn right-click menu (close, close others/right/all, move left/right), middle-click close, and keyboard navigation. With a tab focused, arrow keys switch tabs, Option–Shift–Left/Right reorders, and Delete closes that tab. Desktop tab order and closed/open state survive restart. Closing a tab keeps its note or local file recovery draft; reopen notes from the sidebar and local files through Open File.

## Chat attachments and motion

Chat supports named Ollama, vLLM, OpenAI, Anthropic, Google Gemini and xAI connections with streaming responses and Stop. API keys are stored in macOS Keychain. See [provider setup and verification](docs/providers.md). A lowercase animated z indicates waiting/thinking; completed replies have no repeated brand label. Motion respects the system reduced-motion preference.

The composer’s shadcn + popover offers Upload files and Add from Notes. Files can also be dropped onto Chat, and screenshot files pasted into the composer. Compact attachment cards offer previews and removal; sent snapshots remain previewable after restart. Unsent file attachments are held in memory until sent or removed.

Supported: PNG/JPEG/WebP images, PDF text, and UTF-8 text/code files. Limits: 10 files/notes per message, 10 MiB per source file, 100 KB combined extracted text, PDF documents up to 100 pages. Scanned PDFs do not undergo OCR; attach screenshots instead. Images are normalized to JPEG, at most 1600 pixels on the long edge and 1 MiB, with a vision-capability check against the selected model before sending. Attachments are sent only with their chosen conversation. Original files are never modified.

PDF extraction uses PDF.js in a worker with a timeout; image dimensions are checked before native decoding. Full attachment snapshots live in the private local chat store; renderer streaming updates carry only metadata and thumbnails.
