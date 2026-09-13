# Personal Google Calendar and Drive

Both presets run bundled in-memory MCP adapters over standard Google REST APIs. They do not require Google Workspace Developer Preview enrollment or a container. Existing registered web clients and fixed loopback callbacks continue to work.

On reconnect, zQ migrates only the exact trusted legacy catalog endpoints. Client secrets must match the registered client and trusted Google issuer/token endpoint; eligible saved grants are rebound to the corresponding API. Access is verified before showing Connected. Changed schemas disable affected tools so the user can review the new selection.

## Calendar

Enable Google Calendar API. Existing scopes remain `calendar.calendarlist.readonly`, `calendar.events.readonly`, and `calendar.events.freebusy`.

Tools: `list_calendars`, `list_events`, `search_events`, `get_event`, `free_busy`. Event lists require an explicit RFC3339 window, expand recurring instances, retain all-day dates and calendar time zones, and support pagination. Use the calendar time zone for day boundaries. No events are created, changed or deleted.

## Drive

Enable Google Drive API. Existing scopes remain `drive.readonly` and `drive.file`.

Tools: `search_files`, `get_file`, `read_file`. Text searches match file names/content and exclude trash. Advanced `q` uses native Drive syntax. Google Docs/Slides export as text; Sheets export the first sheet as CSV. Small binary files are attached to chat. Files are limited to 1 MB; text previews are bounded and disclose truncation. No files are created, shared, changed or deleted.

## Validation

`google-workspace-api.test.cjs` exercises the real MCP adapters against fixture HTTP responses, including encoded IDs, time windows, recurring instances, pagination, escaped searches, exports and errors. `google-auth.test.cjs` tests independent scoped authorization/refresh on the shared Google API origin. `mcp-service.test.cjs` tests trusted migration. `gmail-packaged.browser.cjs` tests the packaged native OAuth, credential store, connectors, chat tool execution and permission UI in a disposable workspace.

Sources: [Calendar events.list](https://developers.google.com/workspace/calendar/api/v3/reference/events/list), [freebusy.query](https://developers.google.com/workspace/calendar/api/v3/reference/freebusy/query), [Drive files.list](https://developers.google.com/workspace/drive/api/reference/rest/v3/files/list), [files.export](https://developers.google.com/workspace/drive/api/reference/rest/v3/files/export).
