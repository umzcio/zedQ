# Code module — discovery notes

Status: discovery record. Consolidated direction and implementation sequence now live in [first-release-design.md](first-release-design.md); the first executable milestone is [the handoff foundation plan](../../docs/superpowers/plans/2026-09-15-code-handoff-foundation.md).

## Confirmed direction

- Use Agent Orchestrator as an interaction reference: structured Chat and native Terminal interfaces associated with a coding session.
- Multiple Claude launch profiles and continuation across profiles are required from the first release, matching the user's existing shell setup. When a profile reaches its usage limit, the user exits it and launches another with `--continue` to resume the same work.
- Preserve the existing product requirements in `docs/zq-product-spec-v0.1.md`: real installed CLIs and their account arrangements, local/SSH projects, externally created tmux sessions, persistent reconnect, files/diffs/previews. Runtime selection remains open.

## Observed profile setup

The user's shell sources a multi-account launcher file from the dotfiles repository. It defines `claude-cio`, `claude-team`, `claude-api`, `claude-gmail`, `claude-azure`, and `claude-chatmt`. Several use distinct `CLAUDE_CONFIG_DIR` values and MCP configuration; others set provider/model environment. This is more than choosing between two authentication accounts. The user confirms these profiles share Claude memory/configuration and the conversation history needed for their existing cross-profile `--continue` workflow. Distinct launch configuration directories must not be treated as proof of isolated history/configuration. Preserve the existing sharing arrangement. No credential values belong in this design or in synchronized profile metadata.

## Proposed profile behavior

- Treat agent and profile as separate selections: Agent = Claude Code; Profile = a named launcher/account configuration.
- Keep zQ session identity independent of the active profile. Show the active profile in both Chat and Terminal; preserve it on ordinary reconnect/interface switches, and allow the user to explicitly switch profiles within the same session.
- Provide **Switch profile and continue** in the profile selector and the session context menu. Stop/exit the current agent cleanly, select the target launcher, and resume the existing native conversation in the same host/path/worktree. Preserve the zQ task, transcript, files, branch, diffs, and shared Claude memory/configuration. A profile switch must not create a new task or blank conversation.
- Support the user's established `--continue` workflow. With multiple conversations in one directory, verify which native conversation will resume and use a supported explicit conversation identifier where necessary; never silently attach the wrong history. Verify each adapter's resume mechanism before promising Chat-mode parity.
- Only one agent controller may own input for a session during a handoff. If exit, authentication, or resume fails, retain the session and show a recoverable error. Do not silently start a fresh conversation or rerun earlier actions.
- Record profile changes as session events so prior activity retains its original profile attribution while the current label reflects the new profile. A usage-limit state should offer profile switching; switching remains user-initiated unless automatic behavior is separately requested.
- Allow concurrent sessions using different profiles without changing a shared global environment or overwriting account configuration.
- Reuse the user's approved launcher configuration on its execution host. Do not blindly translate arbitrary shell functions into environment settings or assume GUI apps inherit an interactive shell environment.
- Structured Chat must demonstrably preserve the selected profile's configuration, provider endpoint, MCP setup, and native conversation identity. An adapter that cannot establish this should expose Terminal only for that profile until supported.
- Host-specific launcher/configuration paths stay host-specific; credentials remain with the native CLI/account store. Do not copy credentials into the project or sync them between machines.
- Profile management uses shared menus/dialogs with Rename, Edit configuration, Duplicate, and Remove from zQ context actions. Removal does not delete native CLI credentials or configuration. Historical activity keeps its profile attribution and sessions explain when their active launcher is unavailable.

## Initial workspace proposal (not yet selected)

Project/session sidebar; main Chat/Terminal interface; adjacent Files/Changes/Preview surfaces; visible agent, profile, host, branch, and activity. Start by proving a single-agent task through reconnect and review, while allowing multiple independently owned sessions.

## Required profile-handoff acceptance case

Start a coding task with one existing Claude profile, make progress, reach a usage limit or explicitly stop, then select another profile and continue. Confirm the same native conversation, cwd/worktree, files, shared configuration and memory, zQ session/task, and transcript are retained. Confirm the active profile label changes and no competing agent process remains. Repeat with multiple conversations in the same directory and with a failed target-profile login/resume to verify recovery without selecting unrelated history or duplicating work. Test in an isolated workspace; do not consume real account quotas to simulate the limit.

## Discovery questions resolved in the first-release design

- Claude is the first structured adapter; installed local-model CLIs retain the Terminal path, with structured compatibility verified separately.
- Use a zQ-owned host service; Agent Orchestrator supplies an interaction/architecture reference rather than an installed dependency.
- First automated tests use synthetic profiles and isolated local workspaces. Real host/profile combinations require explicit compatibility evidence before being offered as supported Chat handoffs.

Reference: https://github.com/Untrivial-ai/agent-orchestrator/blob/main/docs/architecture.md — interface switching replaces the controller while retaining native conversation/session/workspace identity only for verified compatible adapters. A chat transcript overlay is not assumed to support arbitrary CLI handoff.
