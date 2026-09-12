# zQ product conventions

- For every new list, collection, tab, card, or user-owned item, explicitly consider its right-click actions. Include useful context menus as part of the initial implementation; do not wait for a follow-up request. Keep actions consistent anywhere the same item appears.
- Use shared shadcn/Radix menus, dialogs, popovers, and selects. Preserve keyboard access and focus behavior.
- Projects expose Rename, Settings, Edit icon, and Delete. Icon editing uses a grid of outline icons with color swatches.
- Keep the UI compact with neutral light/dark surfaces. Avoid decorative controls without functionality.
- The zQ logo is the header's home shortcut. Every module sidebar uses the same heading/collapse placement.
- Test mutations in an isolated workspace and restore the regular workspace afterward. Never add test data to the user's normal workspace.

# Module boundaries

- Feature UI, stateful controllers and feature styles belong in `modules/<name>`. The desktop app owns the frame, native services, trusted loading and durable storage. Never import feature implementation into the shell or sibling module internals.
- Use `@zq/module-api` for host capabilities/commands and `@zq/ui` for shared components. Each module exports a persistent `Root` that contributes through `ModuleSurface`; preserve controllers across navigation.
- Module update packages must be signed by a shell-trusted identity and compatible with the declared API. Stage updates/rollback for next launch, and keep bundled fallbacks. Native service and storage-schema changes require a shell update.
- Before releasing a module independently, run the single-module build and verify it against the target shell API. Keep signing keys private and out of app packages. See `docs/modules.md`.

# Interoperability

- Use published formats and protocols for skills, connectors, and plugins. Skills use standard `SKILL.md` packages; MCP integrations use MCP; plugins use explicitly supported ecosystem manifests/adapters. Do not require proprietary zQ wrappers where a standard exists.
- Preserve imported metadata, relative resource paths, and original bytes. Distinguish successful import from supported runtime capabilities, and explain unsupported tools/dependencies before activation. See `docs/interoperability.md`.
