# Native Skill Helper Prototype Implementation Plan

**Goal:** Prove document compatibility and access restrictions without a separate runtime product.
**Architecture:** Standalone development app -> XPC service -> signed inherited worker and bundled CPython. A fixed library profile is independent of imported standard skills. No connection to normal Chat storage.
**Tech stack:** Swift/Foundation XPC, macOS App Sandbox, CPython standalone, Python document libraries, Node build/test scripts.
**Spec:** docs/superpowers/specs/2026-09-11-native-skill-helper.md

- [x] Remove only unfinished Docker work: runtime UI/types, Docker tests, mark previous design superseded.
- [x] Native app/service/worker under apps/desktop/native/skill-helper-prototype; executable client accepts JSON stdin {code, files:[{path,data}]} and replies JSON {exitCode,stdout,stderr,files:[{name,data,mime}],...metrics}. All inputs staged by the service. Test sandbox inheritance and denial with fake canaries, subprocess restrictions, cancellation/timeout. No real credentials inspected.
- [x] Reproducible runtime setup: fixed CPython download URL+SHA256 and complete pinned wheel hashes; download/install only in prototype build area. Keep third-party license metadata. No global pip install.
- [x] Python runner: strict staging/file/output limits and path checks; create actual DOCX/XLSX/PPTX/PDF fixtures and roundtrip checks, including form fill. Files are reference data; requests do not control executable locations or environment.
- [x] Verify real XPC request path and collect startup/RSS/disk metrics, inspect generated document output, run regular tests/typecheck after cleanup. Record limitations and whether prototype meets the integration bar in docs/native-skill-helper.md.

Outcome: prototype evaluation complete. Format workflows pass; strict boundary fails closed and diagnostic isolation is insufficient. No Chat integration or release. Results: docs/native-skill-helper.md.
