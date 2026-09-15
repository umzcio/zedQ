# Code Handoff Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Execute inline; delegation is not required.

**Goal:** Build and test the native foundation for switching Claude profiles or interfaces while retaining one conversation and one controller.

**Architecture:** A pure launcher planner and injected handoff coordinator live in the desktop's native service layer. Tests use a fake agent in isolated temporary directories. This is an independently testable internal milestone, not the finished Code UI or a claim of live Claude compatibility.

**Tech Stack:** Existing Node CommonJS native-service conventions, `node:test`, `node:child_process`, host `/bin/zsh`; no new dependencies.

**Spec:** `plans/code/first-release-design.md`. This plan implements milestone 1 only. Milestones 2–5 retain their separate release gates.

## Global Constraints

- Profile switching is explicit, not automatic quota cycling.
- Never copy credentials into zQ project data.
- Never launch both controllers against one native conversation concurrently.
- All mutations and live smoke tests occur in an isolated workspace; the regular workspace is restored afterward.
- Feature UI and controllers live in `modules/code`; renderer access goes through `@zq/module-api`.
- New native services and schema changes ship with a shell update.
- No production renderer/native IPC exposure in this milestone. Do not modify normal workspace state, launch real account inference, install a replacement app, or change the user's launcher file.

## File map

| File | Responsibility |
| --- | --- |
| `apps/desktop/electron/code/claude-launch.cjs` | Validate metadata and construct argv without interpolating shell source |
| `apps/desktop/electron/code/handoff.cjs` | Single-controller transition, revision checks, recovery state |
| `apps/desktop/tests/code-launch.test.cjs` | Launcher/profile isolation and argument preservation |
| `apps/desktop/tests/code-handoff.test.cjs` | Deterministic success/failure/race cases |
| `apps/desktop/tests/code-handoff-process.test.cjs` | Real subprocess exit-before-start and failure cleanup using a fake agent |
| `apps/desktop/tests/fixtures/code/fake-agent.cjs` | Synthetic native identity and controlled exit modes |
| `plans/code/handoff-validation.md` | Recorded evidence, limitations, next integration gate |
| `modules/code/README.md` | Link the design and distinguish internal foundation from shipped UI |

## Shared data contract

Use these exact shapes as JSDoc typedefs in the two native files; they are internal, not yet a published module API.

```ts
type Mode = 'chat' | 'terminal';
type Profile = {
  id: string; hostId: string; launcherFile: string; functionName: string;
  modes: Mode[];
};
type Session = {
  id: string; hostId: string; cwd: string; nativeId: string;
  profileId: string; mode: Mode; revision: number;
  state: 'ready' | 'switching' | 'recoverable';
  recovery?: {targetProfileId: string; targetMode: Mode; code: string};
};
type Target = {profile: Profile; mode: Mode};
type Launch = {file: '/bin/zsh'; args: string[]; cwd: string};
type Handle = {id: string}; // opaque process-adapter handle, not a PID
type Ready = {nativeId: string};
```

The initial foundation accepts already known native IDs. New-session creation and discovery of IDs in external terminal sessions belong to the Claude adapter milestone, not guessed filename selection in this code.

### Task 1: Preserve the selected launcher and exact resume identity

**Files:** Create `apps/desktop/electron/code/claude-launch.cjs`; create `apps/desktop/tests/code-launch.test.cjs`.

**Interfaces:**
- Consumes `Profile`, `Session`, `Mode` above.
- Produces `buildClaudeResume({profile, session, mode}): Launch`.
- Throws an Error with `code` equal to `INVALID_PROFILE`, `INVALID_SESSION`, `HOST_MISMATCH`, or `MODE_UNSUPPORTED`; errors contain no launcher contents or environment values.

- [ ] **Write failing launch tests**, including this exact representative case. Add cases rejecting nonabsolute launcher/cwd, mismatched hosts, non-UUID native ID, unknown modes and function names with shell operators.

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const {buildClaudeResume} = require('../electron/code/claude-launch.cjs');
const nativeId = '4dab1c34-d7d7-4e77-8a6c-42d1bb5b8c59';
const session = {id:'s1', hostId:'local', cwd:'/tmp/code workspace', nativeId,
  profileId:'a', mode:'terminal', revision:0, state:'ready'};
const profile = {id:'b', hostId:'local', launcherFile:'/tmp/profiles $(touch BAD).zsh',
  functionName:'claude-team', modes:['chat','terminal']};
test('resumes exact identity through the target launcher', () => {
  const launch = buildClaudeResume({profile, session, mode:'terminal'});
  assert.equal(launch.file, '/bin/zsh');
  assert.equal(launch.cwd, session.cwd);
  assert.deepEqual(launch.args.slice(3), [profile.launcherFile,
    'claude-team', '--resume', nativeId]);
  assert.ok(!launch.args[1].includes(profile.launcherFile));
  assert.ok(!launch.args.includes('--continue'));
  assert.ok(!launch.args.includes('--fork-session'));
  assert.ok(!launch.args.includes('--bare'));
});
```

- [ ] **Run** `node --test apps/desktop/tests/code-launch.test.cjs`; expect missing-module failure before implementation.
- [ ] **Implement** metadata validation and fixed program construction. Accept function names matching `/^[A-Za-z_][A-Za-z0-9_-]*$/`; reject NUL in all strings. Require nonempty IDs, absolute cwd/launcher path and a canonical UUID native ID. Require mode to be `chat` or `terminal` and included in `profile.modes`. This is a local-host launch description; it does not serialize an SSH command.

```js
// After validation; no eval and no interpolation into PROGRAM.
const PROGRAM = 'source "$1" || exit $?; shift; "$@"';
const cliArgs = ['--resume', session.nativeId];
if (mode === 'chat') cliArgs.push('-p', '--input-format', 'stream-json',
  '--output-format', 'stream-json', '--verbose', '--include-partial-messages');
return {file:'/bin/zsh',
  args:['-c', PROGRAM, 'zq-code', profile.launcherFile,
    profile.functionName, ...cliArgs], cwd:session.cwd};
```

No environment object is returned or persisted. The process adapter supplies its host environment per child. The selected launcher file owns its existing account/provider configuration; source it explicitly rather than sourcing every interactive startup script. A launcher that depends on interactive state fails compatibility checks; do not rewrite it automatically. Preserve native permission defaults; do not append bypass flags. Chat flags are only a launch shape, not proof of a complete interactive protocol implementation.

- [ ] **Run the launch tests** and require all cases pass. Add a chat assertion for the exact stream flags and unchanged native ID.
- [ ] **Commit** the two files: `feat(code): preserve profile launchers and explicit resume identity`.

### Task 2: Coordinate exclusive, recoverable handoffs

**Files:** Create `apps/desktop/electron/code/handoff.cjs`; create `apps/desktop/tests/code-handoff.test.cjs`.

**Interfaces:**
- Produces `createHandoffCoordinator(ports)` returning `{switchController(request): Promise<Session>}`.
- Request: `{sessionId: string, expectedRevision: number, target: Target}`.
- Consumes the following injected ports. The process adapter owns process-group cleanup and protocol acknowledgement. `start` returns a handle even when readiness will fail so cleanup is possible.

```ts
interface Ports {
  load(sessionId: string): Promise<Session>;
  save(session: Session): Promise<void>;
  preflight(session: Session, target: Target): Promise<void>;
  stopSource(session: Session): Promise<void>; // resolves only after confirmed exit
  start(session: Session, target: Target): Promise<Handle>;
  ready(handle: Handle): Promise<Ready>;
  stopTarget(handle: Handle): Promise<void>; // resolves only after confirmed exit
}
```

The coordinator's in-memory lock is sufficient only inside one host process. The persistent-host milestone must provide exclusive host ownership and crash reconciliation before exposing it to clients.

- [ ] **Write failing tests** using this basic harness. Add deferred promises to hold preflight/stop/readiness for race tests; never rely on sleep ordering.

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const {createHandoffCoordinator} = require('../electron/code/handoff.cjs');
function harness(overrides = {}) {
  let row = {id:'s1', hostId:'local', cwd:'/tmp/work',
    nativeId:'4dab1c34-d7d7-4e77-8a6c-42d1bb5b8c59',
    profileId:'a', mode:'terminal', revision:0, state:'ready'};
  const events = [];
  const ports = {
    load:async () => structuredClone(row),
    save:async value => {row = structuredClone(value); events.push(value.state)},
    preflight:async () => {events.push('preflight')},
    stopSource:async () => {events.push('stop')},
    start:async () => {events.push('start'); return {id:'target'}},
    ready:async () => ({nativeId:row.nativeId}),
    stopTarget:async () => {events.push('cleanup')}, ...overrides,
  };
  return {coordinator:createHandoffCoordinator(ports), events, row:() => row};
}
const target = {profile:{id:'b', hostId:'local', launcherFile:'/tmp/profiles.zsh',
  functionName:'claude-team', modes:['terminal']}, mode:'terminal'};
test('changes profile only after source exit and native identity acknowledgement', async () => {
  const h = harness();
  const next = await h.coordinator.switchController({sessionId:'s1', expectedRevision:0, target});
  assert.deepEqual(h.events, ['preflight','switching','stop','start','ready']);
  assert.equal(next.profileId, 'b');
  assert.equal(next.revision, 2);
  assert.equal(next.nativeId, '4dab1c34-d7d7-4e77-8a6c-42d1bb5b8c59');
  assert.equal(next.cwd, '/tmp/work');
});
```

- [ ] **Run** `node --test apps/desktop/tests/code-handoff.test.cjs`; expect missing-module failure.
- [ ] **Implement the coordinator** with a per-session Set lock acquired synchronously before the first await and removed in `finally`. Validate expected revision, target host and mode, and require an existing native ID. Reject `switching` records on entry with `RECONCILIATION_REQUIRED`. Preflight precedes any save or stop. Persist `switching` at revision +1; persist final success or recoverable failure at revision +2. Preserve all immutable fields from the loaded record.

```js
const switching = {...session, state:'switching', revision:session.revision + 1};
await ports.save(switching);
await ports.stopSource(session);
handle = await ports.start(session, target);
const acknowledgement = await ports.ready(handle);
if (acknowledgement.nativeId !== session.nativeId)
  throw Object.assign(new Error('Resume identity did not match'), {code:'IDENTITY_MISMATCH'});
const next = {...switching, state:'ready', revision:session.revision + 2,
  profileId:target.profile.id, mode:target.mode};
delete next.recovery;
await ports.save(next);
return next;
```

Wrap the stop/start/ready/final-save block in error handling: stop any created target before returning a recoverable state, retain the old profile/mode, and record only a bounded public failure code. If target cleanup cannot confirm exit, preserve state `switching` with `PROCESS_OWNERSHIP_UNKNOWN`; input remains gated. If saving recovery fails, reject `PERSISTENCE_FAILED` and require reconciliation. Do not claim rollback restored a process. A `recoverable` record can retry using its current revision; `stopSource` must idempotently confirm the previous source is absent. Preflight failure must leave revision/state/source unchanged. A failed initial switching save must not stop the source.

- [ ] **Add assertions for every failure contract**: preflight fails without stop; revision mismatch and simultaneous switch rejected; stop failure never starts target; readiness failure cleans target; identity mismatch cleans target; cleanup failure remains gated; final save failure cleans target; initial save failure leaves source untouched; retry preserves native ID; two different session IDs can transition independently. Assert neither inputs nor earlier tool actions are dispatched by this coordinator.
- [ ] **Run** `node --test apps/desktop/tests/code-launch.test.cjs apps/desktop/tests/code-handoff.test.cjs`; require all pass.
- [ ] **Commit** the coordinator/tests: `feat(code): coordinate exclusive recoverable profile handoffs`.

### Task 3: Prove process ordering and launcher isolation

**Files:** Create `apps/desktop/tests/fixtures/code/fake-agent.cjs`, `apps/desktop/tests/code-handoff-process.test.cjs`, `plans/code/handoff-validation.md`; modify `modules/code/README.md`.

**Interfaces:** Consumes `buildClaudeResume` and `createHandoffCoordinator` exactly as above. Test-only adapters implement `Ports`. No production service or IPC is added.

- [ ] **Create the fake agent**. It receives normal Claude argv but records only synthetic fixtures. The environment paths are temporary test paths. Its exclusive lock demonstrates whether the source really exited before a target started.

```js
const fs = require('node:fs');
const args = process.argv.slice(2);
const lock = fs.openSync(process.env.ZQ_TEST_LOCK, 'wx');
const nativeId = args[args.indexOf('--resume') + 1];
process.stdout.write(JSON.stringify({nativeId, profile:process.env.ZQ_TEST_PROFILE,
  cwd:process.cwd(), args}) + '\n');
const timer = setInterval(() => {}, 1000);
process.on('SIGTERM', () => {
  clearInterval(timer); fs.closeSync(lock); fs.unlinkSync(process.env.ZQ_TEST_LOCK);
  process.exit(0);
});
```

- [ ] **Write failing process tests** creating an `fs.mkdtemp` workspace and a launcher file with shell-sensitive characters in its filename. Define two synthetic functions in that file. Use the current Node executable and fixture path as positional arguments with proper shell quoting when generating the fixture, not interpolated production shell commands. Functions forward `"$@"` and set distinct synthetic `ZQ_TEST_PROFILE` values. Launch with `spawn(launch.file, launch.args, {cwd:launch.cwd, env:testEnv, detached:true})`; clean process groups in test teardown with bounded waits.

Assertions must include:

```js
assert.equal(after.nativeId, before.nativeId);
assert.equal(after.cwd, before.cwd);
assert.equal(before.profile, 'a');
assert.equal(after.profile, 'b');
assert.equal(fs.readFileSync(workFile, 'utf8'), 'keep this edit');
assert.equal(fs.existsSync(unwantedCommandOutput), false);
assert.equal(process.env.ZQ_TEST_PROFILE, undefined);
```

`before` and `after` are parsed complete stdout JSON lines from the fake agent. Resolve `ready(handle)` only after parsing a full line; bound line size and readiness to 5 seconds in this test adapter. `stopSource`/`stopTarget` signal the process group and await the child's exit event, with forced cleanup on timeout. Reuse the exclusive lock path for source/target so overlap is an observable failed start. Assert spaces, quotes, dollar signs, and newlines survive argv without execution. Run two isolated sessions concurrently with different lock paths and ensure no environment cross-talk.

- [ ] **Run** `node --test apps/desktop/tests/code-handoff-process.test.cjs`; before wiring the test adapter, expect failure to obtain the target acknowledgement. Fix test adapter lifecycle handling, not production semantics, when the fake fails to exit.
- [ ] **Complete integration scenarios** for target startup failure and mismatched identity. Assert cleanup removes the test lock, no child remains, old session identity/profile is retained, and a subsequent retry can succeed. Keep synthetic configuration/history marker files unchanged. These markers test non-mutation, not real Claude memory equivalence.
- [ ] **Run focused verification**:

```sh
node --test apps/desktop/tests/code-launch.test.cjs apps/desktop/tests/code-handoff.test.cjs apps/desktop/tests/code-handoff-process.test.cjs
npm run typecheck
/opt/homebrew/bin/git diff --check
```

Require zero failed focused tests and no diff whitespace errors. Typecheck failures must be investigated and reported with baseline evidence; do not silently label them unrelated. No package install or app replacement is required for this internal milestone.

- [ ] **Write `plans/code/handoff-validation.md`** with command outcomes, fake-agent cases, detected runtime versions, unchanged normal-workspace statement backed by the test isolation paths, and explicit unverified gates: real Claude authentication/provider preservation, Chat permissions/protocol, native memory/config continuity, persistent host restart, tmux, SSH. Link this evidence and the design from `modules/code/README.md`, retaining “Not implemented or shipped” for its UI.
- [ ] **Commit** the fixture, integration tests, evidence, and README: `test(code): verify process handoff and profile isolation`.

## Review before moving to the persistent host

Check that no saved/logged value contains launcher contents, tokens, native private history, or environment snapshots. Confirm no `--continue` heuristic, transcript copy, new conversation fallback, permission bypass, or process-global profile environment mutation was introduced. Inspect every failure path for surviving target processes and misleading `ready` states. The next plan must extend ownership across host crashes before the coordinator is exposed through a shell capability.
