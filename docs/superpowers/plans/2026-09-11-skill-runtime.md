> Superseded by the native helper prototype on 2026-09-11. Docker is not the default runtime. Retained as design history.

# Local Skill Runtime Implementation Plan

> **For agentic workers:** Execute bounded tasks with independent implementation review and final verification.

**Goal:** Installed skills can create real artifacts by running Python/JavaScript inside a local isolated container.
**Architecture:** Native Docker runner receives bounded staged bytes on stdin; native Chat routes an execution tool through existing permissions and validates outputs before publishing artifacts. Module UI reports setup state and actual execution activity.
**Tech Stack:** Electron/Node subprocess API, Python container runner, Docker, existing React/Radix UI.
**Spec:** docs/superpowers/specs/2026-09-11-skill-runtime.md

## Global constraints

No imported host execution, mounts, networking or credentials. Preserve standard package paths and bytes. Honor selection snapshots and existing approvals. Tests in disposable directories only.

## Tasks

- [ ] Runtime image and trusted runner: add apps/desktop/electron/skill-runtime-image/{Dockerfile,runner.py,package.json,requirements.txt}. JSON stdin {language,code,files:[{path,data}]}; write under /work/skill and /work/inputs, execute under /work, collect only /work/output document files. stdout JSON {stdout,stderr,exitCode,files:[{name,data,mime}]}. Test traversal, symlinks, size limits, subprocess cleanup and generated Office documents in container.
- [ ] Native runtime: add skill-runtime.cjs plus tests. Fixed Docker executable discovery, inspect/build pinned image, enforce run arguments and process limits, kill/remove on cancellation. status() returns ready/engineStopped/missing/imageMissing with human-readable detail; setup() builds bundled Dockerfile using bounded native invocation. Never accept image/command/path from model.
- [ ] Tool integration: add chat-skill-execution.cjs and tests. run_skill_code exact loaded skillId, python/javascript source, optional scoped artifact inputs. Stage snapshot package bytes with integrity checking, validate outputs using artifact-document-validation, commit records only after check(). Extend native activity validation and shared type with run_skill_code. Wire through ChatInteractions and provider local tools.
- [ ] Skills UI: native IPC and shared bridge for runtime status/setup; compact status with Set up/Refresh actions. Execution details use existing collapsible activity and copy/context actions. Remove unconditional claims scripts cannot run; explain loading does not itself execute.
- [ ] Verify/release: run native suite, module types/build, real isolated Docker smoke for documents, independent review. Update runtime docs, capability/version and signed module build against current shell API, package/reopen only after checks pass.
