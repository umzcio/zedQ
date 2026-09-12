# Supported document helper implementation plan

> Use executing-plans and test-driven-development. Independent native worker and host transport tasks use dispatching-parallel-agents. All work is in the isolated document-helper worktree.

**Goal:** Create real documents through a bundled fixed-operation App Sandbox helper and connect it to existing Chat/Skills/artifact flows.
**Architecture:** Electron host → signed caller app → App Sandbox XPC service → inherited supervisor/worker → pinned Python fixed renderer. Source parsing and artifact persistence stay in trusted host services.
**Spec:** docs/superpowers/specs/2026-09-12-document-helper-design.md

## Contract and ownership

Worker request: `{version:1,operation:'render_document',document:{format,title,blocks,typography}}`. Blocks follow `artifact-renderer.cjs` parseContent (`heading`, `paragraph`, `list`, `code`, `table`). Worker response: `{version:1,ok:true,file:{name,mime,data},warnings:[]}` or `{version:1,ok:false,error:string}`. Native service may return its existing `{exitCode,error,files:[]}` transport error; host rejects all unsuccessful/malformed envelopes.

Native entry point: `native/bin/DocumentHelper.app/Contents/MacOS/DocumentHelperLauncher`, accepting one stdin request per launch. Resources are inside the embedded XPC bundle. The host resolves the path from its configured app resources; no request chooses it. Host factory: `createDocumentRenderer({helperPath,spawnImpl?})` returns async `(input,{signal}={}) => {name,mime,data,previewText?}`. The host calls the existing parser to construct blocks and validates output with artifact-document-validation.cjs.

## Tasks

- [x] Worker: add Python tests first for valid DOCX/XLSX/PPTX/PDF contents, strict unknown-key/operation rejection, limits, safe literal formula-looking input and typography. Implement only the structured renderer in `apps/desktop/native/document-helper/renderer.py`; no exec/eval/subprocess or model paths. Test against pinned Python/wheels.
- [x] Native service/build: add native contract/lifecycle tests, then production-owned caller, protocol, service, worker and signing/build path; reuse reviewed supervisor/lease/cleanup through explicit shared source inputs or copied production-owned code. Verify App Sandbox entitlements and actual XPC render/cancel/crash behavior. Bundle runtime provenance/licenses.
- [x] Host transport: write tests with controlled child processes for queueing, abort/timeout, response bounds/schema, format mismatch and independently invalid document output. Implement `document-helper.cjs`, export/reuse artifact parser, and preserve caller-chosen filenames and preview text safely.
- [x] Integration: configure ArtifactService renderer in Electron main; forward run AbortSignal through document executor; maintain check-before-commit and version conflict checks. Update Chat/skill guidance/activity and capability declarations. Test real helper create/revise and cancellation without artifact commits.
- [x] Local verification: full native and JS tests, typecheck, visual document preview checks in isolated data, signed module and packaged build. Integration follows these checks: commit/integrate/push, verify CI and restore the regular app. Record limitations accurately.

Commands: `npm test`, `npm run typecheck`, `npm run test:ui`, `node scripts/build-document-helper.mjs`, signed `npm run pack`. Platform tests use a disposable ZQ_DATA_DIR. No tests write to the normal workspace.

Local results: 708 JavaScript tests (656 pass, 52 platform/development cases skipped), 22 Python tests, 12 real native/Chat tests, native font preview and artifact revision browser fixtures, shared UI test, typecheck and packaged build passed. Packaged smoke created all four formats and displayed the actual DOCX in the right-hand pane. Review found and fixed cancellation/admission races and native verification found and fixed MIME initialization and template font overrides. Release identity signing/notarization remains outside local verification.
