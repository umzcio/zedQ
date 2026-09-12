# Module Foundation Implementation Plan

> **For agentic workers:** Execute this plan task-by-task. Independent native package storage work can run in parallel with renderer extraction using the dispatching-parallel-agents skill.

**Goal:** Make existing zQ features real separately built modules with verified local updates and rollback.
**Architecture:** Stable Electron host plus signed first-party renderer bundles. Shared React and typed shell capabilities; module controllers persist across view switches.
**Tech Stack:** Existing pinned Electron 44, React 19, Vite 8, TypeScript 7, Node crypto/fs, shadcn/Radix.
**Spec:** docs/superpowers/specs/2026-09-09-module-foundation.md

## Global Constraints
- Preserve the existing UI, context menus, data formats and native save-on-close behavior.
- No user-workspace test mutations, no API/provider expansion, no Swift rewrite.
- Do not load unverified downloaded executable code or claim untrusted-plugin isolation.

### Task 1: Native package store and verification
- [x] Add behavioral tests in apps/desktop/tests/module-store.test.cjs for signatures, versions/API, tampering, atomic install, restart selection, rollback, and corrupt fallback.
- [x] Implement apps/desktop/electron/module-store.cjs; exact exported API coordinated with renderer integration. Stage on install; never mutate data or running bundles.
- [x] Run the focused test suite and inspect failure cases.

### Task 2: Module ownership and contract
- [x] Move shared UI/types/services contracts into packages/ui and packages/module-api.
- [x] Extract Notes/Tasks/HQ controller, view and sidebar code from App/Navigation into modules/*.
- [x] Move all Chat feature UI, controller and styles to modules/chat; keep native implementation behind shell service interfaces.
- [x] Make shell navigation, module views and cross-module commands use typed public contributions. No sibling or desktop-source imports from modules.

### Task 3: Independent build and runtime loading
- [x] Build each module as one IIFE registration bundle using shell-provided React and stable shared runtime exports; package code/CSS separately.
- [x] Add signing/key generation and single-module build commands, public trust roots and package output.
- [x] Load only native-verified code through local blob scripts with load/error boundaries; use versioned metadata and stable export validation.
- [x] Add architecture/build checks and prove Chat can be rebuilt independently.

### Task 4: Native and Settings integration
- [x] Wire sender-validated module list/install/download/rollback/recovery IPC in main/preload.
- [x] Add shared shadcn Settings controls for versions and next-launch updates, including useful context actions.
- [x] Ensure fallback failures cannot overwrite workspace snapshots or interrupt current updates.

### Task 5: Review and verification
- [x] Run all tests, TypeScript/build, module contract checks, and package.
- [x] Test signed Chat-only version update, rejection, restart activation and rollback with isolated storage.
- [x] Inspect native UI: all modules, Notes/file recovery, Chat projects/menus, Tasks, Settings.
- [x] Update README/spec with author commands, compatibility/trust model and limitations; reopen regular app.

Completed verification: 147 tests passed, TypeScript/Vite module and shell builds passed, and macOS packaging passed. Native isolated install/activation/rollback verified Chat 1.0.0 → 1.0.1 → 1.0.0 with other modules unchanged; app.asar SHA-256 unchanged across the independent update activation. Cross-module linked task and Quick Capture, saved conversation display and restored local-file recovery controls verified. Archive inspection found exactly four signed module packages and no signing private key.
