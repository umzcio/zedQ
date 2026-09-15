const messages: Record<string, string> = {
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
    "This file changed on disk. Copy your draft, then reload the latest file before saving.",
  FILE_TOO_LARGE:
    "This file is too large for the built-in editor. Open it in your usual editor.",
  HOST_DISCONNECTED: "Connect this host from Execution hosts to continue.",
  RESUME_UNSUPPORTED:
    "This launcher supports Terminal only. Start a new session to run it again.",
  INVALID_PREVIEW_URL:
    "Use a localhost development-server address, such as http://localhost:3000.",
  SHARED_HISTORY_UNCONFIRMED:
    "Confirm shared Claude history in this profile’s settings before switching conversations.",
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
