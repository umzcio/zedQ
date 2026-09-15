# Task 1 report — native Code sessions and Claude interface

Status: implemented; ready for parent review. Native work is confined to `apps/desktop/electron/code`, typed API exports, and focused tests/fixtures.

## Delivered

- `CodeBridge` and complete typed operation mapping, snapshots, projects/profiles/sessions, runtime availability, journal events and ANSI chunks in `packages/module-api/code-types.ts`, exported through module-api.
- `CodeService` native entry point with closed operation allowlist, subscription callbacks, directory picker/open/reveal ports, automatic reconnect without mutation replay, and close/detach semantics.
- Private atomic Code catalog within the dedicated Code service root, separate from ordinary workspace data. Project/profile/session creation and editing, profile duplication/removal, session archive/rename/stop/resume/switch. Projects with retained sessions and referenced profiles cannot be deleted. No checkout/native history/credential deletion.
- Known launcher discovery detects only the six approved function names from the known path without evaluating it or retaining contents. Profiles persist path/function/compatibility confirmation, never credential environment or function bodies.
- Existing authenticated, bounded, singleton tmux service now dispatches native Code operations. Process ownership and input leases survive renderer disconnection correctly; a service restart reconnects to the same structured runner. Handoff uses the existing coordinator and exact native UUID; new sessions establish a UUID with `--session-id`, subsequent launches use exact `--resume`.
- Persistent Claude stream-json runner with explicit initialize, user/assistant/tool events, native permission and question responses, rate-limit/error state, interrupt, private bounded journal and replay cursors. Pending decisions are never automatically granted or replayed. Busy/pending-approval sessions require explicit interrupt before handoff.
- Actual PTY attachment to tmux streams ANSI for xterm, with initial repaint, resize, bounded output and client detach. Input is daemon-serialized under the same exclusive lease to prevent cross-client release/write races.
- Additive Claude SessionStart identity hook records only native ID/cwd/source and a launch nonce in a private receipt. Both interfaces require matching identity and startup/resume source. Chat additionally requires successful native initialize acknowledgement. No synthetic prompt is sent for identity verification.
- Stop verifies process exit. Structured children own a process group; the runner remains alive until that group exits. Uncertain exit gates replacement. Journal write failure gates input and signals the child while preserving ownership. Target failure retains the original profile and native conversation with recoverable state.

## Validation

`node --test apps/desktop/tests/code-*.test.cjs`

Result: **64 passed, 0 failed, 0 skipped**. This includes 51 existing foundation tests, 11 new native tests, and 2 concurrently added UI session-model tests.

New process scenarios use temporary private workspaces and synthetic launcher functions, never normal-workspace test data:

1. Chat A → Terminal B → Chat A → explicit stop/resume retains exact native ID; explicit permission deny and app-client close/reconnect retain PID/history.
2. Real node-pty/tmux ANSI output, input, resize, initial repaint and detach/reconnect preserve the terminal PID.
3. Failed target retains original profile/native ID and successfully resumes the original profile.
4. Pending approval blocks handoff; explicit interrupt permits switching; neither prompt nor approval is replayed.
5. Child ignoring termination keeps ownership uncertain and prevents a replacement controller.
6. Killing/restarting only the host service reconnects to the same structured runner without prompt replay.

Unit coverage validates catalog durability/private mode, invalid launcher/project input, no launcher evaluation/secret persistence, conservative record deletion, exact protocol identity, explicit permission responses, and malformed/oversized protocol frames.

`git diff --check` on owned files: clean.

## Review notes and remaining integration limits

- Parent separately verified installed Claude 2.1.272 additive SessionStart receipts before any user prompt, exact-ID resume source, and ordinary user hooks remaining active. This native task's automated process tests are synthetic; it does not claim live cross-account continuity across all six existing launchers.
- Cross-profile preflight requires both profiles' explicit shared-history confirmation. Actual target history access is verified after confirmed source exit; launching a second native probe before exit would violate single-controller ownership. Unavailable target history therefore results in recoverable target failure.
- Hooks disabled or missing receipts block identity readiness. Adding an extra `--settings` flag may conflict with a trusted launcher that itself sets `--settings`; arbitrary launcher flag composition needs a compatibility check/live smoke before claiming universal configuration continuity.
- SessionStart hook receipt timeout is 5 seconds and native initialization readiness is bounded at 5 seconds. Slow configured hooks may yield a recoverable identity-readiness failure.
- Native IPC uses filesystem Unix sockets. Keep the private root short enough for the root plus a 25-character runner endpoint to fit the platform socket path limit.
- Terminal agent status is based on process/identity readiness, not interpreted ANSI content; native usage-limit and approval states are available in Chat.
- Runtime-unavailable snapshots explain missing tmux/PTY. SSH, external tmux discovery, file/diff surfaces and previews remain later tasks; this implementation is local-host Task 1.
