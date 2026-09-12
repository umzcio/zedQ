# Native skill helper: prototype result

Measured on 2026-09-11, Apple silicon, macOS 26.6.2. **The document stack works without Docker, including under a per-job Seatbelt policy. A supported shipping boundary for arbitrary imported code is still unresolved.** This is a development prototype, not a newly enabled Chat capability. The regular app and module release remain unchanged.

## What was built

A standalone prototype app communicates with its embedded Swift XPC service. A separately signed caller executable keeps its CDHash stable while the outer app seals the service; the build compiles that hash into the service's XPC peer requirement. The service accepts the same effective user and exact caller signature before dispatching messages. It stages bounded request bytes in a fresh private directory, then launches a signed worker and a bundled CPython 3.12.14. Interpreter source is pinned by URL, size and SHA-256; all Python library versions and transitive distribution hashes are locked. Packages are installed only into the prototype runtime. The runtime retains bundled license metadata and does not include third-party skill source packages.

The generic request is `{code, files:[{path,data}]}`. Staged paths must be inside `inputs/` or `skill/`; original bytes and relative resource paths are preserved. No runtime declaration or proprietary wrapper is added to `SKILL.md`. The experiment has no connection to the normal Chat store, Artifacts library, Notes or Tasks.

Three explicit builds distinguish the experiments:

- **Strict default:** inherited App Sandbox plus an attempted narrower Seatbelt policy. macOS rejects the additional policy with EPERM. The worker fails closed before Python executes.
- **App Sandbox diagnostic:** separately named and built only with `--app-sandbox-only-probe`. It retains App Sandbox and allows synthetic document/probe code to measure compatibility. It is not an automatic fallback and must not be exposed to imported skill code.
- **Seatbelt-only experiment:** separately named and built only with `--seatbelt-only-probe`. The trusted launcher has no App Sandbox entitlement; the worker must install a deny-default policy before Python starts. This passes the four document fixtures and blocks tested host-content reads, out-of-job writes, sockets, fork, spawn and system executable replacement. It relies on deprecated `sandbox_init` and private policy syntax. It is not a supported production replacement for App Sandbox.

See [native confinement findings](native-skill-helper-native-findings.md) for exact entitlements, process limits, native tests and limitations.

## Document results

All four fixtures passed through the real diagnostic XPC service and bundled interpreter. Each creates, reopens, edits and checks a synthetic document. The host independently checks filenames/base64/size and Office ZIP structure. The actual output bytes then open in zQ's existing isolated artifact viewer, with no external resource requests. The preview test exercised both workbook sheets, the third presentation slide, and both PDF pages. Screenshots were inspected, including the filled PDF field and preserved text.

| Workflow | Result | End-to-end time | Worker peak RSS | Output |
|---|---|---:|---:|---:|
| DOCX | Edited a run; preserved other text, formatting, table, header/footer | 762 ms | 55.0 MiB | 37,947 bytes |
| XLSX | Edited an input; preserved formulas, formatting and another sheet | 308 ms | 43.3 MiB | 5,605 bytes |
| PPTX | Edited a shape and added a slide; preserved picture bytes and other shapes/slides | 366 ms | 50.6 MiB | 30,670 bytes |
| PDF | Created, merged, split and filled an AcroForm; preserved the second page | 404 ms | 84.7 MiB | 4,065 bytes |

These are individual small-fixture observations on one development Mac, not benchmark guarantees. End-to-end time includes client/service startup, imports, generation and structural checks, but excludes browser preview. Worker RSS is observed with `getrusage`; it excludes the client/service and is **not a memory limit**. Three additional fresh-client no-op requests took 271–307 ms and used about 26 MiB worker RSS; filesystem caches were not flushed, so these are not cold-boot measurements.

The prepared Python/library tree occupies about **111 MiB**. One signed diagnostic app bundle occupies about **117 MiB**; its development tar.gz is about **41 MiB**. These are measured prototype sizes, not a final notarized installer estimate. Python's pinned archive download alone is 24,981,445 bytes, before wheels. No Docker, Node, LibreOffice or background container engine is needed by this prototype.

An initial XLSX run failed because `mimetypes` attempted to read `/etc/apache2/mime.types`. The sandbox correctly denied that access. The runner now initializes MIME data from CPython's built-in registry; no extra filesystem permission was granted. An intermediate DOCX run returned worker exit 5 while native builds were changing; its cause was not established. The final stable-build four-format run passed. Treat rebuild/test concurrency as unsupported and investigate any recurrence before production.

## Compatibility limits

These fixtures prove format operations, **not unchanged execution of every installed document skill**. In particular:

- openpyxl preserves formula strings but does not calculate them. Cached values remain absent and the viewer shows formulas. A calculation engine still needs separate selection and verification.
- The inspected upstream DOCX and PPTX skills commonly generate JavaScript. Those instructions cannot run unchanged in this Python-only prototype.
- Full Office rendering/conversion workflows, Linux-specific helpers, LibreOffice, Poppler and OCR are not provided by this runtime. Existing zQ browser previews are separate from helper-side rendering.
- Round-trip checks cover synthetic structures, not lossless editing of arbitrary complex Office documents. The fixture JSON retains `rendered:false` because the worker did not render; the separate host preview test supplies the visual check.

See [skill compatibility details](skill-helper-compatibility.md) for the pinned upstream review and exact fixture coverage.

## Isolation result and next decision

App Sandbox alone denied synthetic file reads outside its container and denied loopback networking. It nevertheless allowed system executables, `fork`/`setsid`, writes elsewhere inside its container, and a detached child surviving direct-worker cancellation. The finite child test self-terminated and verified cleanup. We fixed a native pipe-wait hang and an unbounded empty-log-chunk list found during independent review, but those fixes do not remove the App Sandbox-only containment gaps.

The follow-up Seatbelt-only build successfully installs the narrower policy before Python starts. Ten behavioral tests cover job IO, synthetic host-content reads, host/sibling writes, symlink resolution, sockets, fork, `posix_spawn`, direct system exec, policy inheritance after interpreter re-exec, cancellation of confirmed running work, and cleanup. All four document roundtrips also pass under this boundary; the initial measured runs took 277–383 ms. The resulting files open in the existing isolated viewer. OS library-loader reads/mappings were added after a dyld startup failure; no whole-home or network allowance was added. Metadata and sysctl reads remain broadly permitted, and `/dev/null` is an explicit write exception.

Review also found that code could prevent cleanup by setting directory permissions to zero. The service now retains a root directory descriptor before execution and performs descriptor-relative cleanup without following symlinks. Tests verify removal of locked job directories and preservation of a synthetic external symlink target and its permissions. Cleanup now precedes the reply and job-slot release; incomplete cleanup returns an error and no artifact files. App Sandbox-only detached-child races remain a diagnostic limitation.

The hardening pass adds an OS file lock shared across service processes for this helper identity, held from admission through cleanup. Tests prove that a second client is refused while a job runs and succeeds after completion. The Seatbelt-only service samples worker memory and reachable file sizes at roughly 50 ms intervals: 256 MiB max resident/physical footprint, 64 MiB logical regular-file bytes, 4,096 entries, and depth 64. A final filesystem check catches jobs that finish between samples. Native code fails closed if accounting is unreadable. Six integration tests cover caller rejection, memory, file bytes, entry count, immediate completion and cross-client admission; standalone C tests exercise scanner boundaries and no-follow behavior.

These are watchdog thresholds, not hard RAM/disk quotas. Sampling can overshoot, and scanning reachable files misses open-but-unlinked files and does not measure filesystem metadata/xattr allocation. Service-crash supervision remains unverified: the lock is released if the service dies, but its worker is not proven to terminate with it. The counters cover the worker, not total host/service memory. Code-hash pinning rejects a differently signed caller with the same identifier, but an unchanged copy of the authorized caller is accepted; this does not authenticate user intent or provide a distribution trust chain. Ad hoc signing is still development signing. Python can modify its own interpreter state, so every response, filename and returned byte is untrusted regardless of the runner's convenience checks. The main app would need an independent durable artifact-validation boundary.

**Decision: do not connect any of these builds to arbitrary Chat skill execution yet.** The per-job policy and normal auth/admission/cleanup paths are demonstrated, but deprecated/private sandbox interfaces, the unsandboxed trusted launcher, hard quotas/crash supervision and distribution/platform validation remain unresolved. Keep the proven document library profile. An App Sandbox helper running fixed zQ-owned document operations is a different, narrower capability; it must not be described as execution of arbitrary imported scripts. Container and remote backends remain deferred, not new dependencies.

## Reproduce

Requires the existing development Node/uv/Xcode tooling on Apple silicon. All build products and fixtures stay under `.local-data/skill-helper-prototype`; regular workspace data is not modified.

```sh
node scripts/prepare-skill-helper-runtime.mjs
node scripts/build-skill-helper-prototype.mjs
ZQ_TEST_NATIVE_HELPER=1 node --test apps/desktop/tests/native-helper-xpc.test.cjs

node scripts/build-skill-helper-prototype.mjs --app-sandbox-only-probe
ZQ_TEST_NATIVE_HELPER=1 ZQ_NATIVE_HELPER_MODE=app-sandbox-only-probe node --test apps/desktop/tests/native-helper-xpc.test.cjs
ZQ_TEST_NATIVE_HELPER_DOCUMENTS=1 node --test apps/desktop/tests/native-helper-documents.test.cjs
ZQ_TEST_NATIVE_HELPER_DOCUMENTS=1 node --test packages/ui/artifact-helper-prototype.test.cjs
node --test apps/desktop/tests/native-helper-runner.test.cjs

node scripts/build-skill-helper-prototype.mjs --seatbelt-only-probe
ZQ_TEST_NATIVE_SEATBELT=1 node --test apps/desktop/tests/native-helper-seatbelt.test.cjs
ZQ_TEST_NATIVE_CONTROLS=1 node --test apps/desktop/tests/native-helper-controls.test.cjs
ZQ_TEST_NATIVE_HELPER_DOCUMENTS=1 ZQ_NATIVE_HELPER_MODE=seatbelt-only-probe node --test apps/desktop/tests/native-helper-documents.test.cjs
ZQ_TEST_NATIVE_HELPER_DOCUMENTS=1 ZQ_NATIVE_HELPER_MODE=seatbelt-only-probe node --test packages/ui/artifact-helper-prototype.test.cjs
```

Do not rebuild a bundle while running its tests. Do not feed third-party scripts to the diagnostic build.

Hardening verification: native strict suite 2 passed (10 diagnostic-only skipped); App Sandbox diagnostic suite 11 passed (1 strict-only skipped); Seatbelt confinement/cleanup suite 10 passed; auth/resource/admission suite 6 passed; Seatbelt document suite 4 passed; native C scanner suite passed. Regular desktop suite: 641 passed, 33 intentionally skipped, zero failures. The previous isolated viewer test passed; document generation and native controls changed, not the viewer. No module capability/version was added, no regular app package was rebuilt, and no imported skill bytes were modified. No prototype processes remained after the final suites.

XPC caller enforcement uses Apple's public [setCodeSigningRequirement API](https://developer.apple.com/documentation/foundation/nsxpcconnection/setcodesigningrequirement%28_%3A%29), configured before `resume()`. This is separate from the deprecated Seatbelt API used to restrict Python.
