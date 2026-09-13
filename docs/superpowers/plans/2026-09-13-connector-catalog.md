# Starter Connector Catalog Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development to implement these bounded tasks and review each result.

**Goal:** Deliver the user's seven starter connectors in a searchable Discover catalog, with real connection paths and truthful setup states.
**Architecture:** Chat owns discovery UI; native services own curated endpoint defaults, MCP clients, credentials and a bundled arXiv MCP adapter. Reuse standard MCP tools and existing approvals. Google targets personal accounts; Microsoft targets work accounts. User sign-in and provider app registration remain explicit setup actions.
**Tech Stack:** Electron, React, shared Radix components, official MCP v2 SDK, native Keychain.
**Spec:** Conversation approved seven cards: Scite.AI, arXiv, Gmail, Google Calendar, Google Drive, Microsoft 365 (Email/Calendar/OneDrive/Teams), GitHub. Personal Google, work Microsoft.

## Global constraints
- Preserve Appearance and other settings. Your connectors and Discover tabs stay inside existing Connectors page.
- Use actual brand assets and compact neutral cards. Context menus for catalog cards and installed connections, keyboard access, statuses based on saved connection IDs/URLs rather than display names.
- Never claim installed means authenticated. Never initiate sign-in from browsing. Tools default disabled and retain existing chat approvals.
- No Docker or arbitrary local script launching. arXiv adapter speaks standard MCP using an in-memory transport.
- No provider credentials in source, metadata, snapshots or logs. Missing app registration must be an actionable setup state, not a working-looking placeholder.
- Mutations/tests only in isolated profiles. Install verified shell + signed module and restore normal app; private GitHub backup remains authorized.

## Tasks
- [x] Native catalog and shared contract: seven entries, verified publisher documentation, account-specific setup notes; catalog IPC returns metadata. Test exact starter list, URL identity and setup states.
- [x] Native authentication compatibility: explicit bearer-token mode for GitHub; user-supplied OAuth client secrets in Keychain; fixed loopback callbacks for registered clients. Preserve public native OAuth defaults; no silent fallback, no browser on tool calls. Test redaction, auth headers, origin binding, fixed-port failure and cleanup.
- [x] Bundled arXiv MCP: official SDK client/server transport; search and get paper metadata + PDF source links against public arXiv API. Bounded XML parsing, query validation, cancellation and polite rate limit. Test malformed responses, escaping, limits and sources.
- [x] Discover UI and setup: exact seven cards, search/category filters, actual logos, Your connectors/Discover tabs, installed/connected indicators, right-click actions. Preconfigure known endpoints; supply account-aware setup explanations and advanced authentication fields without exposing saved secrets. Test with isolated browser fixtures.
- [x] Integrate/review: standard MCP execution for bundled arXiv; shared OAuth setup and catalog bridge. Run targeted/full tests and TypeScript, real read-only arXiv probe and unauthenticated provider discovery probes, packaged isolated fixture, signed module build. Never authorize real accounts on user's behalf.
- [x] Release: commit, merge, private push, backup app, install, reopen normal profile. Report exact account setup still required.

## Public sources
- https://scite.ai/mcp
- https://developers.google.com/workspace/guides/configure-mcp-servers (developer preview; Cloud project and OAuth setup required)
- https://learn.microsoft.com/en-us/microsoft-365/copilot/extensibility/work-iq/mcp/quickstart/github-copilot-cli
- https://github.com/microsoft/work-iq/tree/main/plugins/workiq-preview
- https://github.com/github/github-mcp-server/blob/main/docs/host-integration.md (no DCR; token or registered app)
- https://info.arxiv.org/help/api/user-manual.html

## Integration findings
- Google serves anonymous initialize/tool lists. Explicit Connect now completes Google OAuth first; narrow documented scopes and fixed callback registration are required.
- Work IQ uses Entra organizations metadata with a tenant issuer template. The exact published public client is handled through validated discovery cache state; other providers retain standard issuer checks. Its callback is `http://127.0.0.1:12798/`, confirmed against Microsoft's published MCP preset and the official Copilot CLI callback implementation.
- Both quick-connect and setup-dialog connection attempts can be cancelled; retry updates the saved item rather than duplicating it.
- Chat 1.18.0 requires `connectors.catalog.v1` and an updated shell; old shells reject the new capability. Signed single-module build succeeded.
- Real account consent is intentionally left to the user. Public metadata and arXiv were probed live; private Google/Microsoft/Scite/GitHub account access has not been tested.

## Verification
- Full suite: 767 tests, 714 passed, 53 skipped, zero failures. Subsequent auth/URL validation changes: 41 targeted connector tests passed.
- Final browser catalog fixture, TypeScript and diff checks passed.
- Signed chat-only module build and full desktop packaging passed.
- Packaged catalog fixture passed with seven native presets, correct Google setup, real bundled arXiv discovery and tool selection, saved/connected states and context menus.
- Packaged OAuth/chat fixture passed with real SDK PKCE, native Keychain, approval, Ollama tool execution, source activity, close/reopen, silent reconnect and credential cleanup.
- All mutation fixtures used disposable workspaces. Normal workspace was not used for testing.

## Release result
- Source commit `dc6704a` merged to main and pushed to the private GitHub remote.
- Verified packaged app installed and reopened at the normal app path with the regular workspace.
- Previous app retained at `.local-data/app-backups/pre-catalog-dc6704a/zQ.app`.
- Installed app.asar SHA-256: `02f45f8776881ffe3a80c596aee797e84d4196625f0c2284f7a4aafd92c314f5` (matches tested package).
- Verification logs and screenshots retained in `.local-data/catalog-verification-dc6704a`.
- Personal Google OAuth registration/consent, work Microsoft sign-in/admin consent, Scite sign-in and GitHub token remain user setup steps; no real accounts were authorized during development.
