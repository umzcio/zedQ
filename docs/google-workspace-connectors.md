# Personal Google Calendar and Drive

Both presets run bundled in-memory MCP adapters over standard Google REST APIs. They do not require Google Workspace Developer Preview enrollment or a container. Existing registered web clients and fixed loopback callbacks continue to work.

On reconnect, zQ migrates only the exact trusted legacy catalog endpoints. Client secrets must match the registered client and trusted Google issuer/token endpoint; eligible saved grants are rebound to the corresponding API. Access is verified before showing Connected. Changed schemas disable affected tools so the user can review the new selection.

## Calendar

Enable Google Calendar API. Existing scopes remain `calendar.calendarlist.readonly`, `calendar.events.readonly`, and `calendar.events.freebusy`.

Tools: `list_calendars`, `list_events`, `search_events`, `get_event`, `free_busy`. Event lists require an explicit RFC3339 window, expand recurring instances, retain all-day dates and calendar time zones, and support pagination. Use the calendar time zone for day boundaries. Changes use three additional tools: `create_event`, `reschedule_event`, and `cancel_event`. Explicit Connect requests `calendar.events` in addition to the reading scopes; existing read-only grants still reconnect silently for reading. Reconnect and approve edit access, then enable the desired new tools in Manage tools.

Every change requires a one-time native review showing calendar identity, title, time zones, all-day dates (with the exclusive end converted for display), guests, and notifications. Creation supports title, times, description, location, and up to 25 guest addresses. Rescheduling changes only start/end. Cancellation removes the selected event. All guests receive invitations/updates/cancellations (`sendUpdates=all`).

Only ordinary events on writable calendars are supported. Reschedule/cancel require the organizer's copy. A recurring occurrence can be changed; entire recurring series and special events must be managed in Google Calendar. Large or incomplete guest lists cannot be approved in zQ.

Review tokens are native, single-use, bound to the exact action/arguments, and expire after ten minutes. Reschedule/cancel use the reviewed ETag with If-Match to reject intervening edits. Creation supplies a unique event ID. Mutation requests are never automatically retried; uncertain results direct the user to check Google Calendar before trying again. Denial makes no mutation, and a chat-wide grant cannot replace action review.

## Drive

Enable Google Drive API. Existing scopes remain `drive.readonly` and `drive.file`.

Tools: `search_files`, `get_file`, `read_file`. Text searches match file names/content and exclude trash. Advanced `q` uses native Drive syntax. Google Docs/Slides export as text; Sheets export the first sheet as CSV. Small binary files are attached to chat. Files are limited to 1 MB; text previews are bounded and disclose truncation. These reading tools do not modify files.

`upload_file` saves an exact document artifact version available in the current chat, including documents just created by a tool. It uploads original PDF/Word/Excel/PowerPoint bytes (up to 5 MB) to a chosen folder, or My Drive when no folder is specified. Raw paths, URLs, model-provided bytes, unrelated library artifacts, and unsaved attachment extracts are not upload sources. Existing `drive.file` authorization is used; reconnect to discover the new tool and enable it in Manage tools. Folder/account access is checked against Google; inaccessible destinations are rejected.

A once-only native review displays account, filename, version, size, destination, and inherited folder access. No overwrite, conversion, or sharing changes are supported. A review snapshots the original bytes and binds them to the exact arguments and a Google-generated file ID for ten minutes. The folder is rechecked after approval. The app verifies returned ID, filename, MIME type, size, checksum, and parent before presenting a successful upload and link. Network failures are not retried automatically; users are directed to check Drive for an uncertain result. Larger/resumable uploads and email attachments remain backlog work.

## Validation

`google-workspace-api.test.cjs` exercises the real MCP adapters against fixture HTTP responses, including encoded IDs, time windows, recurring instances, pagination, escaped searches, exports and errors. `google-auth.test.cjs` tests independent scoped authorization/refresh on the shared Google API origin. `mcp-service.test.cjs` tests trusted migration. `drive-upload.test.cjs` verifies original-byte uploads, token binding, destination changes, permissions, size limits, cancellation, and uncertain results. `chat-connectors.test.cjs` verifies that only chat-scoped document versions can reach upload review. `drive-upload-packaged.browser.cjs` checks the real packaged native services and review UI against local fixtures. `calendar-actions.test.cjs` tests action binding, date/zone validation, permissions, recurrence limits, stale versions, empty delete responses, and uncertain writes. `calendar-actions-packaged.browser.cjs` verifies real native OAuth, chat, and review UI for create/reschedule/cancel against isolated fixtures. `gmail-packaged.browser.cjs` tests the packaged native OAuth, credential store, connectors, chat tool execution and permission UI in a disposable workspace.

Sources: [events.insert](https://developers.google.com/workspace/calendar/api/v3/reference/events/insert), [events.patch](https://developers.google.com/workspace/calendar/api/v3/reference/events/patch), [events.delete](https://developers.google.com/workspace/calendar/api/v3/reference/events/delete), [conditional modifications](https://developers.google.com/workspace/calendar/api/guides/version-resources), [Calendar events.list](https://developers.google.com/workspace/calendar/api/v3/reference/events/list), [freebusy.query](https://developers.google.com/workspace/calendar/api/v3/reference/freebusy/query), [Drive files.list](https://developers.google.com/workspace/drive/api/reference/rest/v3/files/list), [files.export](https://developers.google.com/workspace/drive/api/reference/rest/v3/files/export).

Drive upload references: [multipart uploads](https://developers.google.com/workspace/drive/api/guides/manage-uploads), [files.create](https://developers.google.com/workspace/drive/api/reference/rest/v3/files/create), [generated file IDs](https://developers.google.com/workspace/drive/api/reference/rest/v3/files/generateIds).
