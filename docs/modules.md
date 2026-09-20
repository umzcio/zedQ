# Building and updating zQ modules

zQ is an Electron desktop shell with independently built first-party React modules. It is not a Swift app. The shell loads signed local packages before opening the workspace; the installed module code is not compiled into the shell JavaScript.

## Source ownership

- `modules/hq`: dashboard, quick capture and cross-module shortcuts.
- `modules/notes`: scratchpads, document tabs, local editor controller, sidebar and rename UI.
- `modules/tasks`: Kanban/list views, task editor, task commands and sidebar.
- `modules/chat`: conversations, projects, attachments, model connection UI, streaming UI and sidebar.
- `modules/code`, `modules/work`: documented future modules, not enabled placeholders.
- `packages/ui`: shared shadcn/Radix primitives, common note menu, design tokens and shared styles.
- `packages/module-api`: version 1 TypeScript contract, module lifecycle helpers, public data shapes and shell service types.
- `packages/providers`: native model provider implementations; currently Ollama.
- `apps/desktop/src`: host composition, navigation frame, search, Settings, module loader and error boundary.
- `apps/desktop/electron`: trusted IPC, persistence, native file/attachment/chat services, app lifecycle and signed module storage.

Native services remain part of a desktop release. A module update can change frontend behavior and use existing services; it cannot introduce an unimplemented native provider, IPC method or data schema.

## Public renderer contract

Each shipped module has `manifest.json`, `index.tsx`, styles and its feature files. Entry exports:

```tsx
import { ModuleSurface, useHost } from '@zq/module-api'
function Root() {
  const host = useHost()
  return <>
    <ModuleSurface slot="sidebar">…</ModuleSurface>
    <ModuleSurface>…</ModuleSurface>
  </>
}
export default { Root }
```

Every Root stays mounted across navigation so controllers, chat drafts and subscriptions survive switching modules. `ModuleSurface` renders into shell slots without adding layout boxes; Settings connection contributions use `slot="settings"`; Chat Skills uses `slot="skillsSettings"` with the `skills.v1` host capability. Roots receive one shared React runtime and SDK context. Module render failures are isolated by a shell error boundary.

`useHost` exposes the workspace snapshot, authorized service groups, commands, navigation, notifications and save/close integration. `useWorkspaceField` performs functional updates against the host snapshot so concurrent module writes cannot replace each other's data. Modules requesting write access declare `workspace.write`. `useCommand` registers a command with cleanup; command dispatch returns false if the owning module is unavailable, allowing Quick Capture to retain its draft. Direct imports from the desktop app or another module are rejected during module builds. Shared UI is imported only through `@zq/ui`.

The initial manifest API is deliberately constrained to the five shipped module identities, views and existing capabilities. Adding a new module identity or native capability requires a shell release; updating one of the existing modules does not. Breaking SDK/React-runtime changes require a new compatible API version, not silently reusing API version 1. Module CSS ships in its package; new styles should be authored there, rather than assuming future Tailwind utilities already exist in the installed shell.

## Signing setup

Once per development signing identity:

```sh
npm run modules:keygen
```

This creates `.local-data/module-signing/private.pem` with private permissions. It refuses to replace an existing key. Keep this key backed up privately; do not commit it or ship it in the app. All builds using a shared release identity should set `ZQ_MODULE_SIGNING_KEY` to that same securely stored Ed25519 private-key path. A different signing key requires distributing a shell that trusts its public key. This development signer is not an Apple signing/notarization identity.

## Build the desktop and bundled fallbacks

```sh
npm run build
npm run pack
```

The build typechecks the app and modules, builds the five modules independently, signs their packages into `apps/desktop/bundled-modules`, and embeds their public trust roots. The desktop package includes those signed fallback packages, never the private signing key. `npm run desktop` starts the built app; the native module bridge is required, so a standalone Vite preview is not the module runtime.

## Release only Chat

```sh
npm run modules:build -- chat --version 1.0.1
```

This builds only `modules/chat`, producing `.local-data/module-releases/zq.chat-1.0.1.zqmodule`. It does not rebuild the shell or change the bundled versions of Notes, Tasks or HQ. In normal releases, also update the module's `manifest.json` and package version in source; `--version` is useful for verification/candidate builds. Versions must increase. Module packages are single bounded JSON artifacts containing manifest, executable code, CSS, key ID and Ed25519 signature.

Transfer the package to another Mac running a shell with the same public trust root. In **Settings → Modules**, choose **Install update…**. Alternatively, host the file at an HTTPS URL and use **From URL…**. Downloading is bounded, verifies signatures, and rejects incompatible APIs/capabilities before staging. There is no hosted update catalog or automatic background polling configured yet.

## Activation, rollback and data

Installing stages the package in the Mac's private `Application Support/zQ/modules` directory. The active in-memory module remains unchanged. Quit normally to flush workspace/file/chat state; reopen to activate the staged version. The same module update must be installed on each Mac until distribution/sync is implemented.

Each module row shows its running version and any next-launch version. Roll back is available both on the row and through its context menu, and stages the previous verified package or bundled fallback. Package corruption and import failures fall back through verified candidates. If a module throws while rendering, the rest of the shell remains available and a fallback is prepared for restart. Workspace, files and chat stores are never rolled back or migrated by module installation.

These are **trusted first-party modules sharing one renderer**, not an untrusted plugin sandbox. Signing establishes publisher identity and integrity, not code safety. The shell retains Electron context isolation, disabled Node integration, validated IPC senders and bounded native methods. Independently updatable third-party code with separate permissions would require additional isolation.

## Verification record

On September 9, 2026, isolated native checks installed Chat 1.0.1 through the actual file picker, observed 1.0.0 still active until quit, then loaded 1.0.1 with its saved conversation. HQ/Notes/Tasks remained 1.0.0, and SHA-256 of the packaged `app.asar` was unchanged across activation. Rollback staged 1.0.0 successfully. Notes-to-Tasks command dispatch created a linked fixture task. Tests cover signature/schema/compatibility rejection, private atomic staging, corruption and interrupted-write recovery, bounded downloads, module import boundaries and command/fallback lifecycle.

Final verification: all 147 automated tests and the TypeScript/build/package checks passed. The final isolated launch confirmed rollback to bundled Chat 1.0.0, preserved the linked fixture task and conversations, successfully created a note through HQ Quick Capture, and reopened the existing local-file recovery tab. Package inspection confirmed four signed fallback artifacts and no private signing key.

## Provider capability addition

Chat 1.1.0 requires `providers.v1` in addition to its original capabilities. The desktop provider release includes native adapters, Keychain storage and connection lifecycle changes. An older shell rejects this module because the new capability exceeds its bundled permissions. After installing this desktop release, compatible Chat-only updates continue to use the same signed package workflow. See [provider setup](providers.md).

Chat 1.2.0 additionally requires `settings.v1` for the shared settings action menus. The host exposes optional `openSettings(section)` for direct navigation to a settings panel; legacy module navigation to Settings opens its contributed connections panel. Native provider and storage contracts are unchanged by this settings release.

Chat 1.3.0 requires `models.v1`: the native `chat.saveModelPreferences` bridge, connection model-selection fields, and snapshot default choice. This release includes native persistence/schema and IPC changes and must ship with the updated desktop shell. Older shells reject the new capability. Existing compatible modules can still use the unchanged connection and chat APIs.

Chat 1.3.1 adds `model-labels.v1` for per-connection display aliases in the native preference API and stored connection data. Ship with the updated desktop shell; older shells reject this capability. Labels never replace provider model IDs in requests.

Chat 1.6.0 requires `provider-tools.v1` for hosted tool choices, durable activity/generated files, explicit source opening, and native file saving. This includes native service/IPC/schema changes and must ship with a desktop shell update. Plain-chat fields remain backward compatible; older stores omit the new optional fields.

Chat 1.9.0 requires `skills.v1` for the dedicated Skills settings surface and native skill storage/selection commands. This release includes a shell update; it cannot be installed independently on a shell without that capability. See [Chat skills](chat-skills.md) for selection, snapshot, and export behavior.

Chat 1.10.0 adds `skills.import.v1` for native Markdown and zQ-export import. The shell validates selected files and exposes an import preview before atomic library creation. This native capability requires the corresponding shell update.

Chat 1.11.0 adds `skills.packages.v1` and `skills.catalog.v1` for standard package/folder import and export, immutable native resource storage, resource preview/save, and curated public-source discovery. These native/schema additions require the updated shell. Full skills.sh API search is not configured. See [interoperability](interoperability.md).

Chat 1.12.0 adds `skills.updates.v1` for catalog provenance, revision checks, and reviewed updates with concurrent-edit protection. The additive skill schema and native commands require an updated shell. Update checks use each skill directory's Git tree revision, not the repository's overall commit.

Chat 1.13.0 adds `skills.recognition.v1` for offline recognition of older curated imports and explicit detachment of personal duplicates. The shell also adds shared dropdown submenu components for the Chat composer. Ship the module with this shell update.

Chat 1.14.0 requires `chat.flow.v1` in its target shell. This shell adds durable per-conversation queues, interaction records, decision IPC and provider human-wait timers. Older shells reject the module capability; install the shell update before independently staging this Chat module. Bundled fallbacks and signature checks are unchanged.

Chat 1.15.0 requires `skills.activation.v1` for automatic discovery, durable loaded-skill snapshots and visible usage activity. Install this desktop shell update before independently staging the Chat module. The host retains script-execution and permission boundaries; loading a skill does not grant tools.

Chat 1.16.0 requires `artifacts.fonts.v1` for the expanded native typography schema and exporters. Ship with the updated shell; older shells reject this capability. Existing stored typography remains valid, and no new renderer IPC is required.

## Shared tooltip capability

The app-wide tooltip release adds `ui.tooltips.v1` to each updated module's required capabilities. It supplies shared tooltip exports and styles in the desktop shell. Older shells reject these newer module packages before loading their code because the capability exceeds their bundled permissions. Install the accompanying desktop build first; subsequent compatible module updates can continue independently. No native storage schema changed.

## Shared motion release

Chat 1.18.16 and Code 1.8.1 require `ui.motion.v1`, provided by the accompanying desktop shell. Shared dialog/popover timings and the citation preview surface now belong to `@zq/ui`; Chat no longer installs global timing overrides. Older shells reject these packages before loading them. Notes 1.1.6 uses the existing API for continuous, elapsed-time tab edge scrolling and is included in this release.

Workspace search opens immediately. Draft attachments animate only when newly added; restored drafts and history remain still. Disclosure content expands immediately with a short interruptible caret transition. Code's automatic Human Review arrivals receive one brief opacity cue, suppressed during navigation, filtering, local moves and reduced motion. Shell notices can reverse their fade without replaying from zero. No native service or storage schema changed. Verification coverage is in `apps/desktop/tests/animation-motion.browser.cjs`.


### Workspace recovery and activity release

HQ 1.0.3 and Notes 1.1.4 require `workspace.activity.v1`; Tasks 1.1.3 requires `workspace.drafts.v1`. Ship them with this shell update, which adds the shared activity/validation exports, optional numeric `Note.openedAt`, and shell-owned `workspace.saveDraftCopy`. Older stored note date strings remain readable. Install these three module versions together: an older installed HQ package can otherwise display numeric edit timestamps as raw text. The module store prefers an installed package over a newer bundled fallback, so verify running versions after staging updates and restarting. Workspace schemas are owned by the shell and are never rolled back by module rollback.

Invalid workspace text stays in the open renderer; the shell persists the valid projection and blocks normal close while rejected edits remain. Recovery copies use their own native export path so the workspace size limit does not prevent rescuing a larger draft. This does not provide crash recovery for rejected edits. Import exhaustion now leaves an unavailable module surface with access to Module Settings; it does not stop healthy modules or bypass signature/capability checks.

## Code shell release

Code adds the fifth bundled identity, `zq.code`, and the `code.v1` native capability. It requires this shell release; older four-module shells cannot install it independently. Four-module bundled sets remain readable for compatibility, while this release packages all five fallbacks. Code UI and styles stay in `modules/code`; native lifecycle, SSH and filesystem services stay in the desktop host.

Code 1.2.0 adds `code.ssh-terminals.v1` and requires the accompanying shell update. It adds persisted host visibility/execution-user fields, standalone tmux session creation and project association. Existing host records retain login-user execution; new explorer selections default to passwordless root. Root and login-user catalogs remain separate. See [SSH terminals](code-ssh.md).

Code 1.3.0 declares `code.session-files.v1` for session-scoped workspace reads/edits and native binary upload/download dialogs. Install it with the updated shell; older shells reject the added capability.

Code 1.4.0 adds session tabs, two resizable panes (side by side or stacked), and local view restoration. It uses the existing shell API and can be installed independently on the Code 1.3 shell. Closing tabs/panes detaches views; stopping a process remains a separate session action. Tab groups, focus, split ratio/direction, project selection, and workspace-panel visibility are restored. Saved SSH tabs show reconnect controls until their host is opened; restoration does not silently connect to remote hosts.

Code 1.4.2 adds native Close Tab routing (`ui.close-tab.v1`) and requires the accompanying shell update. In Code, ⌘W detaches the focused tab and keeps its session running, including when closing the last tab. ⌘⇧[ / ⌘⇧] cycle within the focused pane. Dialogs block these actions; Ctrl+W on macOS remains available to the shell. Close Window is available separately as ⌘⇧W. Outside Code, Close Tab retains the previous window-close behavior.

Code 1.5.0 declares `code.kimi-native.v1` for native Kimi discovery, creation and
conversation handoff. It requires its accompanying shell update and a fresh
local session helper; existing persistent agent processes are preserved.
See [Native agent sessions](code-native-sessions.md) for behavior and boundaries.

Code 1.6.0 requires `code.native-sessions.v1` for unified native-history discovery,
Claude SDK reads and Codex app-server continuation. Ship with the accompanying
shell and refreshed local helper; existing agent processes remain intact.
The signed module cannot run on the earlier Kimi-only shell.

Tasks 1.2.0 requires `github` / `github.prs.v1` and clipboard access for its Open PRs Kanban. Code 1.6.1 adds `code.review-links.v1` for the public `code.open` command. Ship both with the new native GitHub service; see [GitHub PR board](github-pr-board.md). The new shell also fixes fresh Codex threads attempting to read a rollout before their first turn.

Code 1.7.0 owns the overall Code → Tasks Kanban; Open PRs is a category inside it. Tasks 1.2.1 removes the misplaced PR view. The shell adds Code task records to the existing native board store, preserving PR selections/reports. Code now declares `github`, `github.prs.v1`, and `code.tasks.v1`; Tasks no longer declares GitHub access.

### Code 1.7.1: shared button contrast

Removed the Code workspace/sidebar text inheritance rule from shared controls (`data-slot`). It was overriding the primary button foreground, producing dark text on the gunmetal light-theme button. The SSH browser regression now requires at least 4.5:1 contrast on Open host for all four palettes in both themes. SSH workflow checks, typecheck, and the signed single-module build passed; light/dark screenshots were inspected. No native-service change or helper restart.

### Shared sidebar section disclosure

The shell exports `SidebarSection` through `@zq/ui`, with the capability `ui.sidebar-sections.v1`. HQ 1.0.4, Notes 1.1.5, Tasks 1.2.2, Chat 1.18.15, and Code 1.7.5 use it for their existing sidebar collections. These versions require the matching shell; older shells reject the new capability.

Expanded headings reveal a down chevron on hover or keyboard focus. Collapsed headings keep a right chevron visible. Enter/Space and the heading context menu toggle the section; counts and add/scope actions remain available. Each collection saves its preference in the app's local UI storage. Collapsing Code Sessions only hides navigation entries and does not detach running terminals.

Validation: isolated packaged browser coverage across all five modules verifies hover visibility, keyboard/context menus, actions while collapsed, independent sections, and restart persistence. The SSH browser test verifies collapsing/reopening Sessions retains the same active session. Both themes inspected, typecheck and all five independent signed builds passed.

## Chat 1.19.0: Deep Research

Requires `research.v1` and `artifacts.research.v1` in the accompanying shell. Adds native checkpoint storage, research IPC and report artifact blobs/publication keys, so install the shell and Chat update together. Existing artifact/chat data stays compatible. Research continues across module/chat navigation while the app runs; quit preserves checkpoints for explicit resume. See [Chat research](chat-research.md) for capabilities, source scopes, report versions and export limits.

Chat 1.19.1 consolidates Deep research into the existing composer Tools popover, removes the redundant Chat dropdown, and matches Research/Sources typography and spacing to existing composer controls. It uses the 1.19.0 shell API and ships as a signed Chat-only update. Typecheck, native-backed research browser flow, light/dark inspection, and isolated packaged-module activation passed.

Chat 1.19.2 replaces the sectioned tool picker with a single shared Radix dropdown: icon, label, and right-aligned selected checkmark. Research stays in the same list as provider tools. No descriptions, heading, checkbox boxes, or charge footer. Existing regular tool selections survive switching Research on/off. Light/dark inspection, native-backed UI flow, typecheck and packaged signed-module activation passed.

Chat 1.19.3 keeps the composer attachment + visible in Research, using the shared menu with Upload files and Choose sources. Upload, paste and drop open source selection after successful import in the same conversation; canceled or failed imports do not open it. No automatic source grants. Browser coverage checks the + menu, file import availability, picker focus and the full report flow; packaged activation and typecheck passed.

Chat 1.19.4 groups Research sources into Selected, Web, Files, Notes and Connectors tabs with search and 25-item pagination. Escape closes the picker even with a visible tooltip, while preserving context-menu dismissal order. Removes the permanent composer plan/source instruction. Typecheck, native-backed browser flow (including 81-note pagination/search), light/dark inspection, single-module build and isolated packaged signed-module activation passed. Uses the existing 1.19.0 shell API.

Chat 1.19.5 fixes a remaining Sources Escape failure when no dialog control has focus and a tooltip consumes document-level Escape. Dismissal now listens at window capture only while this picker is the top open dialog, yielding to open menus/listboxes and preserving IME composition. The installed 1.19.4 package reproduced the lost-focus failure; the signed 1.19.5 package passes the same native-key regression, direct/menu opening, tooltip dismissal, focus restoration, and existing source context-menu tests.

Chat 1.19.6 removes the duplicate Choose sources entry from the Research attachment menu. The composer Sources control is the single entry point; + retains Upload files. The source picker footer reuses the shared dialog-actions typography and matching button sizes instead of inheriting oversized body text. Typecheck, the signed single-module build, native-backed UI and packaged flows passed; light/dark footers were visually checked.
