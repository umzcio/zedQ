# Remote MCP native service

`ConnectorService` owns Streamable HTTP sessions through the official
`@modelcontextprotocol/client` v2 SDK. No local processes are launched.

OAuth uses the SDK's discovery, public-client registration, PKCE and token
exchange implementation. A native loopback HTTP callback is allocated per login,
with random state and issuer validation. Authorization discovery and the verifier
remain in memory for the callback round trip. Tokens and issuer-stamped client
registrations are stored as atomically committed, chunked base64url JSON in the
workspace's Keychain adapter. There are no credentials in connector metadata.
Concurrent 401 responses share one SDK authorization operation, avoiding duplicate
refreshes of rotating tokens. Calls can refresh credentials, but cannot open a
browser. Explicit Connect is required when interactive authorization expires.

Supported client registration paths:

- A pre-registered public native client ID, with `token_endpoint_auth_method: none`.
- An HTTPS client metadata document URL when the authorization server advertises it.
- Dynamic client registration when the authorization server advertises an endpoint
  and accepts a public native client.

Providers requiring confidential client secrets or an unregistered fixed redirect
URI are not silently emulated. The provider must register a native application
that accepts loopback redirects with ephemeral ports. zQ does not host or publish
a client metadata document automatically.

Remote endpoints and discovery require HTTPS. The host can explicitly enable HTTP
loopback endpoints with `allowLoopbackHttp: true`. HTTP authorization discovery is
then allowed only for a connector whose original endpoint is HTTP loopback.
Authenticated redirects are rejected. Fetches have response-byte and time bounds;
input/output schemas and values are validated in bounded workers. Tool execution
uses the approved definition, preventing the SDK from refreshing changed schemas
and replaying a tool call without a fresh approval revision.

Connectors restart disconnected; Connect reuses Keychain credentials when valid.
Tool selection persists, and unchanged reconnects preserve revision and selection.
Schema or read-only hint changes disable that tool and change the revision.
A tool-list change notification invalidates selection and disconnects the session
for explicit review. Read-only hints do not grant automatic tool permissions.

Metadata commits use a restrictive temporary file, fsync, and atomic rename;
failed commits restore the previous public state. Shutdown/disconnect abort work
and attempt SDK session termination using a separately bounded cleanup request.

Tests use disposable workspaces and local mock OAuth/MCP endpoints; they do not
perform account authorization against a third-party production service.

Protocol references: [MCP authorization](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization)
and the [official TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk).

Run `node apps/desktop/tests/mcp-packaged.browser.cjs` from the repository root
after packaging for an end-to-end fixture: native Keychain, browser-authorization
callback simulation, PKCE, tools initially disabled, an actual Ollama adapter
round trip with approval, source activity, and macOS window close/reopen.
It uses an isolated profile and removes its fixture credentials on completion.
