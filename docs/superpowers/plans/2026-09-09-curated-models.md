# Curated provider models

Approved design: provider setup with actual logos and opt-in model selection; searchable per-provider checklist; one grouped searchable Chat selector; favorites/default/hide actions in right-click and accessible menus. Newly discovered models are not automatically selected. Preserve chats and Appearance.

Architecture: native ChatStore persists connection enabledModels/favoriteModels and a global defaultModel choice. Chat renders only saved choices without fetching every provider when opening the picker. Manage models fetches the provider catalog explicitly. Existing connections migrate only model IDs used by their conversations. No secret or provider transport changes.

Contracts: ModelChoice={connectionId:string;model:string}; public Connection adds enabledModels:string[],favoriteModels:string[]; ChatSnapshot adds defaultModel:ModelChoice|null. ChatBridge.saveModelPreferences({connectionId,enabledModels?,favoriteModels?,defaultModel?:string|null}) returns ChatSnapshot. Native validation enforces bounded unique model IDs, favorites/default subset of enabled IDs. Editing credentials preserves preferences; hiding/deleting clears invalid default but preserves conversation model/history.

- [x] Native persistence, migration, IPC and regression tests for validation, failed saves, restart, hide/default cleanup and connection edits.
- [x] ProviderLogo component, local official logo assets and attribution; useful model-name formatting preserving unknown/local IDs.
- [x] Provider setup and searchable model checklist with explicit save, selected count, Select all/Clear all, refresh and error handling. Existing connections expose Manage models through button/context menu.
- [x] Unified model picker grouped by provider and Favorites, search, current/default marks, right-click and ellipsis actions. New chats honor default, then an enabled prior model, then first enabled choice.
- [x] TypeScript/full tests/build; verify packaged UI in isolated workspace against known Ollama only. Check keyboard Escape layering, selection persistence, model hiding/history and switching. Reopen regular workspace. Update module capability/version for native API requirement.

Boundaries: modules/chat owns feature UI; native host owns durable storage. Shared shadcn/Radix controls and Phosphor action icons. No paid inference tests, no fake model metadata, no changes to Appearance or Chat sidebar design.

Verification: 226 tests passed, zero failed, one opt-in Keychain test skipped; TypeScript/build/package passed. Packaged isolated UI verified selected-only setup using 13-model known Ollama catalog, model checklist/save/search, unified grouping, favorites/default/hide and old-chat preservation, keyboard search/selection/composer focus, menu focus after row moves, Escape layering, successful streamed greeting, and restart persistence. All six provider marks visually checked in light and dark. Reviewer caught setup selections retained across endpoint/catalog changes; successful discovery now intersects selection with the returned catalog and reviewer confirmed the fix. Temporary test provider deleted, isolated appearance restored, regular workspace reopened.
