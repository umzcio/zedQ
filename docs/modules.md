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

The initial manifest API is deliberately constrained to the four shipped module identities, views and existing capabilities. Adding a new module identity or native capability requires a shell release; updating one of the existing modules does not. Breaking SDK/React-runtime changes require a new compatible API version, not silently reusing API version 1. Module CSS ships in its package; new styles should be authored there, rather than assuming future Tailwind utilities already exist in the installed shell.

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

The build typechecks the app and modules, builds the four modules independently, signs their packages into `apps/desktop/bundled-modules`, and embeds their public trust roots. The desktop package includes those signed fallback packages, never the private signing key. `npm run desktop` starts the built app; the native module bridge is required, so a standalone Vite preview is not the module runtime.

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


### Workspace recovery and activity release

HQ 1.0.3 and Notes 1.1.4 require `workspace.activity.v1`; Tasks 1.1.3 requires `workspace.drafts.v1`. Ship them with this shell update, which adds the shared activity/validation exports, optional numeric `Note.openedAt`, and shell-owned `workspace.saveDraftCopy`. Older stored note date strings remain readable. Install these three module versions together: an older installed HQ package can otherwise display numeric edit timestamps as raw text. The module store prefers an installed package over a newer bundled fallback, so verify running versions after staging updates and restarting. Workspace schemas are owned by the shell and are never rolled back by module rollback.

Invalid workspace text stays in the open renderer; the shell persists the valid projection and blocks normal close while rejected edits remain. Recovery copies use their own native export path so the workspace size limit does not prevent rescuing a larger draft. This does not provide crash recovery for rejected edits. Import exhaustion now leaves an unavailable module surface with access to Module Settings; it does not stop healthy modules or bypass signature/capability checks.
