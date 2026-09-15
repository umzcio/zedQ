# Code

The signed Code module provides coding sessions beside the existing zQ modules. Native process control, SSH, filesystem access and persistence remain in the desktop host. The module consumes only `@zq/module-api` and shared UI components.

- Projects group persistent sessions by folder and execution host.
- Claude profiles use existing host-local shell functions and native conversation history. Explicit profile and Chat/Terminal handoffs resume the exact native conversation after confirming the previous controller stopped.
- Other CLI launchers use Terminal only. External tmux attachment never takes ownership of the external process.
- Files supports bounded text editing with conflict detection. Changes shows staged, unstaged and untracked diffs. Preview embeds localhost development servers and forwards remote ports through SSH.
- Closing zQ detaches from owned sessions. Stop is an explicit action; archiving preserves the process, checkout and native history.

Local prerequisites: tmux and the selected coding CLI. SSH hosts additionally need Node and zsh, working SSH keys/agent and a trusted host key. Connect explicitly installs the shipped session helper in the remote user's private zQ directory. No credentials are copied into zQ.

[Product contract](../../plans/code/first-release-design.md) · [Native service](../../apps/desktop/electron/code/README.md) · [Interface validation](../../plans/code/interface-validation.md)
