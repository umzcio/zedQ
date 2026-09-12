# App tooltip conventions and coverage

The September 12, 2026 pass uses shared Radix tooltips across the desktop shell and every shipped module. The purpose is to explain an action, its current state, a disabled reason, or a truncated name/path without changing the surrounding layout.

## Shared behavior

`TooltipProvider` spans the shell and persistent module surfaces. `TooltipButton` and `TooltipLink` preserve native props, refs and semantics; `Button`, `IconButton`, `SelectField`, `SelectTrigger`, `Checkbox` and `CollapsibleTrigger` use the same policy. Explicit `tooltip` copy takes precedence over legacy `title`, accessible labels and visible text. `tooltip={false}` opts out. `ControlTooltip` adds help to existing status/disclosure elements. Keyboard-relevant noninteractive targets must be focusable.

Pointer delay is 450 ms, with a 300 ms window for immediate adjacent tooltips. Keyboard navigation opens help immediately; restored focus after pointer selection does not. Escape dismisses help. Tooltips use neutral theme surfaces, a 300px maximum width, collision padding and a 110ms opacity-only entrance. Subsequent tooltips and reduced-motion preference skip that animation. Leaving the trigger or content dismisses help immediately outside the hover corridor; the small crossing gap has a maximum 120ms grace period. Content remains hoverable and contains no interactive controls. Tooltips also close when the window loses focus or the document becomes hidden. Native disabled controls remain disabled, with a focusable help wrapper; module CSS preserves affected tab/select layouts.

A tooltip must not overwrite the state of its underlying Radix checkbox, disclosure, select or menu. The shared anchor drops the tooltip trigger's `data-state` before composing the target. Open popup triggers suppress their tooltip; expanded disclosures and sidebar-collapse buttons retain theirs.

## Reviewed surfaces

| Area | Coverage |
| --- | --- |
| Shell | Home shortcut, module navigation, workspace search/results, appearance switcher, sidebar controls, Settings navigation, save status and load recovery |
| Appearance / Modules / Voice | Theme and palette choices, module versions/update actions, microphone and transcription choices, dictation recording/cancellation, disabled save/test states |
| Home | Quick capture, navigation, note/task rows and task state |
| Notes | Collection/project navigation, note lists, editor actions, focus/tasks split, pinned notes, draggable tabs, local-file actions, full paths and save state |
| Tasks | Collection/project filters, board/list modes, status/priority selection, task cards, drag behavior, forms and linked notes |
| Chat | Projects/chats, composer and disabled send reasons, queue, model/tool controls, thinking/status, message/code actions, interruption states, approvals and clarifications |
| Artifacts | Library, attachment/save actions, editor, preview controls, version/zoom/format choices, resizer, generated files and attachment update availability |
| Providers / Projects | Connection setup, model availability/selection/labels, default tools/models, project icons/colors and inherited settings |
| Skills | Import/browse/create/edit, catalog status/update checks, installed files/resources, limits, inheritance, preview and activation controls |

## Intentional exclusions

Editable note/chat/document text, decorative icons and generated document content do not get blanket tooltips. Citation links retain their existing richer source preview cards. Menu items retain readable labels and standard menu focus/selection; the invoking controls explain their purpose. Ordinary form fields retain their labels and nearby guidance. Iframe titles remain accessibility labels, not tooltip copy.

No new user-owned items or separate context-menu actions were introduced. Existing context-menu actions are preserved.

## Verification

`npm run test:ui` exercises actual browser hover, keyboard focus, Escape, disabled controls, state changes, links, menu composition, checked boxes, expanded disclosures and select open/closed states. It runs in GitHub CI alongside the desktop tests and typecheck. The broader Electron pass uses a disposable `ZQ_DATA_DIR` with synthetic notes/tasks; it never opens the normal workspace for test mutations. Build artifacts and screenshots stay under ignored `.local-data/tooltip-verification`.

The final Electron sweep passed 232 hover checks across Home, Notes, Tasks, Chat, all five Settings pages, task/project/provider dialogs and Browse skills, with zero missing tooltips and zero page errors. It also verified tab right-click actions and Settings Escape behavior, and reviewed light/dark and 900px window screenshots. A separate browser layout fixture compared 23 enabled/disabled controls at 900px and 580px widths. The desktop suite passed 641 tests (40 environment-dependent skips), TypeScript passed, and the signed module/desktop build passed.
