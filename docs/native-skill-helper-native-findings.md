# Native helper confinement findings

Measured 2026-09-11 on the development Mac. This is an isolated, development-only proof. None of these apps is packaged into the regular desktop app, and no Chat code invokes the helpers.

## Original two builds

```sh
node scripts/build-skill-helper-prototype.mjs
ZQ_TEST_NATIVE_HELPER=1 node --test apps/desktop/tests/native-helper-xpc.test.cjs

node scripts/build-skill-helper-prototype.mjs --app-sandbox-only-probe
ZQ_TEST_NATIVE_HELPER=1 ZQ_NATIVE_HELPER_MODE=app-sandbox-only-probe node --test apps/desktop/tests/native-helper-xpc.test.cjs
```

The default writes `.local-data/skill-helper-prototype/SkillHelperPrototype.app`. The diagnostic option writes `SkillHelperSandboxProbe.app` beside it, using a separate bundle/service identity. Both clients are `Contents/MacOS/SkillHelperPrototype`; the CLI accepts one bounded JSON request on stdin and emits one JSON reply on stdout. `--ping` proves the actual bundled NSXPC service connection. `--cancel-after-ms 250` exercises cancellation during a request.

Both builds have a signed, App Sandbox-entitled XPC service. Worker and bundled CPython carry exactly the App Sandbox and sandbox-inherit entitlements. Neither has a network, user-documents, keychain-access-group, or application-group entitlement. Build signing is local ad hoc signing, not distribution signing or notarization. The CLI parent itself is intentionally not App Sandbox-entitled; the service is the privilege boundary. Runtime dylibs/extensions, Python executable, worker, service, and enclosing app are signed in that order. The build finishes with `codesign --verify --deep --strict`.

The default additionally attempts a deny-by-default Seatbelt policy in the inherited worker before Python starts. It permits resources/system-library reads, only the current job's writes, and only the bundled Python executable. **The OS rejects installation with `Operation not permitted`.** The worker exits 125 before executing request code. There is no automatic fallback. `sandbox_init` is deprecated, and nested installation under this App Sandbox configuration did not work on this Mac. This strict build therefore demonstrates fail-closed behavior, not successful restricted document execution.

The explicitly selected diagnostic build omits only this additional policy attempt. It still runs inside inherited App Sandbox. It exists to measure document compatibility and the limitations of App Sandbox alone using synthetic fixtures; it is not suitable for untrusted imported skills.

## Measured behaviors

| Probe | Result |
| --- | --- |
| Real standalone CLI → bundled XPC service | Pass |
| Strict policy installation failure | Fails closed, exit 125, request code does not run |
| Diagnostic bundled Python execution | Pass |
| Read synthetic canary in a disposable home directory | Denied |
| Read synthetic canary in the host's temporary directory | Denied |
| Create/connect socket to loopback | Denied with EPERM |
| Execute `/bin/sh` with a harmless print command | **Allowed** |
| Execute `/usr/bin/osascript -e 'return 1'` | **Allowed**; no events were sent |
| Fork and call `setsid()` | **Allowed** |
| Write a synthetic sibling directory outside the current job but inside the helper's temporary area | **Allowed**; fixture removed |
| Cancel direct sleeping worker after 250 ms | Terminates and replies in roughly 0.34 s |
| Detached child survives cancellation | **Yes**; synthetic child exited itself after 0.8 s and the test verified ESRCH, with emergency cleanup |
| Raw `os.write` output bypassing Python stream capture | Killed at native transport cap |
| Attempt to grow one file to 65 MiB | OS file-size limit prevents it |
| Sleeping job without cancellation | Native watchdog terminates at roughly 30.12 s |

These are synthetic canaries only. No user secrets were read, no Apple Events were sent, and no normal application workspace was mutated. Missing keychain or Apple Events entitlements are not presented as complete behavioral proofs of every API's denial.

## Limits and lifecycle

The service accepts at most 12 MiB of JSON request bytes and one active job per XPC connection. The hardening pass also enforces one active job per helper identity across client/service processes via a file lock (details below). Each request gets a fresh private directory with mode 0700. The service writes only `request.json`; the fixed bundled runner validates and stages the request's byte inputs. Requests do not supply executable paths or environment configuration. The native request cap is stricter than the runner's standalone cap.

The worker sets hard process limits of 30 CPU seconds, 64 MiB per file, 128 open descriptors, and zero core-file size. The service imposes a 30-second wall deadline and a combined 12 MiB raw stdout/stderr cap. Nonblocking pipe draining prevents a child holding inherited descriptors from hanging service completion beyond the deadline. Connection interruption/invalidation and explicit cancellation signal the worker and its original process group. Completed original groups are also killed, and the service removes its job directory.

**App Sandbox alone does not contain children that detach into another process group.** Its diagnostics prove such a child can survive the direct worker's cancellation. The helper returns without waiting indefinitely for that child's output descriptors, but cannot claim all descendants are gone. There is also no hard RAM cap: macOS `RLIMIT_AS` is not relied on. Per-file limits are not an aggregate disk quota. The newer native watchdog applies only to the Seatbelt variant and is distinct from Python's observational peak RSS. The App Sandbox diagnostic can write elsewhere in its service container and execute other system binaries.

## Validation and decision

The native suite completed with **11 passing diagnostic tests** (one strict-only test skipped), including the real 30-second watchdog. The strict suite completed with **2 passing tests** (ten diagnostic tests skipped). Tests are disabled unless `ZQ_TEST_NATIVE_HELPER=1`; choosing the diagnostic app additionally requires `ZQ_NATIVE_HELPER_MODE=app-sandbox-only-probe`.

A usable native document stack is demonstrated by the separate document compatibility suite, but the original strict confinement experiment is blocked and the App Sandbox-only diagnostic has material isolation/lifetime gaps. Do not connect either variant to untrusted Chat skill execution. The follow-up below improves the measured restrictions, while leaving the supported production architecture unresolved.

## Follow-up: explicit Seatbelt-only probe

```sh
node scripts/build-skill-helper-prototype.mjs --seatbelt-only-probe
ZQ_TEST_NATIVE_SEATBELT=1 node --test apps/desktop/tests/native-helper-seatbelt.test.cjs
ZQ_TEST_NATIVE_HELPER_DOCUMENTS=1 ZQ_NATIVE_HELPER_MODE=seatbelt-only-probe node --test apps/desktop/tests/native-helper-documents.test.cjs
```

This creates `SkillHelperSeatbeltProbe.app`, identity `dev.zq.SkillHelperSeatbeltProbe` and service suffix `.Service`. Neither its trusted launcher nor its Python/worker has App Sandbox entitlements. The worker installs the deny-default Seatbelt policy before executing any Python. A failed installation is fatal. No runtime fallback changes boundaries; conflicting build flags and invalid document/confinement test modes are rejected.

The policy initially installed successfully but Python aborted in dyld's `libignition`. The local OS `dyld-support.sb` explains its root-directory `openat` bootstrap and Cryptex library locations. Explicit root-directory reads and system/runtime executable mappings permit startup. The profile does not import the broader system policy. This OS profile labels its syntax/rules private and subject to change, in addition to the deprecated API warning.

| Seatbelt-only probe | Measured result |
| --- | --- |
| Python job file IO | Allowed |
| Synthetic home/host-temp file content reads | Denied |
| Sibling file write outside job | Denied |
| Symlink to synthetic host file, read and write | Denied; original bytes preserved |
| Loopback socket access | Denied |
| `fork` and `posix_spawn` of bundled Python | Denied |
| `/bin/sh` through subprocess or direct `execv` | Denied |
| Re-exec allowed interpreter, retry network | Still denied |
| Cancel after worker emits start marker | Killed; reply roughly 1.13 s with cancellation scheduled at 1 s |
| Locked root/nested-directory cleanup | Removed |
| Cleanup of symlink to external synthetic directory | Link removed; target bytes and mode unchanged |
| DOCX/XLSX/PPTX/PDF roundtrips | All four pass |

Ten native tests pass, plus four document fixtures and the existing isolated viewer test. Child-process denial prevents the tested fork/spawn detachment route; this is not a proof against all possible OS exploitation. Host file **contents** are restricted, but the policy intentionally permits broad filesystem metadata and sysctl reads. System resources and `/dev/null` are exceptions to a literal job-only description.

Service cleanup saves a root directory descriptor before launch and uses descriptor-relative `fstatat`, `fchmodat`, `openat` and `unlinkat`, with no-follow flags and an inode/device check before directory descent. The descriptor is close-on-exec. This fixes a reproduced permissions-zero cleanup failure. Traversal depth is bounded. Cleanup and lease release now precede the reply; incomplete cleanup returns an error and no files. No claim of unconditional cleanup or containment of the older diagnostic's detached children is made.

## Caller, admission, and resource hardening

The build now signs `Contents/MacOS/SkillHelperPrototype` as a separate caller executable with hardened runtime, extracts its CDHash, and compiles the exact requirement into the service. `SkillHelperLauncher` is the app's outer entry point and forwards arguments to that caller. This avoids a circular dependency between the caller signature and the embedded service's resource seal. The service checks effective UID and calls `setCodeSigningRequirement` before `resume`; macOS checks incoming peer messages, avoiding a PID-only authentication race. The API requires macOS 13 or newer; older systems fail closed.

The native test first pings the legitimate app and an unmodified disposable copy. It then re-signs the copied caller with the same identifier but different signature flags, reseals/verifies the copied bundle, and verifies an XPC error instead of a ping reply. This proves code-hash enforcement, not release identity or user-intent authorization. An unchanged copy of the authorized caller is accepted. Ad hoc signing and development-writable build products are not a distribution trust chain.

`JobLease.swift` opens a protected owner-only temporary directory and stable regular lock file using no-follow/close-on-exec flags. It verifies ownership, permissions and link count, then obtains a nonblocking exclusive `flock`. Holding that lease through worker termination and cleanup prevents a second normal job across client/service processes for the same helper identity. The lock file is retained on release to avoid competing lock inodes. Normal completion and cancellation are covered; service-crash worker supervision is not. If the service dies, its lock releases but its worker is not proven to die with it, so crash-time overlap remains a limitation.

The Seatbelt service's C watchdog samples approximately every 50 ms, outside Python:

| Measurement | Threshold |
| --- | --- |
| Maximum of worker resident size and physical footprint | 256 MiB |
| Reachable regular-file logical sizes in the job, including sparse sizes | 64 MiB |
| Descendant directory entries, including symlinks/special files | 4,096 |
| Entry depth beneath job root | 64 |

The scanner reopens the root descriptor with an independent directory offset on every pass; it does not follow symlinks or open special files. Per-pass work/depth are bounded. It uses `proc_pid_rusage` with `RUSAGE_INFO_V2`, declared in the local SDK's `libproc.h` and `sys/resource.h`. A final filesystem-only pass runs after exit, catching fast jobs between samples. Unreadable or inconsistent accounting fails closed. This can reject a job that changes permissions or directories while being scanned; it is deliberate prototype behavior.

**These are sampled thresholds, not kernel quotas or an atomic snapshot.** Overshoot is possible. Open-but-unlinked files can consume disk without appearing in the directory walk, and metadata/xattr allocation is not counted. Memory counters cover the worker, not service/client memory. The worker-only measurement depends on the Seatbelt fork/spawn denial; it is not enabled for the App Sandbox-only diagnostic where children are permitted.

Reproduce additional checks:

```sh
ZQ_TEST_NATIVE_CONTROLS=1 node --test apps/desktop/tests/native-helper-controls.test.cjs
xcrun clang -std=c11 -Wall -Wextra -Werror apps/desktop/native/skill-helper-prototype/ResourceMonitor.c apps/desktop/tests/native-helper-resource-monitor.test.c -o .local-data/native-resource-monitor-tests
.local-data/native-resource-monitor-tests
```

All six new auth/resource/admission tests and the standalone C scanner suite pass. The ten Seatbelt confinement/cleanup tests and four document workflows pass after integration. No test data was added to the user's normal workspace.

Remaining production blockers: deprecated/private boundary APIs, an unsandboxed trusted launcher/parser, distribution signing and caller-role policy, hard quotas and crash supervision, OS-version validation, and hostile-output integration into the host artifact store. Existing per-process/per-file/wall/output limits remain. These synthetic tests do not establish complete Keychain, Apple Events, Mach-port, or inherited-descriptor isolation. Keep all three variants out of Chat execution.

Apple references: [App Sandbox inheritance entitlements](https://developer.apple.com/library/archive/documentation/Miscellaneous/Reference/EntitlementKeyReference/Chapters/EnablingAppSandbox.html) and [Protecting user data with App Sandbox](https://developer.apple.com/documentation/security/protecting-user-data-with-app-sandbox). The local macOS `sandbox_init(3)` manual explicitly marks that API deprecated; the EPERM result above is an observed runtime result, not an inference from documentation.
