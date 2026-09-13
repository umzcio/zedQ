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

- A user-registered OAuth client with a write-only client secret in Keychain,
  using the publisher's advertised Basic or POST token authentication.
- A provider-issued bearer token, also write-only and bound to the saved endpoint.

Registered clients can use a fixed loopback port and localhost or 127.0.0.1.
The callback path is `/oauth/callback`; port conflicts fail without substituting
an unregistered address. zQ does not publish or embed a private OAuth app secret.
Changing endpoints or registration invalidates credentials and tool grants as
appropriate. A fresh sign-in is required for legacy tokens without endpoint binding.

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


## Starter catalog

`catalog.cjs` owns the seven publisher presets and their documentation links.
Google presets target personal accounts and currently require the publisher's
MCP developer preview setup, an OAuth app, an external consent audience, and a
test user. GitHub defaults to a personal access token; its remote server does not
provide dynamic client registration. Microsoft uses the published Work IQ public
client for work accounts; tenant policy and service availability still apply.
Discovery itself never starts authorization. Explicit Add and connect or Connect
starts the connection; newly discovered tools remain disabled.

arXiv is a bundled standard MCP server connected through the SDK's in-memory
transport. It calls the official public Atom API with a process-wide request
queue (at least three seconds between requests), deadlines and byte/XML bounds.
Its tools return abstracts, metadata and canonical abstract/PDF resource links;
they do not fetch full paper text. Bundled routing requires both its catalog ID
and exact API endpoint. There is no shell, container, or account credential.

Catalog UI and native auth require the updated shell. The chat module declares
`connectors.catalog.v1` so an older shell rejects it rather than loading a module
whose bridge methods it lacks.

### Publisher OAuth compatibility

Google allows anonymous initialize and tool discovery. `google-auth.cjs` completes
OAuth during explicit Connect using verified Google metadata and the documented
MCP scopes, before the native service can mark the connection connected. It never
starts interactive login from a tool call. Google's consent uses offline access;
valid scope-, issuer-, and endpoint-bound grants can be reused or refreshed.

The exact published Work IQ profile uses `http://127.0.0.1:12798/`. Its native
provider validates Microsoft's organizations metadata and tenant issuer template
before supplying the SDK discovery cache. Only that verified profile uses the
public-client discovery exception and omits the OAuth `resource` parameter in
favor of Microsoft's delegated scopes. Other servers retain ordinary SDK issuer
validation. Changes to the pinned Work IQ authority or endpoints fail closed.
