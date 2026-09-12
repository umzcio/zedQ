# zQ design prototype

A clickable browser prototype for reviewing the desktop shell. This is intentionally isolated from the future production application.

## Run

```sh
npm ci
npm run dev -- --port 4317
```

Open http://127.0.0.1:4317/. Run `npm run build` for TypeScript checking and a production bundle.

## Try

- Use the sun, moon, or monitor buttons at the bottom of the sidebar for light, dark, or system appearance.
- In Settings → Appearance, choose Green, Blue, Red, or Gunmetal independently of the light/dark/system setting. Both preferences persist in browser storage.
- Open HQ, Notes, Tasks, and Settings (the profile button).
- Capture a thought, edit a note, pin it, or open tasks alongside it.
- Drag task cards, or click a card and change its status. List view also provides status selectors.
- Filter tasks by project and use Find anything to search notes and tasks.
- Switch modules using the persistent far-left icon rail. The adjacent sidebar changes to the module's collections, notes, or task filters. The toolbar's sidebar button collapses only that second column.
- Chat, Code, and Work are inactive preview icons labeled as planned modules.

Sample content and edits are stored only in this browser under `zq-design-v1`. There is no backend, cross-device sync, remote connection, file access, or agent activity. Closing tabs preserves note content. Reloading currently returns to HQ; production workspace restoration is outside this prototype. Some keyboard shortcuts such as Command-N may be reserved by the browser; visible buttons provide the same actions.

## Dependency checkpoint

Stable registry versions resolved September 7, 2026: React/React DOM 19.2.8, Vite 8.2.2, TypeScript 7.0.2, Tailwind 4.3.3, and Radix UI 1.6.7. Exact direct versions are in package.json and transitive versions in package-lock.json. shadcn Button, Dialog, Input, and Textarea were generated using the current CLI and customized. TypeScript 7's removed `baseUrl` option is not used.

## Verification

- TypeScript and production build pass.
- Safari: inspected light HQ, dark Notes/task split, and dark Kanban.
- Safari: created and edited a note, refreshed, and confirmed persisted title/content preview and theme.
- Safari: edited task status and confirmed column counts and placement updated.
- Safari: searched for the created note and confirmed matching results.
- Two-level navigation revision: build passes; Safari verified Notes and Tasks contextual sidebars, independent sidebar collapse with the module rail retained, and screenshots in dark and light mode.
- Responsive layouts are included; narrow-window layout and drag/drop have not yet received a dedicated interaction check.

This prototype is for design feedback, not a production reliability claim.
