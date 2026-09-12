> Superseded by the native helper prototype on 2026-09-11. Docker is not the default runtime. Retained as design history.

# Local skill runtime

Extend installed skills with isolated Python/JavaScript execution, preserving standard packages. Default to local Docker (installed on this Mac); remote runtime is deferred. Load instructions separately from execution and show actual execution activity. Native shell owns processes, staging and output validation; Chat owns status and activity UI.

Each invocation is a fresh container using a zQ-built, versioned generic dependency image. No host bind mounts, host network, sockets, credentials or arbitrary host paths. Docker receives bounded JSON on stdin. Run nonroot with read-only root, network none, capabilities dropped, no-new-privileges, CPU/memory/PID/time limits and bounded temporary storage. Abort/timeout removes the owned container. Do not execute imported scripts on the host. Never vendor third-party skills into the image.

Only loaded skill snapshots and explicitly scoped request inputs are staged. Packages retain relative paths and original bytes. Generated Python/JavaScript may invoke packaged helpers. Original artifact bytes may be staged from authorized conversation references; attachment PDFs currently retain extracted text only and must be identified as such. File output is limited to validated PDF/DOCX/XLSX/PPTX, with bounded logs returned to the model. Existing artifact previews, download/context menus and version storage apply. Code tools must not claim visual QA without actually inspecting rendered output.

Use existing per-chat approval policy. Ask mode shows skill, language and bounded code; denial stops the request. Auto mode proceeds within isolation. Execution errors do not create completed artifact cards. Runtime installation is a user-triggered setup action, not a model tool. Missing engine/image is clearly reported. Dependencies are fixed in the image definition; unavailable dependencies fail with logs, never trigger network installs during execution.

Tests use temporary directories only. Validate argument hardening, cancellation, staging paths, malformed outputs, selection scope, approval denial, actual document creation, and UI type/build compatibility. No normal workspace test content.
