# Code interface validation — 2026-09-15

All interactive mutations used an isolated zQ data directory and a temporary Git project. No test projects or sessions were added to the regular workspace.

## Verified behavior

- Signed Code module loads in the Electron shell with projects, profiles, sessions, context menus and keyboard-accessible shared controls.
- Real Claude conversations retain their exact native ID across profile handoff, application/service restart and Chat → Terminal → Chat. A token supplied before switching was recalled afterward. Restart retained the running controller process.
- Real CIO → Team profile initialization resumed the same conversation using verified native identity receipts. Prompt execution on CIO exposed an expired account login; the app surfaces the error instead of claiming success.
- Explicit profile setup opens the native CLI without injected conversation flags. The isolated project trust prompt was accepted in its terminal, setup stopped, and the original conversation resumed successfully. Setup and normal controllers cannot overlap in one project.
- File editing saves existing bounded text files with fingerprint conflict protection. Git Changes displays the edited fixture. A localhost preview rendered inside the app.
- Ownership, restart recovery, stale attachment tokens, exact identity, process exit, permissions and UTF-8 transport have regression coverage. Final independent review found no remaining blockers.

## Verification scope and limits

The complete desktop suite passed with 890 tests passing and 52 explicitly skipped on the final integrated feature tree. The same full suite passed again on main after integration. The production build and ARM64 app package succeeded. Packaged-app checks verified all five signed bundled modules, no packaged private signing key, native PTY execution/detach/replay/stop, Code navigation, discovery of the six local profiles, and a real owned terminal session rendering in xterm. The single-Code module build also passed against shell API 1.

SSH bootstrap, transport, persistence and filesystem behavior were exercised through an isolated transport fixture. A real remote host, its authentication and live SSH port forwarding were not available for end-to-end verification. Local prerequisites are tmux and the selected CLI; remote hosts also require Node, zsh and configured SSH trust/authentication.

The file editor supports existing text files up to 24 KB; it is not a full IDE. Generic CLI profiles are terminal-only. Native account authentication remains with each CLI; expired profiles require the explicit setup terminal. No credentials are copied between profiles.

## Repository, models and startup recovery follow-up

The updated suite passed with 901 tests passing and 52 explicitly skipped, using the Command Line Tools developer directory. The single-module build and ARM64 package passed. Packaged UI checks in a separate data directory exercised commit pagination/details/context menus, local-remote Fetch, model selection, empty Chat → Terminal → Chat handoffs, and dark mode. The existing signed Keychain helper retained its exact designated identity.

Read-only checks in the regular workspace confirmed branch, remotes and commit history for both existing projects. Recovery of the user's original empty FCS Edge conversation identified Claude's previously hidden folder-trust prompt. A native profile setup terminal was opened for the user to answer; the original conversation remains recoverable. No native trust approval was granted automatically. Live continuation with this profile remains dependent on completing that setup.

## Shell configuration follow-up

All profile launch paths now load interactive login zsh startup files before invoking the configured launcher. An isolated integration test verifies startup environment/PATH inheritance, shared config symlinks, literal arguments and project paths, and separation of startup banners from Chat protocol output. The Code suite passed 97/97; the desktop build and ARM64 package passed. The running setup terminal retained its process across the app/service update. Read-only native account checks reported Team and CIO signed out in the normal shell too, while default Claude and Gmail were signed in; no account credentials were changed or substituted.

## Session control and terminal layout follow-up

The Code suite passed 101/101. A focused follow-up also verified Stop after an actual background-service restart without an explicit UI re-claim. Explicit control actions recover only from `LEASE_REQUIRED`, which occurs before mutation; another window's ownership, revision errors and ambiguous disconnect/timeout outcomes remain blocked. Rejected Stop actions retain the terminal attachment.

An isolated Electron interface run exercised Chat → Terminal → Chat → Terminal, deliberately released the selection lease, and completed Stop through its confirmation dialog. Terminal screen bounds remained inside the available area at 1440×900, 1100×700 and 1800×1000, and a marker on the last terminal row was visible. Switching no longer attaches a replacement terminal during the intermediate state, and terminal attachment errors stay local instead of replacing handoff-dialog errors. All fixture projects and sessions were confined to a separate data directory.
