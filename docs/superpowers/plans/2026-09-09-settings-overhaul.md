# Settings overhaul

Initial request: overhaul settings. The user subsequently clarified that separate settings pages were wanted, but the original Appearance design was loved and its replacement was not approved. Existing provider credentials, module updates and appearance persistence stay native/service-owned.

Design read: a restrained desktop settings interface using the existing neutral theme, Phosphor icons and shared shadcn/Radix controls. Low visual variance (3), restrained motion (2), compact readable density (6).

| Before | After | Why |
| --- | --- | --- |
| Hero copy and decorative footer | Short panel title and useful description | Settings should lead with controls |
| All sections stacked; navigation scrolls | Active sidebar category, one visible panel | Each task has a clear destination |
| Large theme and palette cards | Compact labeled rows and shared selectors | Appearance takes two rows |
| Edit/Test/Delete on every provider row | Named provider row, explicit test action, shared action menu plus right-click | Clear actions with less visual clutter |
| Repeated inactive module rollback buttons | Versions and status with contextual actions | Keep uncommon maintenance controls in a menu |

- [x] Add an optional `openSettings(section)` host helper and shell-owned active category. Preserve old-module navigation compatibility.
- [x] Replace Settings and its sidebar with selected sections, compact appearance rows, and neutral scoped styles. Keep the connections portal and module updater mounted while switching sections.
- [x] Add a shared shadcn/Radix dropdown-menu composition using the existing context-menu tokens. Apply consistent actions to provider and module rows.
- [x] Verify actual UI navigation, theme/color persistence, provider editing/context menus and Chat's Manage connections shortcut in the isolated workspace. Check both light and dark appearance.
- [x] Run existing automated suite, TypeScript/build/package; reopen regular workspace.

No new settings without implemented behavior, no native/storage migration, no unrelated navigation redesign. Visual changes are verified in the app rather than implementation-mirroring tests.

Verification: 215 automated tests passed, zero failed, one opt-in Keychain test skipped. Final TypeScript/build/package passed. Isolated packaged UI verified one-panel navigation, light/dark appearance, accent selection and persistence, provider dropdown/context-menu parity, edit-dialog focus, compact live Ollama test results (13 models), module menu-to-URL-dialog focus return, and Chat Manage connections landing directly in Connections. Read-only code review found no important defects. Native provider/storage behavior is unchanged.

## Appearance correction

The user approved restoring the original Appearance hero, three theme preview cards and four palette cards, with their original styles and responsive spacing. Keep the separate Appearance, Connections and Modules pages. Discuss any further settings design changes with the user before implementing them. The compact Appearance rows and color popover above are superseded.

Correction verification: TypeScript/build/package passed. The isolated packaged app was visually checked in Light/Gunmetal and Dark/Green; original theme and palette cards render and selection updates correctly. Connections and Modules each remain separate pages, and Appearance selections survive category navigation. Test preferences were restored and the regular workspace reopened.
