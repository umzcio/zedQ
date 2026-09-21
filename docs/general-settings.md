# General settings

General is the first Settings section. These preferences belong to the desktop
shell and require a new app release; a module update cannot add the native behavior.

| Setting | Behavior | Default |
| --- | --- | --- |
| Launch at login | Uses macOS login items; reads the current OS setting on focus | Off for new installs |
| Start minimized | Keeps the window hidden when macOS launches zQ at login; opening zQ normally still shows it | Off |
| On launch | Restore the last view or open Home, Notes, Tasks, Chat, or Code | Last view |
| Closing the window | Save edits and hide the window while work continues, or quit | Keep running |
| Notifications | Separate background alerts for research completion, agent review, and task completion | All off |
| Automatically check for updates | Under Updates; check after 30 seconds and every six hours | Off |

Downloads and restarts remain manual. Cmd+Q always uses the normal save-and-quit
flow, including when closing the window is set to Keep running. Clicking the Dock
icon reopens a hidden window. Each setting has a Reset to default context action.

Preferences are saved atomically in `app-preferences.json` in the app's data
directory. Login registration remains owned by macOS, rather than a copied local
boolean. Invalid preference files are preserved and reported in Settings.

Notifications report new transitions, not old completed work loaded at startup.
They are suppressed while zQ is focused and use generic text. Research and agent
alerts open the corresponding conversation/session; task alerts open the relevant
module. Delivery follows macOS notification permissions and Focus settings.

## Verification

`app-preferences.test.cjs` covers persistence, validation, login state, update
scheduling, notification transitions and suppression. The General browser test
covers controls, context resets, relaunch persistence, startup destination, and
window hide/quit behavior. Both browser tests use disposable profiles:

```sh
node --test apps/desktop/tests/app-preferences.test.cjs
node apps/desktop/tests/general-settings.browser.cjs
node apps/desktop/tests/app-updates.browser.cjs
```

Login-item registration and notifications are disabled in development and
`ZQ_DATA_DIR` profiles. Browser tests substitute the OS preference interface;
they do not alter the user's real login items or notification preferences.
Before releasing, verify login/logout with Start minimized both on and off,
and notification delivery/click handling in the signed app installed in Applications.
