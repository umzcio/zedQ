# zQ desktop foundation implementation plan

> For agentic workers: use executing-plans with a bounded storage/file implementation delegated through subagent-driven-development; verify each deliverable and review the integrated result.

**Goal:** Open zQ as a macOS app, persist real notes/tasks/preferences, edit local UTF-8 files with recovery, and validate local model and terminal access.

**Architecture:** `apps/desktop` contains a sandboxed React renderer and Electron main/preload bridge. Native services own durable local state, file grants and execution; renderer receives named operations only. Keep `prototype` working separately. This first local milestone does not implement the shared server or select a Code harness.

**Tech stack:** Registry-verified current stable Electron, React, TypeScript, Vite, shadcn/Radix, Node native file APIs, node-pty for an isolated terminal proof. Version lock and macOS arm64 packaging.

**Spec:** `docs/zq-product-spec-v0.1.md`, plus the user's approved local-first desktop milestone in conversation.

## Global constraints
- Keep the two-nav design, compact sidebar, light/dark/system and green/blue/red/gunmetal.
- Code preserves CLI-owned authentication. No credentials imported or synchronized.
- Local file contents and recovery drafts stay device-local. No browser-storage dependency in the desktop app.
- Current stable compatible dependencies; record exact resolved versions.
- No git repository exists here: work in the new desktop directory; no worktree or commits are possible until Git is initialized.

## Task 1: Native persistence and local files
Files: `apps/desktop/electron/storage.cjs`, `files.cjs`, `tests/storage.test.cjs`, `tests/files.test.cjs`.
Interfaces: `WorkspaceStore(directory).load()/save(state)`; `FileService(directory).list()/open(path)/edit(id,body)/save(id)/saveAs(id,path)/reload(id)/close(id)`.
- [x] Write real temp-directory tests: restart preserves records, corruption never silently overwrites data, atomic saves; file draft recovery, external modification conflict, binary rejection, unknown ID rejection, permissions preserved.
- [x] Run Node tests and record expected missing-feature failure.
- [x] Implement versioned atomic JSON with restricted permissions and fsync. Reject corrupt/unknown schemas instead of resetting them. Native-owned file grants and hash-based conflict checking; max 2 MiB UTF-8 files, native save-as for copies.
- [x] Run tests to green and review. Renderer may never supply a save path except through the native dialog handled by main.

## Task 2: Desktop shell and real editing
Files: `apps/desktop/package.json`, `electron/main.cjs`, `preload.cjs`, `src/*`, root `package.json`, `packages/module-api/index.ts`, `modules/registry.ts`.
- [x] Copy the approved prototype presentation into the desktop app; retain the browser preview independently.
- [x] Wire narrow validated IPC, sandbox/context isolation, local packaged content, denied navigation/new windows/permissions, native app menus and single-instance handling.
- [x] Load persisted state before render; save changes with truthful pending/error status. Flush current state and file drafts before window close or app quit. Handle save failure without closing.
- [x] Start with empty tasks and one blank note, no fake progress or seeded personal content. Persist selected view, note tabs, quick capture and file drafts.
- [x] Add native Open File, Save, Save As, Reload from Disk and local file editing within Notes, with explicit conflict handling and draft recovery. Keep dirty drafts if a file tab closes.
- [x] Register module IDs/contributions through a minimal versioned module interface consumed by navigation.
- [x] Build/type-check and verify real UI: note/task creation, theme, file open/save and app restart recovery.

## Task 3: Execution proofs, packaging and handoff
Files: `apps/desktop/electron/runtime.cjs`, `scripts/check-runtime.cjs`, `tests/runtime.test.cjs`, `README.md`.
- [x] Verify Ollama through the user-selected endpoint: list installed models. No inference, downloads, service startup, or endpoint fallback.
- [x] Launch a real PTY shell with native ABI rebuilt for Electron; detach a listener, reattach to the same session and check process identity/output. This development proof does not enable the Code module.
- [x] Build a local macOS arm64 app bundle with stable Electron and verify launch, bridge, persistence after quit/reopen, file save, and native PTY from packaged resources.
- [x] Request a focused review of data integrity, IPC and lifecycle; fix material findings; rerun affected checks.
- [x] Document commands, data paths, limitations, versions and completed checks. Deliver the app bundle path. Cross-Mac sync and complete Chat/Work/Code modules are the next milestones.

## Execution record
- Prototype baseline: TypeScript and Vite production build pass.
- Desktop creation authorized by user; proceed without another design approval.

- Final checks: 38 Node tests pass; TypeScript/Vite production build passes; local macOS arm64 bundle built.
- Native PTY proof passed with Electron 44.2.0 / Node 24.20.0, same shell PID after detach/reattach, replay verified, process stopped.
- User corrected Ollama target to http://model-server.example:11434/. Native probe succeeded with 16 model names. The temporary local Ollama process was stopped; no models were downloaded or inference requested. Runtime command now requires explicit ZQ_OLLAMA_URL for Ollama probing.
- CUA verified native app launch, note edit and full quit/restart, native configuration-file Open/Save, a Doing task, and a file recovery draft surviving quit without overwriting the original.
- Review fixes: serialized file saves/flush, editing lock during explicit actions, shutdown inert state including portalled dialogs, close-attempt IDs and timeout cancellation. Seven focused regression checks plus backend suites cover the failure paths.
- Native picker needed explicit All Files filter for .env selection. Verified against real dialog. Electron binary requires macOS 13.0, reflected in bundle minimum version.
- Package remains a local unsigned development build. Cross-Mac sync and complete Chat/Work/Code modules remain subsequent milestones.
- All seven in-app dropdown locations now use shared shadcn Select components in both desktop and browser prototype. Menus inherit appearance/accent tokens, support empty Personal/All projects values, and close during desktop shutdown. CUA verified themed popovers, keyboard selection, and Escape dismissal within the task dialog; both builds pass.
