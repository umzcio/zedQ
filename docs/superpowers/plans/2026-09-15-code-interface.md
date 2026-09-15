# Code interface and workspace release implementation plan

> **For agentic workers:** Use superpowers:subagent-driven-development to execute tasks with independent review. The user authorized the complete release; continue through integration and interface testing.

**Goal:** Ship the usable Code module with persistent local/SSH sessions, Claude profile continuity, structured Chat and real Terminal, files/diffs/editing, and preview forwarding.

**Architecture:** Native services own processes, private storage and validated operations. The independently signed Code module uses a typed host bridge and stays mounted across navigation. Existing launcher functions remain authoritative for account configuration.

**Tech Stack:** Electron, Node, tmux, system SSH, React, xterm, shared Radix components.

**Spec:** `plans/code/first-release-design.md`

## Global Constraints

- Feature UI, stateful controllers and feature styles belong in `modules/code`; shell owns frame, native services, trusted loading and durable storage.
- Preserve exact native conversation ID, cwd, configuration and zQ session across profile/interface switches. One controller at a time. Never use latest-session heuristics, fork history, copy credentials, or bypass permissions.
- App quit detaches; Stop explicitly terminates only owned sessions. External tmux detach must not kill it.
- Keep UI compact and neutral; shared Radix menus/dialogs; useful context menus for projects, sessions, profiles, terminal, files, changed files and previews.
- Test mutations only in isolated workspaces. Do not read secret values into tool output or modify the regular workspace.
- No placeholder controls or false success. Expose actionable errors beside the active session and preserve partial output.

### Task 1: Native Code sessions, Claude adapter and typed bridge contract

**Files:** Native implementation under `apps/desktop/electron/code/`; types `packages/module-api/code-types.ts`; behavioral tests `apps/desktop/tests/code-*.test.cjs`.

**Consumes:** Existing `connectCodeService`, exact-resume planner and handoff coordinator. Read their tests before extending. Existing foundations must retain their safety properties.

**Produces:** `CodeService` exported from `apps/desktop/electron/code/code-service.cjs`, constructor `{directory, onChange, onTerminal, pickDirectory?, openExternal?, reveal?}`, `invoke(method,input)` with a closed allowlist, `close()` detaches. A typed `CodeBridge` exposing `invoke` (typed operation mapping), `subscribe` snapshots and `onTerminal` ANSI chunks. Export all Code types through module-api index. Define complete types before runtime implementation so the UI can consume the contract.

- [ ] Write failing behavioral tests for durable project/profile/session CRUD, invalid input, exact-ID new/resume, controller conflict and reconnect. Define `CodeSnapshot` with hosts/projects/profiles/sessions and runtime availability; sessions include ID/project/profile/native ID/mode/state/revision/title/error/archive metadata. Profiles reference host-local launcher path/function, never contents/env. Seed the six observed launchers only by detecting their names from the known file without evaluating/dumping it; users can edit/remove profiles.
- [ ] Implement private atomic catalog independent of ordinary workspace state. Project deletion removes records only and must reject running-session loss or retain sessions explicitly. Expose create/update/archive/stop/resume and profile/interface handoff operations. New Claude session establishes UUID via `--session-id`; resume uses exact ID. Unknown native identity blocks handoff. Confirmation of process exit is mandatory before restart. Never auto-replay prompts/approvals.
- [ ] Add persistent structured protocol runner for Claude, using stream-json input/output and native control request/response for permission/questions. Preserve user prompts, assistant messages, tool events, errors and approvals in bounded private journal. CLI output is parsed, never interpreted as instructions for zQ. Permission default denies/unanswered; user decisions are explicit. Do not use permission bypass. Protocol init must acknowledge expected session ID before considering handoff ready. Errors/auth/limit states are actionable and retained.
- [ ] Real Terminal attaches via PTY to tmux; use xterm-ready ANSI byte stream, not screen scraping. Native client detaches without stopping owned process. Input lease applies to terminal and structured controls; prevent duplicate controllers. Support resize, initial repaint, reconnect and bounded output/backpressure. No global environment changes.
- [ ] Verify with synthetic CLI/PTY processes: app-client close/reconnect same PID; exact-ID profile and interface roundtrip; uncertain stop prevents replacement; pending approval isn't granted/replayed; failed target preserves recoverable state; malformed/oversized protocol data bounded. Run existing Code tests too. Record test commands/output and limitations in task report; commit only owned files.

### Task 2: Host workspaces, SSH, external terminal attachment and previews

**Files:** `apps/desktop/electron/code/workspace*.cjs`, `remote*.cjs`, `preview*.cjs`, Code service/types extensions, behavioral tests.

**Consumes/produces:** Extend Task 1's `CodeService.invoke` and `CodeBridge` operation mapping. Local and remote projects share operations for list/read/write files (fingerprint conflict checks), git status/diff, tmux discovery/attach, and preview forwarding.

- [ ] Write tests for workspace containment, symlink escape, stale file save, binary/oversize rejection, filenames with shell metacharacters and literal git path arguments. Implement bounded file tree/read/edit with atomic writes and SHA-256 fingerprints. Diff supports staged/unstaged/untracked files without mutating git. All paths resolved against selected project; never trust renderer absolute paths.
- [ ] SSH uses system configuration aliases and keys; no stored passwords. Add host management/preflight and actionable connection failure. Remote argv must be shell-quoted exactly once; no interpolation. Host-local launchers configured explicitly. Remote persistent service bootstrap/install is scoped to user's private zQ directory and explicit Connect action. Reconnect must preserve remote process. Validate with local SSH fixtures where available, otherwise deterministic command/transport tests and document unverified live host boundary.
- [ ] Discover/attach existing tmux sessions local and remote; label external ownership. Detach never kills external session. Unknown native identity permits Terminal only; explicit validated native ID needed to resume as Claude. Do not seize another controller silently.
- [ ] Preview permits HTTP(S) loopback URLs; remote forwarding uses SSH `-L` bound to 127.0.0.1 with owned lifecycle/port allocation. Close/reopen and Stop forwarding release only owned process. Use sandboxed content with no native bridge, or external browser when embedding prohibited. Tests cover invalid URLs/ports, process exit, cleanup.
- [ ] Run focused tests, append full report, commit owned files.

### Task 3: Visible Code module and shell integration

**Files:** `modules/code/{index.tsx,manifest.json,package.json,*.tsx,*.css}`, `packages/module-api`, shell IPC/preload/loader/navigation, module build/store validation, relevant tests.

**Consumes:** Typed `CodeBridge`, CodeService snapshot/terminal subscriptions. No direct native imports in module.

- [ ] Add `code.v1` host capability and signed `zq.code` module. Update all hardcoded four-module assumptions, durable layout validation and navigation icon/view. Existing four module fallback/update behavior remains valid. Native changes require full desktop package.
- [ ] Persistent module Root contributes sidebar and main via ModuleSurface. Projects group sessions, with New session, profile/mode controls, status and adjacent recovery. Project/profile management dialogs and context actions per spec. Add folder picker and SSH host setup. Empty states explain next action; no fake tabs.
- [ ] Integrate xterm with fit/search addons; true live ANSI, resize/focus/theme, copy/paste/find/clear/detach menu. Dispose frontend attachment on navigation as appropriate but never terminate session. Restore selected session after reopen. Errors shown at active bottom area.
- [ ] Structured Chat renders user/assistant/tool/approval/question events, composer and interrupt, explicit profile/interface handoffs. No control input when switching/disconnected/unknown ownership. Pending approval cards actionable and collapse once answered. Preserve exact conversation on switch.
- [ ] Files tree + text editor with save/reload conflict flow and dirty close protection; Changes diff; Preview URL/forward controls. All new collections include useful context menus. Use shared UI primitives, consistent sidebar heading/collapse and neutral surfaces. No excessive tooltip copy.
- [ ] Add meaningful interaction/bridge/module validation tests; typecheck, module build, full build. Report and commit.

### Task 4: Native end-to-end verification and testing package

**Files:** Code smoke tests, release validation record, Code README and module docs.

- [ ] Build/package shell with five signed modules and no signing secrets. Launch with isolated `ZQ_DATA_DIR`; interact through UI to create project/session, send input, reopen same process, switch modes/profiles, edit fixture file and inspect diff/preview.
- [ ] Exercise installed Claude in an isolated scratch checkout, preserving existing user configuration and account arrangements. Use tiny harmless prompts and simulated usage-limit fixtures; never exhaust accounts or mutate user work. Verify native IDs through structured init or native transcript metadata without dumping unrelated history. If an account is unavailable, expose that failure in UI and document exact boundary.
- [ ] Review complete branch; fix blockers; run typecheck, all tests, full build/package. Restore normal workspace and deliver new app build ready for user's interface testing. Report precise supported/verified behavior, not merely internal services.

## Progress

Implementation has not started. Foundations at `a9e4a82` remain the baseline.
