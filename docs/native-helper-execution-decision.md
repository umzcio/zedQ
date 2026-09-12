# Native helper execution boundary

Decision recorded 2026-09-12. This applies before integrating the native prototype with Chat.

Implementation follow-through: the separate [fixed document helper](document-helper.md) now implements the structured path described below. The generic prototype remains outside Chat. Release signing/notarization is still a distribution requirement.

## Shipping scope

Use a supported App Sandbox XPC helper for **fixed zQ-owned document operations**, accepting structured arguments and document bytes. Keep the proven pinned Python/library profile. This is the next implementation target, not a capability enabled by this change.

Do not expose the prototype's generic `{code, files}` request to Chat, installed skills, connectors, plugins or renderer IPC. Arbitrary imported Python remains a development experiment. Do not silently substitute App Sandbox-only execution when a more restrictive policy fails. Importing standard `SKILL.md` packages continues to preserve their bytes and resources; import does not imply that their scripts can execute.

This scope supports an ordinary Mac app without Docker or another container product. It does **not** establish unchanged compatibility with every upstream skill. In particular, DOCX/PPTX skills using JavaScript, subprocess toolchains, LibreOffice, OCR and spreadsheet formula recalculation remain outside the proven Python document profile.

## Why this is the boundary

Apple supports entitlement-based App Sandbox and privilege separation through XPC. Our diagnostic App Sandbox tests permit detached descendants and writes elsewhere in the container; those privileges are unsuitable for the intended arbitrary-script contract. The narrow experimental policy blocks the tested operations but uses custom SBPL and deprecated `sandbox_init`. Apple DTS explicitly describes SBPL as undocumented for third-party use. The installed SDK also documents failure when already sandboxed and reserves flags other than `SANDBOX_NAMED`—the custom-profile experiment uses flags zero.

References: [App Sandbox configuration](https://developer.apple.com/documentation/xcode/configuring-the-macos-app-sandbox), [XPC services](https://developer.apple.com/library/archive/documentation/MacOSX/Conceptual/BPSystemStartup/Chapters/CreatingXPCServices.html), [Apple DTS on custom sandbox profiles](https://developer.apple.com/forums/thread/661939).

Endpoint Security would require a restricted entitlement and a substantially different security-product design. Virtualization.framework is supported but introduces a guest VM; it remains an optional future architecture decision. Neither is being installed or added as a dependency here. [Endpoint Security sample](https://developer.apple.com/documentation/endpointsecurity/monitoring-system-events-with-endpoint-security), [Virtualization.framework](https://developer.apple.com/documentation/virtualization).

## Recovery and remaining limits

The trusted native supervisor improves **XPC service-crash recovery**. It inherits the existing locked file description, establishes a separate process group, watches the original service with `kqueue` before launching Python, and terminates/reaps the worker before descriptor-relative cleanup and lease release. Cancellation sends SIGTERM to the supervisor. Parent identity is checked before and after event registration to avoid registering against a recycled PID. Monotonic time bounds execution. SIGPIPE and SIGHUP cannot terminate cleanup when the client disappears or an orphaned stopped group resumes.

The service retains its lease until its own completion path finishes. Fresh admission holds that same lease while clearing the identity's private staging directory, covering crashes before a supervisor could launch. No old request is replayed, and interrupted execution returns no artifact bytes.

This does not make arbitrary native scripts production-ready. A supervisor crash/SIGKILL can still leave a worker alive; simultaneous process failures are not a kernel-enforced lifetime boundary. The experimental App Sandbox-only variant still permits detached descendants. Sampled memory/file watchdogs are not hard quotas: open-but-unlinked files, metadata allocation and between-sample overshoot remain outside their guarantees. Ad hoc signature pinning is development authentication, not a release signing/notarization chain. Document parsers and every returned byte remain untrusted inputs to the host.

The supported fixed-operation helper needs its own structured protocol, operation allowlist, independent artifact validation, release signing and platform tests before it ships. Those are implementation requirements for that narrower capability, not permission to route arbitrary scripts through it.
