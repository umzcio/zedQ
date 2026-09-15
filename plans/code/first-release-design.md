# Code: sessions, interfaces, and Claude profiles

Date: 2026-09-15. Implemented first-release contract; see [interface validation](interface-validation.md) for current evidence and limits.

## Product contract

A Code session owns a workspace and conversation. Its active Claude profile and interface can change without replacing that session. The central acceptance case is: work under one profile, hit a usage limit, choose **Switch profile and continue**, and pick up the same work under another profile.

Use the installed coding CLI and its account arrangement. Preserve existing shared memory, settings, MCP configuration, and conversation storage. Do not create isolated Claude homes just because profiles have different names. Never copy credentials into zQ project data. Profile switching is explicit, not automatic quota cycling.

Claude is the first structured adapter. Other installed coding CLIs, including local-model harnesses, can use Terminal; structured mode requires a tested adapter. This does not change the preference for local models elsewhere in zQ.

## Workspace

The Code sidebar groups sessions under projects. A project records its execution host and checkout path; a session shows its title, agent/profile, and current state. The main area has **Chat** and **Terminal**, with Files, Changes, and Preview available alongside it. Do not expose nonfunctional tabs while building these surfaces.

Chat presents native agent messages, tool activity, permission requests, and questions. Terminal presents the real interactive CLI. Switching is a controlled handoff, not a second agent interpreting an ANSI transcript. Unverified adapters expose Terminal and a short explanation of why Chat is unavailable.

Keep the active profile visible in both modes. A usage-limit event offers **Switch profile and continue**. Connection loss, agent failure, and usage exhaustion have distinct states and recovery actions next to the latest activity. Terminal text alone is not proof of agent state; label inferred or unknown status accordingly.

Context actions:

| Item | Actions |
| --- | --- |
| Project | Rename, Settings, Edit icon, Delete project record |
| Session | Rename, Switch profile and continue, Switch interface, Copy workspace path, Archive; Stop when running |
| Profile | Rename, Edit launcher, Duplicate, Remove from zQ |
| Terminal | Copy selection, Paste, Find, Clear visible buffer, Detach |
| File | Open, Copy relative path, Reveal on local host; later mutations must be explicit |
| Changed file | Open diff, Open file, Copy relative path |
| Preview | Reload, Copy URL, Open in browser, Stop forwarding when applicable |

Archive/delete/remove never silently kill external processes or delete checkouts, credentials, or native conversation history. Disable unavailable actions with useful explanations. Use shared Radix/shadcn menus and preserve focus, keyboard access, compact neutral surfaces, and the shell's sidebar conventions.

## Ownership and boundaries

Use a zQ-owned host service with a narrow adapter interface; Agent Orchestrator is a behavior reference rather than a required installed application. The service owns process control, durable session metadata, private local IPC, reconnect, and controller transitions. Feature UI and controllers live in `modules/code`; renderer access goes through `@zq/module-api`. New native services and schema changes ship with a shell update.

The current `TerminalSessions` proof is app-owned and does not prove survival after app quit. A separate session host must be verified before persistence is advertised. Native terminal sessions use tmux on supported execution hosts; retain discovery/attachment of external tmux sessions. Structured Claude sessions need a persistent protocol host. Never launch both controllers against one native conversation concurrently.

Local IPC belongs in a user-private directory, authenticates the connecting shell, uses bounded framed messages, and rejects stale or incompatible protocol versions. Persist event sequence numbers so reconnect can replay without duplicating activity. App quit detaches; explicit Stop terminates only the owned session. Host reboot is a stopped session requiring resume, not a surviving process.

Remote work uses system OpenSSH and the user's existing host configuration, keys, agent, and jump hosts. Credentials and launcher paths remain on the execution host. Do not impose Docker or a new cloud service. Local mode is the first integration checkpoint; SSH, existing tmux attachment, reconnect, files/diffs, and preview forwarding remain release requirements from the existing product spec.

## Profiles and native identity

Observed launchers: `claude-cio`, `claude-team`, `claude-api`, `claude-gmail`, `claude-azure`, `claude-chatmt`. Their definitions mix config directories, MCP options, and provider/model settings. Preserve these as user-selected host-local launchers, not guessed authentication aliases. Configuration directories do not establish whether history is shared; the user confirms the existing sharing arrangement.

Store profile ID, display name, host ID, launcher file and function, plus compatibility results. Do not store shell function contents or environment secrets in session events. Source the selected launcher file and invoke the selected function with positional arguments in a fixed shell program; do not interpolate user paths or arguments into shell code. Profiles may execute trusted user configuration, so adding a launcher is an explicit configuration action.

Track an exact native conversation ID independently of zQ's session UUID. Claude documents different interactive versus print-mode history selection for `--continue`; explicit `--resume <id>` avoids selecting another conversation. Do not use `--fork-session`, disable session persistence, or add `--bare`, which would change the intended continuity/configuration behavior. See the [Claude CLI reference](https://code.claude.com/docs/en/cli-reference).

First launches capture/establish the native ID through the adapter. External sessions need a verified native ID before offering structured handoff. An unknown ID permits terminal attachment but cannot silently become a new Chat conversation. Do not copy native transcripts between profile directories to manufacture compatibility.

## Handoff transaction

1. Lock the session's controller transition and gate new input. Reject competing transitions using the expected session revision.
2. Preflight target host, launcher, supported mode, and ability to access the exact native conversation. Failure here leaves the existing controller running.
3. Let the current turn finish or explicitly interrupt it. Never silently approve pending permission requests or replay the interrupted prompt.
4. Stop the source controller and confirm process exit. If exit is uncertain, do not start a target.
5. Start the target launcher with the same cwd and exact resume ID. Require adapter acknowledgement of the expected native identity before marking the target active.
6. Persist the new active profile/mode and a profile-change event. Release input ownership only after this succeeds.

On target authentication/resume failure, retain the original session, history, workspace, and last successful profile. Offer Retry target or Resume previous profile. Do not silently fall back to a blank conversation or replay prior tools. On host crash during transition, reconcile process ownership before either recovery action becomes available. Native provider history and zQ display history remain distinct; zQ events retain the profile that produced them.

## Implementation sequence and gates

1. **Handoff foundation:** deterministic launch construction, isolated fake CLI, session transition state machine, exact-identity checks, failure recovery. Detailed executable plan: `docs/superpowers/plans/2026-09-15-code-handoff-foundation.md`.
2. **Persistent local host:** process lifecycle, private IPC, event replay, tmux terminal attach/resize/input ownership. Prove app quit/reopen leaves the same process, and host failure is reported honestly.
3. **Claude interface adapter:** native structured protocol, permission/question handling, captured IDs, real profile and Chat/Terminal round trips. Use isolated workspaces and simulated limits; do not exhaust an account to test.
4. **Code module:** signed module manifest, host capabilities, persistent Root/ModuleSurface, project/session/profile management and context menus, terminal rendering and structured Chat. Update all four-module assumptions in shell loader/build validation; verify bundled fallbacks and the target shell API.
5. **Workspace and remote release gate:** files/editing with conflict checks, diffs, preview/port ownership, SSH discovery, external tmux attach, reconnect from another supported client. Validate host-specific launchers rather than assuming the Mac's functions exist remotely.

Each milestone gets its own implementation plan after the preceding interfaces are verified. The first foundation plan intentionally builds no placeholder UI. Multiagent task orchestration, automatic profile cycling, and a full IDE are outside this release.

## Acceptance evidence required

- Profile A to B and back retains native ID, cwd/worktree, session ID, existing edits, and shared configuration; history attribution changes only for new events.
- Two conversations in one directory cannot cross-resume. Two sessions with different profiles do not mutate global environment.
- Chat to Terminal to Chat retains the native conversation; unsupported profile/mode combinations are explicit.
- Stop failure cannot create a second controller. Target login failure leaves a recoverable session. Unknown process ownership cannot accept input.
- Pending approvals and queued prompts are not automatically approved or replayed across a handoff.
- App quit/reopen preserves the owned process; host restart surfaces stopped/recoverable state. External tmux detach does not kill it.
- All mutations and live smoke tests occur in an isolated workspace; the regular workspace is restored afterward.

Local preflight found Claude Code 2.1.272 and tmux installed. This establishes availability only; no live cross-profile or interface handoff has been verified yet.

## References

- Existing scope: `docs/zq-product-spec-v0.1.md`, section 8; boundaries: `docs/modules.md`.
- [Agent Orchestrator architecture](https://github.com/Untrivial-ai/agent-orchestrator/blob/main/docs/architecture.md): useful precedent for preserving session/workspace/native identity while replacing the active controller, with provider-specific compatibility gates.
