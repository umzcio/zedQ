# Standard Skills Implementation Plan

User approved standard SKILL.md plus ZIP supporting files and interoperability across skills/connectors/plugins. Use independent native format/storage and feature UI tasks in parallel; root integrates host, schema, docs and verification. Existing checkout has no git metadata. All tests use temp stores/in-memory fixtures.

## Design

- Import SKILL.md/Markdown and .zip/.skill (ZIP) containing one SKILL.md at root or in one enclosing folder. Directories can be selected through a separate native folder action. Preserve all relative resource paths, original bytes (including scripts/assets), and YAML metadata. Multiple skills/plugin archives return a clear format message, never silently choose one. Legacy zqskill.json accepted for migration only, never newly exported.
- Native package bytes stored once by SHA256 in skill-resources under isolated store root; ChatSkill.package={frontmatter:string,resources:[{path,digest,size}]} stores immutable references. Public metadata and sent snapshots keep small references, never raw binaries. Original frontmatter YAML retained, exported with current name/description and exact instructions. Unknown metadata is retained, requirements shown rather than discarded.
- Import preview SkillImport.package={frontmatter,resources:[{path,data:base64,size}]} plus existing name/description/instructions/files/warnings. Validation before commit. Import creates fresh identity, copies resources then atomic chat metadata commit; failed metadata commit must not create visible library item. Bytes are immutable, shared across duplicates/retries. No scripts execute or permissions change on import.
- Archive limits: 10 MB compressed/total resources, 200 entries, 1 MB SKILL.md, no symlinks/encryption/path escapes/duplicates. Resource paths validated centrally. Folder reads enforce same bounds, never follow symlinks. Read ZIP in memory, no extraction to arbitrary paths.
- Store instructions up to 1 MB, description up to 4096 UTF-8 bytes (1024-character standard metadata), ten explicitly active text/PDF references, combined stored text up to 2 MB. Existing 100 KB per-request skill/project/reference limit remains and inspector reports oversized activation. New import auto-adds bounded readable reference files, preserves all other package files and indicates which are not context. Scripts/assets are preserved and previewable/downloadable, never auto-executed.
- Export SKILL.md alone when no resources, otherwise slug.zip containing slug/SKILL.md and original resources. Existing extracted-only attachments export honestly as text references; preserve original binary resources from imported packages. Generate valid lowercase-hyphen export name and nonempty description when library labels are nonstandard. Preserve optional fields/license/compatibility/metadata/allowed-tools in YAML. Avoid overwriting resource paths on collisions.
- Shared package files component used in import preview and editor: list relative paths, context status, Preview and Save file where available; right-click +visible menus. Import resources remain linked to package (removing a context reference doesn't delete archive source). Existing dialogs/focus/pending guards reused.
- Native resource preview/export only resolves path under selected existing skill metadata, never caller-supplied filesystem paths. No unsupported-script execution claim. Connector/plugin standard-first policy records MCP protocol plus ecosystem manifests/adapters; does not claim one universal plugin format or ship connector execution in this task.

## Work

- [x] Native package codec: ZIP/Markdown/folder import, YAML retention, standard export; bounded safe resource paths/metadata. Tests round-trip all bytes/path/metadata, hostile archive paths, caps, multiple roots, UTF8, legacy migration.
- [x] Resource storage: content-addressed immutable files, validated read/write, skill package schema/public metadata, persistence/snapshot compatibility. Tests restart, corruption, failed writes.
- [x] Host integration: parser/readers, export Save dialog, resource preview/save IPC, skill methods; module-api fields, new skills.packages.v1 capability/version1.11.0.
- [x] UI: import formats +folder affordance, package file list/actions, editor requirements/context status, preserve package on edits/duplicate.
- [x] Product convention/docs: interoperability requirement in AGENTS.md, specifications and documented compatibility limits.
- [x] Validation: full tests/TypeScript/browser, scoped review, signed single-module compatibility; clean quit, pack, verify package, reopen regular app.

## Curated browser extension

- [x] Read documented skills.sh API; confirmed unauthenticated endpoints require Vercel OIDC. Asked optional preference and proceeded curated-first after no reply. Full API search is explicitly deferred until an authenticated connection exists.
- [x] Six curated Anthropic packages, local search, public source/catalog links, pinned-commit previews, existing import review, right-click/visible action parity. No automatic activation or script execution.
- [x] All six live public packages download and parse without library mutations. Added compressed response regression: encoded Content-Length does not bound decoded bytes; streaming bounds still apply.
- [x] Browser review/search/retry/focus/pending/full-library tests and standard package/import browser checks pass; screenshots inspected.
- [x] Final storage review fixes, regression suite, signed shell/module verification, packaging and regular app relaunch.

Final verification: 559 native tests (558 passed, one existing skip), TypeScript, package/import/catalog/shell browser checks, all six live public previews, signed single-module build against the updated shell, packaged native services/dependencies and signatures verified. Clean quit before packaging; regular app reopened.
