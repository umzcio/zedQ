# Supported document helper and Chat integration

The user approved the fixed-operation native helper followed by Chat/Skills integration. This implements the boundary recorded in docs/native-helper-execution-decision.md. The existing arbitrary-code prototype remains development-only and is not an integration dependency.

## Contract

A separately signed caller app contains an App Sandbox XPC service. The caller exchanges bounded JSON on stdin/stdout with Electron. The service accepts only protocol version 1 and operation `render_document`, with a structured document input: format (`docx`, `xlsx`, `pptx`, `pdf`), title, parsed text/table blocks and validated typography. It never accepts Python/JavaScript, shell commands, paths, package names, network permissions, imported scripts or a runtime choice. The bundled Python entry point contains only zQ-owned allowlisted code. Python and the supervisor inherit the service sandbox. No custom Seatbelt profile is used.

The host parses the existing Markdown document source and retains its source/typography in artifact versions. The native worker creates all four document formats from those blocks. Revisions render a complete new version through the same fixed operation, preserving previous immutable artifact files. Arbitrary imported-document round trips, spreadsheet recalculation, OCR and unchanged execution of upstream skill scripts remain outside this feature. Those limitations must remain explicit in skill/tool guidance.

## Lifecycle and trust

One job runs at a time in a private job directory. Reuse the reviewed descriptor-relative cleanup, cross-process job lease, resource monitoring and parent-crash supervisor in a production-owned native directory. Requests are limited to 1 MiB, source to 100 KB, output to one document up to 4 MiB, process stdout to 6 MiB, and execution to 30 seconds. Cancellation closes the caller/XPC session and terminates the supervised worker; no result is committed after cancellation, timeout or malformed output. Concurrent callers queue in the host with cancellation while waiting.

The service authenticates its signed caller using XPC code-signing requirements. Development builds use explicit ad hoc identity pinning; a build signing identity can select a stable release identity. Signing/notarization of a distribution remains a release step, not an unearned claim for a local build. The app bundles the pinned runtime and wheels with provenance and dependency licenses; no runtime download is required for app users. The build may prepare pinned dependencies.

## Host and product integration

A native transport owns process creation, output bounds, cancellation and strict response validation. It independently validates the returned document structure, format and filename before returning it to ArtifactService. The existing preview, artifact library, immutable versions, download cards, note/task attachments, Chat approval gates and loaded-skill activity remain the user-facing flow. A native runtime failure is shown as a failed document operation; never silently run model code or substitute another execution boundary.

Only packaged/macOS hosts configured with the built helper use it; dependency injection keeps portable tests independent of the platform. Chat documents and artifact-editor renders share the same configured renderer. In-flight Chat cancellation is forwarded into the helper and checked again before the existing atomic commit. Tool activity says the document is being created/revised on this Mac. Installed skill guidance explains that loaded instructions can guide the fixed document tools; arbitrary scripts and missing dependencies are not executed.

## Verification

Test worker validation and semantic outputs for all four formats, including tables, line breaks, typography and literal formula-looking input. Test native transport invalid responses, cancellation, queue cancellation, timeout, and document validation. Run the built signed XPC helper in disposable workspaces, inspect entitlements/signatures, verify rendering and service-crash recovery, and exercise Chat creation/revision/cancellation through real helper output. Visually inspect artifacts in the existing right-hand pane and reopen stored revisions. Run full tests, typecheck, signed module/shell build, packaged smoke checks and GitHub CI. Restore the normal workspace after testing.
