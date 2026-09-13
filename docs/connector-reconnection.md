# Connector reconnection

A successful Connect remembers that connector for the workspace. Opening zQ restores remembered connections in the background, two at a time, with a 30-second connection deadline. Closing the window or quitting ends sessions without clearing that choice. Choosing Disconnect (including cancelling a pending connection) durably turns it off. Editing an endpoint or credentials also turns restoration off until the next successful Connect.

Startup uses saved Keychain credentials and refresh grants. It never opens a browser or binds an OAuth callback listener. Google connectors can therefore restore simultaneously even when they use the same registered callback port. Missing/revoked grants or new required consent surface **Sign in again**; temporary connectivity and authorization-server outages surface a retryable connection error. Bearer credentials are not refreshed automatically.

Saved tool selections and revisions survive reconnects when the discovered tool definitions are unchanged. New or changed tools still require review. Chat/project connector selections and tool approval rules are unchanged.

Older metadata did not distinguish intentional disconnection from application shutdown. For those records, one explicit Connect after updating establishes the new preference. zQ does not infer consent from old tool selections. The additive `autoConnect` metadata field is persisted; `needsSignIn`, status, errors, and transport sessions are transient.

Validation:

- `mcp-service.test.cjs`: reopen/refresh, preserved tools, deliberate disconnect, queued cancellation, shutdown, legacy records, and independent timeout handling.
- `google-auth.test.cjs`: refresh with an occupied callback port, missing scopes, revoked grants, and temporary authorization outages.
- `connector-catalog.browser.cjs`: sign-in state and consistent context/dropdown actions.
- `connector-reconnect-packaged.browser.cjs`: actual packaged quit/relaunch, native Keychain, silent OAuth refresh, selected tools, and durable Disconnect in an isolated workspace against a local MCP fixture.

Native service changes require a shell update; a Chat module update alone is insufficient.
