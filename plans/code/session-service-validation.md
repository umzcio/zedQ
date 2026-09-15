# Persistent Code session service — validation

Date: 2026-09-15. Native service milestone; not yet exposed in the installed app.

## Delivered

- Private tmux server with a singleton service session and independently running agent terminals. Clients connect over an authenticated version-1 Unix socket.
- Atomic, bounded, owner-private session catalog and lifecycle event journal. Session creation is idempotent by UUID; reconnect/recovery never silently respawns a lost agent.
- Exclusive per-connection input ownership; other clients can observe. Disconnect releases ownership without stopping the session. Write, resize and Stop require ownership.
- Bounded current-screen snapshots and lifecycle replay with sequence numbers/truncation indication. These are not a lossless terminal byte stream.
- Crash reconciliation preserves existing tmux processes. A lost server marks missing processes stopped. A missing pane with a surviving recorded PID remains `stopping`; no saved PID is blindly signalled.
- Input uses hex-byte transport to preserve semicolons, backslashes and UTF-8. Launch arguments are shell-quoted separately and verified by exact argv round-trip. The Electron Node-mode flag is limited to the service session.

## Test evidence

Environment: Node v26.5.0, tmux 3.7b, macOS. Development used `.local-data/worktrees/code-service`, branch `feat/code-session-service`. Tests created private `zq-persist-*`/`zq-service-*` temporary directories, HOME/ZDOTDIR overrides, synthetic agents, and separate tmux sockets. They never attached to the user's normal tmux server or read Claude account/configuration files. Teardown terminates the isolated servers and removes their temporary roots; the SIGHUP regression explicitly cleans its own synthetic surviving process.

| Verification | Result |
| --- | --- |
| Existing foundation baseline + typecheck | Passed |
| New storage tests | 5 passed |
| New persistent-service integration tests | 9 passed |
| All Code tests, including previous handoff tests | 51 passed, zero failures |
| `npm run typecheck` | Passed |
| `DEVELOPER_DIR=/Library/Developer/CommandLineTools npm test` | 851 passed, 53 skipped, zero failures; 904 total |
| `git diff --check` | Passed |

The Command Line Tools override avoids the existing system-Python Xcode license prompt; no license settings were changed. Skipped tests were not verified by this run.

Integration cases include entire client-process exit and another process reconnecting to the same agent PID; client disconnect and lease release; service crash/concurrent reconnect; lost tmux server without automatic respawn; interrupted creation; idempotent create; resize; exact argv and literal input; malformed Unicode tokens, unsupported protocol and oversized frames; foreign-session access; storage failure before spawning; durable lifecycle replay/truncation; and an agent ignoring SIGHUP that must not be reported stopped.

## Review

An independent read-only review reproduced two issues before integration: trailing-semicolon input corruption in tmux's literal command parser, and false Stop confirmation when a process ignored SIGHUP. Both were fixed with regressions. The reviewer independently verified the 13 then-current storage/service tests, Stop uncertainty across service restart, and launch-argument preservation, and cleared the changes within this foundation scope. The subsequent whole-client-process test also passed in the final complete suite.

## Limits and next integration

- No visible Code tab, renderer capability, live Claude profile switch or app replacement is included. The native entry point is `connectCodeService` in `apps/desktop/electron/code/session-client.cjs`.
- The service accepts trusted native launch requests, not arbitrary web content. It is process lifecycle infrastructure, not a sandbox for untrusted code.
- PID reuse after host restart can conservatively leave an uncertain session blocked; it must never trigger a blind kill. An operator-facing reconciliation flow remains part of the Code UI/adapter integration.
- Terminal capture is a bounded screen/history snapshot. Full interactive terminal streaming and cursor/escape handling need the planned PTY/control-mode attachment.
- The next integration needs the signed Code module, declared shell API, profile/session UI and real Claude protocol handling. SSH, external tmux discovery, other tmux versions, and live account/memory continuity remain separate verification gates.
- The internal service currently retains up to 32 session records; archive/removal and user-facing service lifecycle management belong with the module integration.

See [the first-release design](first-release-design.md) and [implementation plan](../../docs/superpowers/plans/2026-09-15-code-session-service.md).
