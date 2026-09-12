# Native helper recovery Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement each step.

**Goal:** Verify service-crash behavior, fix orphaned execution and temporary files, and record an explicit shipping boundary before Chat integration.
**Architecture:** Preserve the isolated development prototype and existing document library profile. First reproduce a finite worker during XPC service SIGKILL; choose lifetime enforcement from that evidence. Keep arbitrary imported code disconnected from Chat until the execution boundary meets supported-platform and containment requirements.
**Tech Stack:** Swift XPC, macOS process APIs, C, bundled CPython, Node integration tests.
**Spec:** `docs/superpowers/specs/2026-09-11-native-skill-helper.md`; accepted follow-up #2: resolve recovery and execution-boundary decisions.

## Global Constraints

- No Docker, remote service or new consumer runtime dependency.
- No proprietary additions to SKILL.md and no changes to installed skill bytes.
- Synthetic fixtures and isolated build products only.
- Preserve strict fail-closed and explicit diagnostic variants.

## Task 1: Reproduce recovery

- [x] Add an opt-in integration test that stages a nonce-bearing readiness file, verifies test service identity, SIGKILLs that service, and asserts worker exit and job cleanup within a bounded deadline.
- [x] Ensure test cleanup kills only verified test processes, with finite worker fallback and no user data.
- [x] Run against the existing signed prototype and record the observed failure before implementation.

## Task 2: Implement and verify recovery

- [x] Select minimal native lifetime mechanism after observing process groups and parent exit behavior.
- [x] Keep admission held until worker exit and cleanup, including after service death (supervisor death excluded); return errors rather than artifact bytes on interrupted execution.
- [x] Cover client disconnect, service kill, worker kill, immediate next-job admission and synthetic symlink/permission cleanup.
- [x] Run existing confinement, resource controls and four-format suites sequentially against stable rebuilt bundles.

## Task 3: Execution-boundary decision

- [x] Document supported shipping scope separately from experimental arbitrary-script compatibility, using measured results and official Apple API constraints.
- [x] Record remaining hard-quota, signing and platform constraints without claiming that watchdogs provide hard limits.
- [x] Obtain independent review, run desktop tests/typecheck, commit and push the verified changes.
