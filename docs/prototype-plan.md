# zQ visual prototype implementation plan

Goal: a local, clickable design prototype for Zach to review, with light/dark/system appearance, HQ, editable Notes, manual Kanban, search, and a note/board split.

Scope approved in conversation: draft a prototype of the proposed shell, adding light and dark modes. This is sample data in browser storage; it does not implement Electron, SSH, cloud sync, or agent integrations.

Architecture: isolated `prototype/` directory, React/TypeScript/Vite, shadcn primitives, shared CSS theme tokens. No existing Git repository or application exists here. Keep prototype persistence separately namespaced and label sample data visibly.

Constraints: latest stable dependencies resolved from npm at creation; exact versions and lockfile retained. Local UI actions only. Preserve edits locally; surface save failures. Support keyboard access and reduced motion.

## Execution

- [x] Create the Vite configuration, current dependencies, shadcn primitives, and sample data.
- [x] Build shell and HQ, Notes editing/tabs/split, Tasks board/card editing, appearance controls and command search.
- [x] Build and check types; use browser interactions to verify themes, note persistence, task status movement, and search.
- [x] Inspect screenshots in both themes, correct visual issues, then open the local prototype for feedback.

Verification limits: responsive styling and drag/drop are implemented, but dedicated narrow-window and drag/drop interaction checks remain outside the completed checks. Task movement was verified through the accessible status editor.

Verification is a production build and direct interaction checks appropriate to a disposable visual prototype; no production sync or backend correctness is implied.
