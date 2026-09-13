# Personal Gmail connector

Gmail uses a bundled MCP adapter over Google's standard Gmail REST API. It needs no remote MCP preview enrollment, container, or separate server. The adapter runs in the desktop host; Chat uses the existing connector capability and permission controls.

## Setup

Enable **Gmail API** in your Google Cloud project. Configure an OAuth web application, add your personal Google account as a test user while the app is in testing, and register `http://127.0.0.1:43187/oauth/callback` (or the exact callback configured in zQ). Use `gmail.readonly` and `gmail.compose` scopes. Enter the client ID and secret in Connectors → Gmail, then connect through Google's browser consent flow. Secrets and tokens live in the native credential store.

Connecting verifies access through `users.getProfile`. It does not search mail or create drafts. After connection, choose the tools to expose to chat. Chat tool permissions still apply.

## Supported tools

- `search_threads`: Gmail query syntax, latest message metadata for each result, and pagination.
- `get_thread`, `get_message`: decoded text, or HTML source when no plain-text body exists; attachment metadata only.
- `list_labels`: mailbox label IDs and names.
- `list_drafts`, `get_draft`, `create_draft`: inspect and prepare drafts. Creation supports plain text or HTML and reply threading. No deletion tools are exposed.
- `send_draft`: send an existing draft after a per-message approval showing To, Cc, Bcc, subject, body and attachments. A chat-wide grant cannot approve sending. The native adapter binds approval to a short-lived single-use snapshot; changed drafts are rejected and the send includes the approved MIME to prevent concurrent edits from substituting content. Uncertain sends are not automatically retried; check Sent.

Search returns up to ten threads per page. Thread reads return the latest ten messages with bounded bodies, and disclose truncation. Attachments are not downloaded or uploaded. A failed draft request with an uncertain outcome tells the user to check Drafts before retrying.

## Existing installations

The exact legacy Gmail catalog endpoint is normalized to the standard API endpoint. On Connect, credentials are rebound only for the known legacy endpoint and matching registered client; eligible Google grants are reused. Other connector identities and endpoints are not migrated. Changed tool schemas require users to choose tools again; previous per-chat approval cannot authorize changed tools without review.

Calendar and Drive now also use bundled standard-API adapters. See [Google Calendar and Drive](google-workspace-connectors.md).

## Validation

`gmail-mcp.test.cjs` covers REST requests, pagination, MIME drafts, validation, response limits, cancellation and errors. `google-auth.test.cjs` covers OAuth, cached grants and refresh. `mcp-service.test.cjs` covers legacy migration and native service integration. `gmail-packaged.browser.cjs` uses a disposable workspace and local fake Google/model endpoints to exercise the packaged app through sign-in, tool selection, chat approval, search, reviewed sending, Calendar/Drive discovery and tool calls, and reconnect. No test uses the regular mailbox.

References: [Gmail API](https://developers.google.com/workspace/gmail/api/guides), [threads.list](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.threads/list), [drafts.send](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.drafts/send), [drafts.create](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.drafts/create), [Google OAuth](https://developers.google.com/identity/protocols/oauth2/web-server).
