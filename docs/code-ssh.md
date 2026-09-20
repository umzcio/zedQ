# SSH terminals

Open **Code → SSH hosts → Choose hosts** to select aliases from the local OpenSSH configuration (including supported Include files). Selection saves the list without connecting. Hiding a host preserves its records and running sessions.

Choose **root · passwordless sudo** or **SSH login user**, then **Open host**. Root uses passwordless `sudo -n -H` with an explicit root login shell and literal argument forwarding; a failed root check never silently falls back to the login user. Legacy host records keep their login-user behavior. Each execution user has its own native home, CLI configuration, tmux server and zQ catalog. zQ does not copy credentials or CLI histories between users.

The chosen user needs Node and tmux. Native terminals use the shell configured by tmux; zsh is not required to connect or attach. Agent profiles that use zsh launchers still require `/bin/zsh`. SSH uses the existing configuration with batch authentication and normal host-key checks. First connection installs the shipped helper beneath that user's private `~/.local/share/zq/code` directory. Discovery lists sessions from that user's default tmux server, equivalent to `tmux ls`; custom tmux sockets are not included.

Attach an existing session or create a named session. New sessions honor tmux's configured shell/default command. The session can stay standalone, or **Link to project** can associate it with a project on the same host and execution user. This changes organization only: it does not move files, change directories, restart the shell, or rewrite native CLI history. A project's **Open project shell** starts a new tmux session in that project's folder.

Projects, SSH hosts and Terminals open the same stored session. **Close view (detach)** releases the view without killing tmux. External/native tmux sessions are never terminated by zQ's stop action. Sessions already controlled elsewhere are rejected rather than forcibly taken over. Disconnecting a host closes zQ's transport and preserves remote processes.

## Updates and verification

Ship this feature with the desktop shell and Code 1.2.0 (`code.ssh-terminals.v1`). The module store can prefer an older installed module over a newer bundle; check the running version in Settings → Modules after restart.

Persistent session services survive app restarts. An older already-running service can reject newly added operations; the UI reports this as an older-helper error. This release deliberately does not kill an existing service to upgrade it while sessions may be active. A fresh service uses the current shipped helper. Automatic coordinated service upgrades remain follow-up work.

Verification uses an isolated production-module browser fixture, fake SSH transports for sudo failures and user selection, and real isolated tmux processes for create/discover/attach/project association/reconnect. No tests connect to the user's SSH hosts or write fixture data to the regular workspace. A real chosen-server connection still needs verification. Agent Kanban task execution remains separate from this SSH release.

Opened sessions appear in the Code sidebar’s **Sessions** list whether or not they belong to a project. Each row shows its host/user and shares the session’s context-menu actions. Switching views detaches the client without removing that navigation entry. The desktop keeps private cached session/project/profile metadata across launches (no terminal output or credentials); cached hosts start disconnected. Opening a cached remote session reconnects its host explicitly and reloads the authoritative session record before attaching. Deleting a host removes its cache.

## Files beside a terminal

Workspace opens a right-hand file tree for both saved projects and standalone SSH terminals. A standalone tree starts at the session’s saved working directory; it does not create a project or follow shell `cd` commands. Expand folders, open small UTF-8 files, and inspect Git changes. File edits retain fingerprint conflict checks.

Right-click a regular file for **Download…**, or a folder for **Upload files…**. The root toolbar also uploads files. Native pickers choose local sources/destinations; multiple-file uploads are supported. Existing destination files require confirmation, and transfers display byte progress. Downloads and uploads use bounded binary chunks over the current SSH bridge under the selected login/root identity. Temporary files are committed only after successful transfer and conflict checks. Symlinks and recursive directory transfers are not supported. Closing the panel leaves the transfer running; reopening it shows its status.

`code.session-files.v1` requires the updated desktop shell. Remote bridges receive the new file support on connection without restarting the persistent tmux session service.

Terminal keyboard, mouse, and resize input uses the attached PTY directly after lease acquisition. Input must not be routed through per-event remote RPC / `tmux send-keys`: that bypasses tmux client mouse handling and adds latency. Attachment generation checks still reject stale input after detach or replacement.
