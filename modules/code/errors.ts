const messages: Record<string, string> = {
  NATIVE_SESSION_IN_USE: "This agent is already open in this folder outside this tab. Exit that conversation, then resume here.",
  NATIVE_OWNERSHIP_UNAVAILABLE: "zQ could not check for an existing agent process. Try again before opening another controller.",
  NATIVE_DISCOVERY_FAILED: "This agent could not list its native history. Check its setup in Terminal, then refresh.",
  NATIVE_SESSION_NOT_FOUND: "This conversation could not be found in the selected agent’s native history. Refresh the list.",
  NATIVE_START_FAILED: "The agent stopped during startup. Check its native configuration in Terminal, then resume.",
  CODEX_NOT_INSTALLED: "Codex could not start. Check that the selected account launcher works in Terminal.",
  CODEX_DISCOVERY_FAILED: "Codex could not list this account’s conversations. Check the account launcher in Terminal, then refresh.",
  CODEX_SESSION_NOT_FOUND: "This conversation is not in the selected Codex account’s recent history. Refresh the list or choose another profile.",
  CODEX_LOAD_FAILED: "Codex could not load this conversation. Check its native login and workspace, then resume.",
  CODEX_START_FAILED: "Codex stopped during startup. Check its native configuration in Terminal, then resume.",
  CODEX_START_TIMEOUT: "Codex is taking longer to start. Check the session status before retrying.",
  CODEX_SWITCH_FAILED: "Codex could not switch this conversation. Check the selected account launcher, then resume.",
  KIMI_SWITCH_FAILED: "Kimi could not switch this conversation. Check its native configuration, then resume.",
  STOP_UNCONFIRMED: "The previous agent has not finished stopping. Wait, then resume; another controller has not been started.",
  INVALID_PROFILE: "Choose an available account profile for this agent.",
  STALE_REVISION: "The session changed while this menu was open. Close the menu and try again.",
  SWITCH_IN_PROGRESS: "This conversation is still switching views. Wait for it to finish, then try again.",
  KIMI_SESSION_IN_USE: "Kimi is already open in this folder outside this tab. Exit that native conversation, then resume here.",
  KIMI_OWNERSHIP_UNAVAILABLE: "zQ could not check for an existing Kimi process. Try again before opening another controller.",
  KIMI_NOT_INSTALLED: "Install Kimi Code on this Mac, then refresh the session list.",
  KIMI_DISCOVERY_FAILED: "Kimi could not list its native sessions. Check that kimi session list --all --json works in your terminal.",
  KIMI_PROTOCOL_UNSUPPORTED: "This version of Kimi does not support the required session protocol. Update Kimi Code and retry.",
  KIMI_AUTH_REQUIRED: "Kimi needs its native login or model configuration. Run kimi in Terminal to finish setup, then retry.",
  KIMI_LOAD_FAILED: "Kimi could not load this native conversation. Check its login and workspace, then resume.",
  KIMI_START_FAILED: "Kimi stopped during startup. Check its native configuration in Terminal, then resume.",
  KIMI_START_TIMEOUT: "Kimi is taking longer to start. Check the session status before retrying.",
  KIMI_SESSION_NOT_FOUND: "This native conversation is no longer in Kimi’s recent sessions. Refresh the list.",
  KIMI_PERMISSION_UNSUPPORTED: "This Kimi action needs a response this view cannot provide. Decline or interrupt it, then continue in Terminal.",
  TRANSFER_BUSY: "Another file transfer is in progress. Wait for it to finish, then try again.",
  TRANSFER_EXPIRED: "The file transfer expired. Start the transfer again.",
  TRANSFER_INCOMPLETE: "The transfer did not finish. The destination file was not replaced. Try again.",
  TRANSFER_FAILED: "The file transfer failed. Check the connection and folder permissions, then try again.",
  EACCES: "You do not have permission to read or write this file with the selected account.",
  ENOSPC: "The destination is out of disk space. Free some space and retry the transfer.",
  BINARY_FILE: "This file cannot be shown in the text editor. Right-click it and choose Download… to open it locally.",
  SSH_SUDO_REQUIRED: "Passwordless root access failed. Check SSH login and sudo -n -i on this host, or select SSH login user.",
  SSH_USER_MISMATCH: "The remote service did not confirm root identity. No terminal was attached.",
  SSH_CONNECTION_FAILED: "SSH could not connect. Check the SSH alias, host key, SSH agent, and network connection.",
  SSH_NODE_REQUIRED: "SSH connected, but Node.js is unavailable for the selected user. Install Node.js or add it to that user’s login PATH, then retry.",
  SSH_TMUX_REQUIRED: "SSH connected, but tmux is unavailable for the selected user. Install tmux or add it to that user’s login PATH, then retry.",
  SSH_DEPENDENCIES_REQUIRED: "SSH connected, but Node.js and tmux are unavailable for the selected user. Install them or add them to that user’s login PATH, then retry.",
  SSH_BOOTSTRAP_FAILED: "SSH connected, but the session helper could not be installed. Check the selected user’s private zQ directory and shell startup output.",
  HOST_USER_IMMUTABLE: "Existing host identity cannot change. Select the other user from SSH hosts to open a separate context.",
  EXTERNAL_TERMINAL_IN_USE: "This tmux session already has an attached client. Detach that client first; zQ will not take it over.",
  UNKNOWN_METHOD: "The running session helper is older than this app. Existing sessions are preserved; update the helper before using this action.",
  TMUX_FAILED: "tmux could not complete the action. Check that the name is unused and tmux is available for this user, then refresh.",
  INVALID_REQUEST: "This action could not be processed. Refresh the session and try again.",
  INVALID_MODEL: "Enter a valid Claude model name or choose a model from the list.",
  GIT_FETCH_FAILED: "Fetch failed. Check your network and Git remote authentication, then retry. Your working files were not changed.",
  SERVICE_REQUEST_TIMEOUT: "The session took too long to respond. Reconnect to check its current state before retrying.",
  PROJECT_TRUST_REQUIRED: "Claude needs your one-time approval to work in this folder. Open setup terminal, confirm folder trust there, then stop setup and resume this conversation.",
  PROJECT_SESSION_ACTIVE:
    "Stop the active sessions in this project before opening a setup terminal.",
  PROCESS_OWNERSHIP_UNKNOWN:
    "The previous agent may still be running. zQ will not start another controller until its exit is confirmed.",
  RECONCILIATION_REQUIRED:
    "The previous controller’s state is uncertain. Check the running process before resuming.",
  LEASE_HELD:
    "This session is controlled by another zQ window. Release it there, then select this session again.",
  LEASE_REQUIRED:
    "This window is no longer controlling the session. Select another session and return to reconnect.",
  IDENTITY_MISMATCH:
    "The launcher opened a different conversation or folder. The session has been stopped to protect your work.",
  IDENTITY_UNVERIFIED:
    "The agent did not confirm its conversation and folder. Check the launcher in Terminal.",
  TARGET_NOT_READY:
    "The selected agent could not start. Check its login and launcher, then retry or resume the previous profile.",
  GIT_UNAVAILABLE:
    "Git could not run. Install Git or finish its system setup, then refresh.",
  NOT_GIT_REPOSITORY: "This project folder is not a Git repository.",
  FILE_CHANGED:
    "This file changed on disk. Copy your draft, then reload the latest file before saving.",
  FILE_CONFLICT:
    "This file changed while the operation was running. Reload it before saving, or retry the transfer.",
  FILE_TOO_LARGE:
    "This file is too large for the built-in editor. Right-click it and choose Download… to open it locally.",
  HOST_DISCONNECTED: "Connect this host from Execution hosts to continue.",
  RESUME_UNSUPPORTED:
    "This launcher supports Terminal only. Start a new session to run it again.",
  INVALID_PREVIEW_URL:
    "Use a localhost development-server address, such as http://localhost:3000.",
  SHARED_HISTORY_UNCONFIRMED:
    "Confirm shared native history in this profile’s settings before switching conversations.",
};
export function codeError(value: unknown): string {
  const text = value instanceof Error ? value.message : String(value || "");
  return (
    messages[text] ||
    (/^[A-Z][A-Z_]+$/.test(text)
      ? text.toLowerCase().replaceAll("_", " ")
      : text)
  );
}
