# zQ shell direction

Zach approved moving modules to the top and using the clean outline icons, visible centered search, and restrained surfaces in the eight references under Desktop/design_inspso.

This pass moves the existing module navigation into one top header, retains one contextual sidebar, connects a visible Search trigger to existing workspace search and Cmd+K, and moves appearance/settings into the header. Existing module content and data behaviors are retained. All palettes use neutral surfaces; accents remain in meaningful controls. No new dependencies or integrations are needed.

Validate production build, module navigation, search result navigation, sidebar collapse/restore, light/dark appearance, and native packaging using the isolated workspace. Reopen the regular workspace on completion.

Validation: production build and unsigned macOS package passed; 97 existing tests passed. In the isolated desktop workspace, verified header search filters and opens a saved note, top module switching, sidebar collapse/restore, and the header Light/Dark menu. Reviewed neutral dark Chat and light Notes/Chat surfaces.

The native macOS title bar is now integrated into the top header, retaining system window controls and dragging in empty header space. Zach approved this as the shell baseline.

Chat's sidebar follows the supplied reference with a soft plus/New chat row, a thin search icon, a quiet Recents heading, and single-line conversation rows. Chat uses the same heading and collapse control as Workspace, Notes, and Tasks, with New chat underneath. Existing conversation selection and search remain functional; starting a chat clears the history filter. Project collections, Artifacts, and Apps are omitted until those features exist. Build and packaging passed; native light/dark review, history filtering, reopening a saved conversation, and creating a chat were checked in the isolated workspace.

The zQ logo is the sole home shortcut in the header; the redundant HQ module button is omitted.

Chat conversation rows now provide shadcn context menus: Open chat, Rename, and Delete chat. Rename also supports F2. Rename/Delete dialogs use the shared components; deletion requires confirmation and is unavailable during a running response. Native storage persists explicit titles and deletions, preserves manual titles on first send, and rejects failed writes without dropping the in-memory chat. Deleted conversation drafts and unsent attachments are cleared from the renderer. All 102 tests passed, production build/package passed, and native isolated UI checks covered Rename, Cancel deletion, and confirmed deletion with selection falling back to another chat.
