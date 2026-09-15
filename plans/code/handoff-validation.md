# Code handoff foundation — validation

Date: 2026-09-15. Internal native foundation only; no renderer capability or Code UI shipped.

## Implemented

- Host-local Claude launch descriptions retain the selected launcher, workspace and exact native resume ID; argument values are never interpolated into shell source.
- The coordinator gates overlapping transitions, validates revisions and identities, confirms source exit through its adapter before starting a target, and commits the active profile only after readiness acknowledges the correct conversation.
- Failed readiness/identity checks stop the target before saving recovery. Uncertain source exit, startup without a cleanup handle, or failed cleanup requires reconciliation. Failed persistence cannot reopen input by returning a stale ready record.
- Target metadata is captured before asynchronous work, and each adapter receives copies of the original session/target. Errors saved to session state use fixed public codes rather than raw process output.

## Evidence

Development used `feat/code-handoff` in `.local-data/worktrees/code-handoff`. Process tests create `zq-code-handoff-*` temporary directories, override HOME/ZDOTDIR for their child shells, source generated synthetic launcher files, and remove the directories and processes in teardown. No real Claude process, credential store, existing launcher file, normal workspace data, or app installation was mutated by this milestone.

Runtime: Node v26.5.0. Existing Claude 2.1.272/tmux availability was recorded during design discovery; these were not used for inference or live handoff tests.

| Check | Result |
| --- | --- |
| Baseline typecheck and existing runtime tests | Passed; 16 runtime tests |
| New launch tests | 13 passed |
| New coordinator tests | 20 passed |
| New subprocess integration tests | 4 passed |
| Combined new + existing runtime tests | 53 passed, zero failures |
| `npm run typecheck` | Passed |
| `git diff --check` | Passed |
| `DEVELOPER_DIR=/Library/Developer/CommandLineTools npm test` | 837 passed, 53 skipped, zero failures; 890 total |

The initial full suite without `DEVELOPER_DIR` had three native-helper-runner failures: `/usr/bin/python3` exited 69 with the machine's Xcode license prompt. The same three tests passed using the installed Command Line Tools, followed by a successful complete suite with that environment override. No license acceptance or source workaround was performed. Skipped tests remain unverified by this run.

Tests first failed before the implementation/fixture existed. The subprocess tests enforce a shared exclusive lock to detect two agents running together. They exercise A→B→A, terminal/chat launch flags, literal paths containing shell metacharacters and newlines, unchanged synthetic edit/configuration files, mismatched native identity, startup failure, cleanup and successful retry, and concurrent independent profiles. Synthetic configuration markers prove non-mutation, not real Claude memory compatibility.

## Remaining release gates

1. A persistent session host with exclusive ownership across process crashes, private IPC, durable event replay and reconciliation. The current coordinator's lock is within one instance; the host must own that instance and serialize external callers.
2. A real Claude adapter that captures native IDs, preserves provider/authentication/configuration behavior and handles questions/permissions. A cleanup handle must be registered before readiness can fail. Adapter waits require deadlines and process-group exit verification.
3. Isolated live cross-profile and Chat↔Terminal continuity tests, including shared native memory/history. No automatic transcript copying or blank-session fallback.
4. tmux persistence, SSH/external-session discovery, remote launcher validation, and app quit/reopen tests.
5. The signed Code module and its declared host API, UI/context menus, files/diffs/previews, and shell integration.

See [the first-release design](first-release-design.md) for the full product contract.
