# Chat skills

Skills are reusable instructions and reference files, managed in **Settings → Skills**. Create a skill, give it a recognizable name and optional description, write its instructions, and attach text or PDF references. Skills can be selected explicitly or loaded automatically when relevant on models that support local tools.

The library and composer picker share **Edit, Rename, Duplicate, Export, and Delete** actions through right-click menus and visible three-dot menus. Reference files offer Preview and Remove in both menus. Editors retain unsaved text after failures and ask before discarding it; pending operations or unsaved edits prevent a clean app quit until resolved. Changes to reference files on an existing skill save immediately, as indicated in the editor.

## Importing skills

Choose **Import skill** in Settings → Skills. Select `SKILL.md`/Markdown, a ZIP/.skill package, or use the folder action. Review instructions, requirements, and supporting files before saving. Import creates a new skill; it never replaces or automatically activates a library item. Canceling changes nothing, and failed imports remain available for retry.

A package must contain one root `SKILL.md`, or one enclosing folder with `SKILL.md`. Nested resources retain their paths and original bytes, including scripts and binary assets. YAML metadata is retained. Package file previews distinguish attached context from files preserved only for export. Text can be previewed; stored resources can be saved through a native dialog. Scripts never execute on import. Legacy `.zqskill.json` files are accepted for migration.

Markdown is limited to 1 MB; packages to 10 MB and 200 files including `SKILL.md`. Ambiguous packages, invalid paths, symlinks, corrupted archives, and oversized files fail before library storage changes.

## Browsing skills

**Browse** offers a curated starter collection: document coauthoring, internal communications, Word, PDF, spreadsheets, and presentations. Search filters this collection. Preview downloads the public upstream package at a pinned GitHub commit and opens the same import review. Each entry exposes Preview, View on skills.sh, and View source through right-click and visible menus.

Requirements appear before import: document-tool packages include scripts and dependencies zQ does not execute yet. **Explore skills.sh** opens the full directory. Full in-app skills.sh search requires Vercel OIDC authentication and is not configured; see [interoperability](interoperability.md).

## Choosing skills

- **Chat:** Open **+ → Skills**. Enable individual skills, choose No skills, or use the project's selection. The count shows how many are enabled. The attachment menu's View context shows the instructions and references that will accompany the next message.
- **Project:** Open the project and use its Skills control. Chats inherit that selection unless they have their own override. Project changes apply to future messages.
- **Drafts:** Selection survives navigation and restart, including selection made before a first message creates its conversation.

Each sent user message stores the exact skill instructions and reference text used. Retrying, branching, and reopening that history retain the saved content even after a library skill is changed or deleted. A later ordinary message uses the current selection and current library content. Deletion removes the skill from future selections without deleting historical snapshots.

## Limits and export

The library supports 100 skills. Each skill allows a 256-byte name, 4,096-byte description, 1 MB of instructions, ten active text/PDF references, and up to 2 MB of stored instructions plus extracted reference text. A message may enable ten skills; their context shares the existing 100 KB reference budget with project instructions, project files, attached files, and notes. Importing a large skill does not bypass this request budget; the context inspector reports oversized activation.

Export writes `SKILL.md` when there are no resources, otherwise a ZIP containing a standard skill directory. Original YAML and resource bytes are retained; edited name/description fields are reflected in the export. Extracted-only references export as text. Removing a context attachment does not delete its original packaged file.

## Implementation and compatibility

The Chat module owns the library, menus, editor, picker, and selection controller. The desktop host owns validation, atomic storage, file extraction, IPC, and prompt assembly. Native skill records use optional additive Chat store fields. Public attachment metadata omits extracted text; the host resolves it for previews and requests.

Chat **1.13.0** requires **skills.v1**, **skills.import.v1**, **skills.packages.v1**, **skills.catalog.v1**, **skills.updates.v1**, **skills.recognition.v1**, and the accompanying shell update. The host exposes a `skillsSettings` ModuleSurface slot and `openSettings('skills')`. Older shells reject the module's unsupported capability; bundled fallback and signing rules remain unchanged.

## Verification

- `npm test`: native library CRUD, validation, reference bounds, failed-write atomicity, persistence, draft transfer, inheritance/override, historical snapshots, and other existing app regressions.
- `node apps/desktop/tests/skill-import.browser.cjs`: import review, reference preview, cancellation, failed-save retry, and pending-operation guards.
- `node apps/desktop/tests/skills.browser.cjs`: isolated library and picker interactions, menus, keyboard use, failures, dirty edits, and reference handling.
- `node apps/desktop/tests/skills-chat.browser.cjs`: isolated actual chat controller/composer selection behavior.
- `node apps/desktop/tests/skills-shell.browser.cjs`: actual shell Settings portal, Appearance preservation, modal shortcut guards, and Escape navigation.
- `node apps/desktop/tests/artifact-revisions.browser.cjs`: existing artifact generation/revision and pane navigation regression.

Mutation tests use temporary stores or in-memory browser fixtures. They do not add data to the regular workspace or call paid providers.


Package and catalog checks: `node apps/desktop/tests/skill-packages.browser.cjs` and `node apps/desktop/tests/skill-browser.browser.cjs`. Native tests also cover ZIP/folder round trips, resource persistence and failed-write rollback, bounded downloads, and curated source validation.

Chat 1.11.0 verification: 559 native tests (558 pass, one existing skip), TypeScript, package/import/catalog/shell browser checks, all six public upstream previews, signed module compatibility, and packaged native dependencies passed. Mutation tests used isolated stores and fixtures.

## Installed skills and updates

Chat 1.12.0 records the catalog source and the Git tree revision of that specific skill when importing through Browse. Catalog rows show Installed immediately, including after renaming the library skill. **Check for updates** reads public repository metadata, without downloading all packages. Rows then show Up to date or Update available with the last check time. Network/rate-limit failures are shown explicitly; a failed check cannot present an old result as freshly verified.

Previewing an installed skill opens an update review. Updates require an explicit **Update skill** action and replace the skill's instructions, active references, package files, and metadata. The existing name is kept by default, along with its library identity and chat/project selections. Previously sent messages retain their original snapshots and resources. Local changes are identified in the review; duplicate the library skill first if you want a separate personal copy. Duplicates are detached from catalog tracking.

If the installed content changes while a review is open, the host refuses to overwrite it and asks for a fresh review. Updating does not consume another library slot. Reimporting a tracked catalog skill is rejected to prevent accidental duplicates.

ZIP, folder, and Markdown imports without a known catalog source remain untracked. For older imports, Browse recognizes exact known curated packages from bundled content fingerprints and records their original source revision. Display names alone never identify a skill. Standard exports stay portable and do not add a proprietary tracking manifest.

Chat 1.12.0 verification: 573 native tests (572 passed, one existing skip), TypeScript, installed/update, import and package browser checks, independent catalog/UI review, and live public previews/import/restart baseline checks for all six curated skills. Mutation checks used temporary stores. Signed single-module checks verified the new shell capability and rejection by the older shell.


## Existing import recognition

Browse reconciles older source-less imports against bundled fingerprints of the six curated packages. A match requires exact instruction text, retained YAML and all packaged resource paths, sizes and content hashes. Library names and active-reference selection can differ. Only source metadata is added; existing IDs, instructions, resources, references, timestamps and selections stay intact. This works offline, does not reinstall the package, and records the known installed revision rather than assuming it is the latest. A separate online check determines whether updates exist.

Changed packages, unknown packages and ambiguous identical copies remain unlinked. Personal duplicates explicitly opt out of automatic recognition. Exact fingerprints are catalog compatibility data shipped with the app, not a proprietary skill format.

## Composer access

Use **+ → Skills** for installed skill toggles, project inheritance, No skills, Manage skills and Browse skills. The project picker remains available on project pages. Manage opens the library; Browse opens the curated catalog directly.

Type `/` in the composer to filter installed skills. Arrow keys move through choices; Enter enables the highlighted skill and inserts its blue `/skill-name` command into the draft, preserving the surrounding text and placing the caret after the command. Deleting a command removes its skill selection. Escape dismisses the picker. Explicit selection respects the same ten-skill limit and does not grant executable access to packaged scripts. Ordinary requests can automatically load relevant installed skills when the selection is Automatic and the model supports local tools.

Chat 1.13.0 verification: 577 native tests (576 passed, one existing skip), TypeScript, composer/slash and existing chat/shell browser suites, legacy Installed badges, artifact revision regression, and signed single-module compatibility passed. The user's four existing document-skill records were checked read-only, then recognition was tested on an isolated copy: all four matched with IDs/content/references unchanged. No test mutations were made in the regular workspace.

Chat 1.14.1 keeps selected slash commands visible in the native composer, with a non-interactive colored text overlay. Normal selection, typing, paste, keyboard input and scrolling continue through the textarea. Slash selection, deletion, surrounding text/caret, scrolling, actual sent text+skill IDs and queue regressions are verified in isolated browser fixtures.

## Automatic selection and visible activity

Chat 1.15.0 defaults to **Automatic** when neither the chat nor its project has an explicit skill selection. The model receives a bounded catalog of installed names and descriptions, then calls `use_skill` to load relevant instructions and attached reference text before working. Full instructions for unrelated skills are not sent. Selection depends on the model following its tool instructions; models without local-tool support still accept explicitly selected skills but cannot discover and load them automatically.

Explicit `/skill-name` commands and menu selections restrict the request to that selection. **No skills** stores an explicit empty selection and disables automatic discovery. A project with configured skills—including an explicit empty list—takes precedence when the chat uses project settings.

Successful loads produce a native **Using <skill name>** activity, independent of the provider's thinking text. Expand it to see whether selection was automatic or explicit, its description and the reference names loaded. Copy name and Copy details are available in the expanded activity and its right-click menu. Preserved package resources remain distinct from executable tools; this release does not execute skill scripts.

A message or queued item freezes its discovery catalog and content fingerprints. Editing, deleting or replacing a candidate before it loads returns a clear tool error rather than silently using different content. Successfully loaded instructions and references are saved with the sent message; retries reuse those exact snapshots even after a library edit or deletion. Auto-loaded skills do not change the chat's explicit selection. Loading is limited to ten skills and shares the existing 100 KB reference budget; failed loads never create a successful activity.

This release requires the `skills.activation.v1` shell capability for the native loading tool, catalog snapshots and activity records.

Chat 1.15.0 verification: 631 native tests (630 passed, one existing skip), TypeScript, isolated activity/composer/project opt-out, queue and Settings browser checks, and the actual Anthropic adapter with simulated responses loading a skill before rendering a real DOCX. Independent review fixes cover 512-byte reference filenames and unconfigured project opt-out. Signed single-module checks passed against the target shell and rejected the older shell. All mutation tests used isolated fixtures or temporary stores.
