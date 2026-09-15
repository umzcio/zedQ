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

The complete desktop suite passed with 890 tests passing and 52 explicitly skipped on the final integrated feature tree. Final integration verification is recorded in the implementation ledger.

SSH bootstrap, transport, persistence and filesystem behavior were exercised through an isolated transport fixture. A real remote host, its authentication and live SSH port forwarding were not available for end-to-end verification. Local prerequisites are tmux and the selected CLI; remote hosts also require Node, zsh and configured SSH trust/authentication.

The file editor supports existing text files up to 24 KB; it is not a full IDE. Generic CLI profiles are terminal-only. Native account authentication remains with each CLI; expired profiles require the explicit setup terminal. No credentials are copied between profiles.
