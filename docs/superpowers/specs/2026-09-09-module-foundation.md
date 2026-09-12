# Independently updatable zQ modules

Approved direction: preserve the Electron/React desktop and existing UI/data, replacing the navigation-only catalog with independently built and loaded first-party modules.

## Boundaries

`apps/desktop` owns startup, window lifecycle, trusted IPC, local durable stores, native file operations and model services. `modules/hq`, `modules/notes`, `modules/tasks`, and `modules/chat` own their views, sidebar contributions and feature behavior. `packages/module-api` defines API version 1 and typed shell services; `packages/ui` owns shared shadcn components and design primitives. Native provider implementations live in `packages/providers`. Code and Work remain explicitly unimplemented, with documented module entry requirements rather than fake views.

The module runtime shares the shell's React instance, uses a fixed versioned contract, and retains controllers while switching views. Modules receive typed services; they cannot import desktop source files. First-party signed renderer modules share a renderer trust domain: this is NOT a sandbox for untrusted third-party plugins. Native IPC remains sender-validated, context-isolated, sandboxed, and without Node integration.

## Update contract

Each module builds to a self-contained JavaScript bundle and optional CSS, with a manifest containing `id`, semantic `version`, `apiVersion: 1`, `title`, `view`, `icon`, and `capabilities`. Packages use format 1 JSON with `manifest`, `code`, `css`, `keyId`, and an Ed25519 base64 `signature` over JSON.stringify({format:1,manifest,code,css,keyId}). App-packaged public keys are the trust roots. Release signing secrets are never packaged. Hashes identify exact artifact bytes. Only the four known first-party module identities and their fixed allowed capabilities can be updated in v1.

Installed packages are verified before staging, persisted atomically into private local storage, and selected only on next app launch. Installation never replaces currently executing code or edits workspace/chat data. Keep a previous verified version and the bundled fallback. Compatibility, signature, corruption, rollback, and interrupted installation errors must leave the working version available. Startup/import/render failures recover to a known fallback with a visible error. Each renderer entry exports `{Root}` and contributes through `ModuleSurface` portals; Roots stay mounted across view switches. Native service/API/storage schema changes require a shell update.

Settings exposes installed/bundled versions, Install update (file or HTTPS download), rollback, and clear next-launch status. No update hosting account or remote catalog is configured without a real source. Author tooling builds/signs individual modules so a Chat-only release does not rebuild Notes/Tasks/HQ or Electron.

## Verification

Automated tests cover invalid signatures, incompatible API/capabilities, tampered payloads, interrupted writes, monotonic installs, next-launch activation, rollback, missing/corrupt active artifacts, and package download bounds. Build boundary checks reject module imports from desktop or sibling module internals. Native UI checks use an isolated workspace, prove Notes/Tasks/Chat/HQ and existing menus, and prove installing a newer Chat bundle changes its version while other modules and app build remain unchanged. Restore the regular workspace after all checks.
