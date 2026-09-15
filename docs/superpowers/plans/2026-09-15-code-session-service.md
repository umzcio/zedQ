# Persistent Code Session Service Implementation Plan

> For agentic workers: use superpowers:executing-plans, inline, with test-first implementation.

**Goal:** Keep local terminal sessions alive independently of the desktop client and safely reconnect to them.

**Architecture:** A private tmux server owns terminal sessions and a singleton Node service session. The service exposes authenticated, versioned Unix-socket requests. Its durable catalog and lifecycle journal recover across service replacement; tmux retains the terminal screen and running process. A disconnected client relinquishes its input lease without stopping the terminal.

**Tech stack:** Node built-ins, existing host tmux; no new runtime dependency or Docker. Electron can run the service with `ELECTRON_RUN_AS_NODE=1`.

**Spec:** `plans/code/first-release-design.md`, milestone 2. This local service is not yet the renderer API or the Claude structured adapter. External tmux discovery, SSH and full streaming terminal rendering remain separate integration gates.

**Implementation notes:** Completed in an isolated worktree. Input uses tmux hex-byte transport after review found trailing-semicolon corruption in literal key commands. Stop verifies process disappearance separately from pane disappearance: a surviving PID keeps `stopping` and rejects completion. Saved PIDs are never blindly signalled; PID reuse after restart remains conservative uncertainty. Electron's Node-mode environment flag is scoped to the service session, not agent sessions. No visible Code tab or app replacement is part of this milestone.

## Constraints and decisions

- Tests use isolated temporary HOME/ZDOTDIR and a dedicated tmux socket; never the user's tmux server, CLI profiles, credentials or regular workspace.
- A root owned by the current user with mode 0700 contains the socket, 0600 authentication token, atomic catalog and private tmux socket. Reject symlinks, permissive directories/files, incompatible catalog versions and oversized data.
- A fixed tmux service-session name arbitrates concurrent startup. Only that singleton service removes its stale IPC socket. Do not infer process ownership from a saved PID or steal a live Unix socket.
- Session IDs are UUIDs selected before creation so a lost create response can be retried without spawning duplicate work. Persist `starting` before launching. Recovery inspects existing tmux panes; it never silently respawns a missing session.
- Requests are bounded JSON lines with protocol version 1, authenticated before commands. Limit concurrent connections and queued operations. Return fixed public error codes, never raw command stderr or credentials.
- One connection may hold the input lease for a session. Write, resize and stop require it; observers may read snapshots/events. Disconnect releases it. No automatic takeover.
- Journal lifecycle changes with monotonic sequence numbers and bounded history. Reconnect provides current tmux screen plus lifecycle replay; this is not a lossless terminal byte stream. The eventual renderer needs a separate tmux control/PTY attachment.
- Persist atomic snapshots with fsync, rename and directory fsync. If persistence fails, gate further mutations until service restart/reconciliation. Do not report a failed mutation as successful.

## Files and tasks

### 1. Durable private storage and tmux adapter

Create `apps/desktop/electron/code/service-storage.cjs`, `tmux.cjs`; test in `apps/desktop/tests/code-service-storage.test.cjs` and the service integration suite.

Interfaces: `prepareRoot(root): {root,socket,tmuxSocket,token}`, `readCatalog(paths): Catalog`, `writeCatalog(paths,catalog): void`; `createTmux({binary,socket,env})` returns `run(args): Promise<string>`, `launch(name,launch,cols,rows)`, `inspect(name)`, `capture(name)`, `write(name,data)`, `resize(name,cols,rows)`, `stop(name)`.

- [x] Write storage tests that reject a symlink root/token, permissive files, corrupt/version-mismatched state and preserve the previous file on invalid writes; run to failure.
- [x] Implement exclusive token creation, owner/mode checks, bounded reads, atomic catalog writes and validated session IDs. Tmux calls use `execFile` with a timeout and bounded output. Build a single shell command by quoting every launch argument, never inserting raw arguments; reject NUL and impose lengths.
- [x] Run storage tests and commit.

### 2. Singleton service and native client

Create `apps/desktop/electron/code/session-service.cjs`, `session-client.cjs`.

Interface: `connectCodeService({root,tmuxPath,nodePath=process.execPath,env=process.env})` returns `{request(method,params): Promise<unknown>, close():void}`. Methods: `ping`, `list`, `create({id,launch})`, `claim({id})`, `release({id})`, `snapshot({id})`, `write({id,data})`, `resize({id,cols,rows})`, `stop({id})`, `events({after})`. `launch` is `{file,args,cwd}`; it is not saved in the catalog. List records include ID, cwd, state, pane PID and creation time, never launch arguments or environment.

- [x] Write process tests before implementation: create a synthetic interactive agent, claim input, disconnect, reconnect, verify identical PID/output, and finish with explicit Stop. Assert duplicate creation returns the same ID/PID.
- [x] Implement startup under a named tmux service session. A fixed private configuration disables user tmux configuration. Authenticate protocol version and token before dispatch. Serialize operations and check socket liveness before queued mutations.
- [x] Persist state transitions and bounded journal entries. Inspect pane liveness before exposing state; `starting` can reconcile to running or stopped. `stopping` with a surviving pane remains blocked for input until explicit Stop succeeds. Lost tmux server means stopped, not empty successful output or automatic restart.
- [x] Implement leases, bounded snapshots, strict sizes/input validation, connection/request timeouts and slow-client disconnects. Client close only disconnects IPC. A crash breaks pending requests explicitly.
- [x] Run tests and commit.

### 3. Crash, authorization and replay verification

Create `apps/desktop/tests/code-session-service.test.cjs` plus `fixtures/code/interactive-agent.cjs`; update `plans/code/session-service-validation.md` and `modules/code/README.md`.

- [x] Add tests: competing clients cannot write/resize/stop; rejected authentication/version/oversized input; simultaneous startup uses one service; kill only the service pane and reconnect to the same agent PID; kill the isolated tmux server and verify no automatic agent respawn; lifecycle sequence survives restart; retained events report truncation; shell metacharacters are literal.
- [x] Teardown every test's isolated server and temporary root, including failure paths. Check native launch arguments do not appear in persisted catalog. Test rejected connection closure does not affect a valid owner.
- [x] Run `node --test apps/desktop/tests/code-*.test.cjs`, `npm run typecheck`, and `DEVELOPER_DIR=/Library/Developer/CommandLineTools npm test`. Record actual outcomes and unverified live-Claude/renderer/SSH gates.
- [x] Review crash boundaries and ownership, commit, integrate and restore the normal development checkout. No app replacement for this native-only milestone.

## Representative acceptance assertions

```js
assert.equal(reconnected.pid, first.pid)
assert.match(reconnected.output, /echo:after reconnect/)
await assert.rejects(observer.request('write', {id,data:'bad'}), {code:'LEASE_REQUIRED'})
assert.equal((await restarted.request('snapshot',{id})).pid, first.pid)
assert.equal((await restarted.request('create',{id,launch})).pid, first.pid)
assert.equal((await rebooted.request('snapshot',{id})).state, 'stopped')
assert.ok(replayed.events.every(event => event.seq > cursor))
```

Tmux behavior checked against its [official manual](https://github.com/tmux/tmux/blob/master/tmux.1): separate socket servers, detached sessions and capture/resize/input commands. Local test runtime is tmux 3.7b; other installed versions need compatibility verification.
