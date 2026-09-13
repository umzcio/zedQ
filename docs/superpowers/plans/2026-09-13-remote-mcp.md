# Remote MCP connectors implementation plan

Goal: Add standards-based remote MCP servers to zQ, with browser OAuth, tool selection and real chat execution. Approved in conversation. No local process/container backend in this milestone.

Architecture: trusted Electron owns connector persistence, MCP SDK transports and OAuth credentials. Chat module owns connector management and composer selection. Shared module API exposes typed methods, never credentials. Use official @modelcontextprotocol/client 2.0.0, inspect current upstream docs/source for OAuth interoperability. Support unauthenticated and OAuth Streamable HTTP, client metadata URL / pre-registered public client ID / compatible dynamic registration. Unsupported registration requirements must be explicit, not hidden behind a fake success.

## Contracts
- Connector: {id,name,url,status:'disconnected'|'connecting'|'authenticating'|'connected'|'error',error?:string,revision:number,clientId?:string,clientMetadataUrl?:string,tools:ConnectorTool[]}.
- ConnectorTool: {name,title?:string,description:string,inputSchema:Record<string,unknown>,enabled:boolean,readOnly:boolean}. readOnly is a server hint, not automatic trust.
- ConnectorService({directory,credentials,openExternal,onChange}) at electron/mcp/service.cjs: list(), save(input), connect(id), disconnect(id), remove(id), setTools({id,names}), callTool(id,name,args,{signal,expectedRevision}), close(). Methods can return promises except list. connect can wait for user OAuth; disconnect cancels. Durable atomic metadata, Keychain secrets, bounded input/output, timeouts, session cleanup. callTool must never open a browser; expired auth gives clear reconnect action. Snapshot must never expose secrets. Tests may inject transport factories/credentials in disposable directories.
- Host.services.connectors bridge: list/save/connect/disconnect/remove/setTools return Result<Connector[]> (save can return full updated list for consistency), subscribe(callback list). Main IPC normalizes service method results to list after await.
- Chat conversation/project/draft connectorIds?:string[]|null; null/undefined inherit project, default none. setConversationConnectors({conversationId,connectorIds}) and updateProject connectorIds. send connectorIds snapshot preserved in queued/revised messages and checked at execution. UI includes Connectors submenu with explicit selection/inherit/manage.
- Tool execution uses existing adapter localTools/onLocalTool. Namespaced stable function names, JSON schema argument validation, current enabled-state check at each call, bounded results and sources/files handling. New connector activity kind with meaningful detail. Consequential/unknown tools ask permission; explicit per-tool read-only trust is deferred, so first invocation requires approval, existing per-chat grants reused with connector revision binding. Already-approved scope should not reprompt. Cancellation must stop outstanding requests and settle activity.

## Work units
1. Transport/OAuth/service + direct integration tests (delegated; files electron/mcp and tests/mcp-* only).
2. Connector settings + composer + host UI surfaces, API types and bridge UI exposure (delegated; no Electron edits, no root chat engine edits).
3. Main/preload integration, chat selection persistence/queue/revision, approval/execution/results + tests (root).
4. Review contracts and security, browser/packaged tests in disposable ZQ_DATA_DIR, build/release shell + signed chat module, restore regular app and backup to private GitHub.

## Verification
Use npm run typecheck; targeted node --test files; npm test; npm run test:ui as needed; packaged OAuth fixture with real localhost callback and controlled mock server, tool invocation and cancellation. Never create test data in the regular profile. No real external account consent implied; authentication against a user-selected third-party service requires their browser sign-in. If unavailable, report exact live-service validation limitation while shipping verified functionality.

## Delivered and verified

- Native SDK transport/OAuth and Keychain credentials; separate Connectors settings, tool selection, project/chat selection and approval-bound chat execution.
- JSON Schema defaults to 2020-12 with explicit draft-07 / 2019-09 support. Validation runs in bounded workers, including server output schemas. Ambiguous responses cannot trigger automatic repeats within the same request.
- Fixed macOS window reopen so closing a window stops work while reopening permits new messages; queued work stays paused. The renderer close timeout ends before asynchronous connector cleanup.
- Full desktop suite: 734 tests, 682 passed, 52 skipped, no failures. TypeScript and signed single-chat-module build passed.
- Packaged app fixture passed OAuth discovery/PKCE, native Keychain, default-off tools, chat approval, real Ollama adapter tool execution, sources, close/reopen, silent credential reuse and credential removal. Existing Skills composer and connector context-menu browser checks passed.
- Live third-party account consent was not performed. Some services require registering zQ as a public native OAuth client; legacy SSE and local stdio transports are outside this release. Connectors restart disconnected and reconnect explicitly.
