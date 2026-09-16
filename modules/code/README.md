# Code

The signed Code module provides coding sessions beside the existing zQ modules. Native process control, SSH, filesystem access and persistence remain in the desktop host. The module consumes only `@zq/module-api` and shared UI components.

- Projects group persistent sessions by folder and execution host.
- Claude profiles use existing host-local shell functions and native conversation history. Explicit profile and Chat/Terminal handoffs resume the exact native conversation after confirming the previous controller stopped.
- Plain `claude` is included alongside named account profiles. It uses the normal shell command and native default account/configuration without an account-specific override. Existing catalogs gain this entry once; later deletion or renaming is preserved.
- Other CLI launchers use Terminal only. External tmux attachment never takes ownership of the external process.
- Files supports bounded text editing with conflict detection. Changes shows staged, unstaged and untracked diffs. Preview embeds localhost development servers and forwards remote ports through SSH.
- Closing zQ detaches from owned sessions. Stop is an explicit action; archiving preserves the process, checkout and native history.

Local prerequisites: tmux and the selected coding CLI. SSH hosts additionally need Node and zsh, working SSH keys/agent and a trusted host key. Connect explicitly installs the shipped session helper in the remote user's private zQ directory. No credentials are copied into zQ.

[Product contract](../../plans/code/first-release-design.md) · [Native service](../../apps/desktop/electron/code/README.md) · [Interface validation](../../plans/code/interface-validation.md)

## Repository and model controls (1.1)

Selecting a project immediately reads its local branch, upstream counts, working changes, and paginated commit history. Workspace → Git exposes the same view during a session. Commit menus provide detail and copying, with GitHub links when the remote is hosted there. Fetch is explicit, uses the host's existing Git authentication, and updates remote tracking refs without merging or changing the working tree. GitHub PRs/issues are not imported by this view.

New sessions and the session toolbar expose model selection separately from the account profile. Profile default preserves launcher configuration; Sonnet, Opus, Haiku and explicit model IDs pass through Claude's `--model` argument in Chat and Terminal. Chat shows the actual model when the CLI reports it. Changing models uses the existing exact-conversation handoff, and failed handoffs retain the previous selection. See [Claude model configuration](https://code.claude.com/docs/en/model-config).

Empty sessions can switch interface before Claude has saved a transcript: after the old controller exits, the replacement uses the same session ID with a fresh launch only when no conversation exists. Existing transcripts continue through `--resume`. Concurrent background reads are coalesced so slow starts do not exhaust the IPC request limit. This release adds native host operations and requires the matching shell; its capability declaration prevents independent installation on older shells.

Claude's native folder-trust prompt can appear when an existing Chat first opens Terminal. The handoff now recognizes that gate, cleans up the unverified target, and explains how to open the setup terminal. Folder trust is answered in Claude's native interface; zQ never confirms it on the user's behalf. The original conversation stays recoverable.
