# Five audited app fixes — implementation plan

**Goal:** Fix findings 1–5 from `plans/audits/2026-09-14-app-focus.md`, as explicitly authorized by the user.
**Architecture:** Keep feature UI in modules, shared validation/activity contracts in `@zq/module-api`, and native persistence/export behavior in the shell. Existing workspace records remain readable. No connector changes.
**Tech stack:** Electron, React/TypeScript, atomic JSON storage, node:test and isolated Chromium/Electron fixtures.

## Decisions

- Public task new/edit commands navigate to Tasks and open exactly one dialog, preserving supplied note/title context. Cancel closes without creating anything.
- Oversized/invalid workspace edits remain visible as recoverable drafts. Persist a valid projection using previous accepted field values, so valid unrelated changes still save. Show specific field errors, allow returning to the field or saving a copy, and refuse normal close while unsaved invalid input remains. Do not truncate. Shared limits use UTF-8 bytes, record limits, and the 32 MiB serialized workspace cap; native strict validation remains authoritative.
- Native exports write a sibling temporary file and atomically replace the approved destination only after a complete write/fsync. Preserve existing confirmation and report post-commit flush failures accurately.
- A terminal module import failure produces an unavailable module surface while healthy modules and Settings continue to mount. Never relax signature/API checks.
- HQ resumes the last active note; recent list orders by latest open/edit activity. Preserve note/tab order. New edits use timestamps; legacy relative strings display an honest unknown-date label instead of permanent “Just now.”

## Work and verification

- [x] 1. Task commands: add failing cross-module browser assertions; update `modules/tasks/index.tsx`; verify Notes/HQ/search entry, selected text/link preservation, Cancel and save.
- [x] 2. Input boundaries: add pure projection tests before implementation (oversized UTF-8 title/body, valid task alongside invalid note, recovery/correction, aggregate limits). Add shared `workspace-limits` contract, shell draft projection and recovery UI, native constant reuse. Verify real editor input and save/quit guards in an isolated browser/app profile. Task dialog validates fields before success.
- [x] 3. Atomic exports: add failure-injection tests for prior destination preservation and temp cleanup, then implement shared native writer and route all native user exports through it. Run focused native tests; do not change local-file editor conflict semantics.
- [x] 4. Module availability: add aggregate import failure regression; implement unavailable placeholder with Settings navigation and no failed command registration. Verify healthy modules plus Settings and recovery behavior.
- [x] 5. Activity: test order/legacy labels/timestamps/restart; add compatible opened timestamp, keep `updated` accepting legacy strings, update Notes and HQ usage with runtime-derived labels. Ensure tab/sidebar order unchanged.
- [x] Integration: typecheck, focused tests, browser regressions, independent module builds, full shell build/package. Test mutations only in disposable profiles. Update module versions/capability declarations for changed public API; update audit status and document known limits.
- [x] Review complete diff, merge authorized fixes, install verified desktop with previous bundle backed up, restore regular workspace, commit/push.

Verification commands: `npm run typecheck`; `node --test apps/desktop/tests/workspace-drafts.test.cjs apps/desktop/tests/note-activity.test.cjs apps/desktop/tests/export-file.test.cjs apps/desktop/tests/module-loading.test.cjs`; relevant existing storage/files/recovery tests; `node --test apps/desktop/tests/workspace-workflows.browser.cjs`; `npm run build`; `npm run pack`.

Ruling: use a dedicated worktree and separate disposable test profiles; reuse existing dependency installations via local symlinks. User approval of findings 1–5 authorizes these repairs and their coordinated shell release. Audit follow-up investigations and new project functionality stay deferred.

Completed verification and installed versions are recorded in `plans/audits/2026-09-14-app-focus.md`. Implementation commit: `6dbbd34`. Review fixes included preserving saved record identities, projecting excess tabs, exporting recovery text beyond 32 MiB, accepting a UTF-8 BOM and restoring task-dialog focus.
