# Chat deep research

Status: milestones 1–2 (native runner/recovery and research coordinator/source adapters) implemented in source; Research is not yet enabled or released. Chat UI and research artifacts remain to implement. See [implementation and tests](../docs/chat-research.md).
Agreed product direction: 2026-09-19. Baseline: current working tree on `52a7433`, including substantial uncommitted shipped work. Preserve that work.

## Agreed experience

Research is a mode in the existing Chat composer, using the selected Chat connection/model when its capabilities support the selected sources. Never silently substitute a different model. This describes zQ's intended interaction, not a claim about ChatGPT or Claude's internal model routing.

The user selects sources for each investigation: Web, attached files, selected project notes/documents, and individually selected existing connectors. Web starts enabled when supported; private sources require selection. Remember selections within the conversation, but resolve and display them again before a new run. Configured, selected, and actually used sources are distinct states.

The workflow is clarify when necessary → editable plan → investigate → check evidence → write a report. Start research after the user accepts the plan; avoid asking questions already answered in the brief or attachments. One lead researcher is sufficient for the first release. Parallel researchers and separate research-model selection are later extensions.

Research continues while zQ is running, across chats, tabs, Code, and other modules. Closing the app or sleeping the Mac does not promise continued execution. Save completed work, show an interrupted state after an interrupted request, and offer an explicit resume. Resume from saved evidence/checkpoints, not from an assertion that a provider can recover an unfinished thought or expired sandbox.

The conversation shows a compact progress card, expandable searches/read activity/findings, Stop research, and Finish with what you have. The Chat sidebar marks conversations with active research. Completion produces a notification with an Open report action; it never changes the current view automatically. Returning to the conversation restores actual job state.

The output is a versioned, editable research artifact: Markdown text rendered as a rich report, tables, clickable citations, useful charts, and inspectable/downloadable chart data. Follow-ups create revisions while preserving prior reports. Markdown export includes supporting assets; PDF export includes static chart renders and source references. Interactive chart exploration is a later enhancement, not necessary for first-release charts.

## Existing implementation and concrete gaps

| Existing surface | Reuse and required extension |
| --- | --- |
| `apps/desktop/electron/chat-service.cjs` | Native-owned requests already survive module navigation. Active requests live in a Map; startup marks streaming messages interrupted. Add a separate durable research runner rather than stretching a single streaming response. |
| `apps/desktop/electron/chat-store.cjs` | Existing chat storage is capped at 32 MiB. Keep only research references/summaries in conversation data; store evidence and checkpoints separately. |
| `packages/providers/hosted-core.cjs`, `local-tools.cjs`, `hosted-tools.cjs` | Existing provider tool adapters, capability gates and bounded tool loops. Ordinary local-tool sessions currently allow 12 calls with a default 600-second deadline. Keep ordinary Chat limits unchanged; research coordinates bounded stages with its own explicit run limits. |
| `apps/desktop/electron/chat-connectors.cjs` | Existing selected connector resolution, tool schema validation and execution grants. Research needs a restricted read/search tool set and enforced source scopes; do not expose all enabled connector actions. |
| `packages/module-api/chat-types.ts` | `ChatSource` currently contains only ID, URL and title. Research requires evidence provenance, retrieval timestamps, excerpts/locators and claim references beyond a source list. |
| `modules/chat/ChatView.tsx`, `useChat.ts`, `ChatSidebar.tsx` | Composer, source selection, persistent module controller and navigation. Add research controls and subscribe to independent job summaries/details. Do not put execution in a component effect. |
| `packages/module-api/artifact-types.ts`, `apps/desktop/electron/artifact-service.cjs` | Current artifact creation supports PDF, DOCX, XLSX and PPTX. Add an explicit research-report document schema and Markdown export; existing artifact versioning alone does not provide bundled evidence/chart data. |
| `modules/chat/ArtifactPane.tsx`, `ArtifactLibrary.tsx`, `ChatMarkdown.tsx`, `chat-sources.ts` | Reuse artifact navigation, report rendering and citation interactions. Add report-specific data/source inspection without importing shell or sibling-module implementation. |
| `apps/desktop/electron/main.cjs`, `preload.cjs`, `packages/module-api/desktop.ts`, `host.tsx` | Register the native service, typed IPC, shutdown coordination and capability exposure. This requires a shell release as well as a Chat module release. |

## Design contracts

### Durable job ownership

Add native `ResearchService`, `ResearchStore` and runner modules under `apps/desktop/electron/research/`; expose typed contracts through `packages/module-api/research-types.ts` and the existing host service boundary. Chat owns UI/controller/styles under `modules/chat`.

Proposed job record: job ID; conversation/project references; revision; brief; accepted plan/version; selected connection/model and connection revision; immutable source-selection snapshot; phase/status; completed steps; evidence references; partial findings; report artifact/version reference; timestamps; bounded activity; usage and remaining run limits; last recoverable error. Do not persist API keys or raw credentials.

Separate phase (`planning`, `researching`, `checking`, `writing`) from status (`awaiting_plan`, `queued`, `running`, `completed`, `stopped`, `interrupted`, `failed`). Preserve the current phase on interruption. Resume is a new execution generation on the same job, with capability/access revalidation. Source removal or account changes must not silently widen access or replace the selected account.

Persist inputs before dispatch and successful step results before scheduling dependents. Use atomic durable writes and execution generation guards. Only one execution owns a job; stale callbacks cannot append findings, publish completion, or overwrite a resumed report. Report publication must be idempotent across crashes between artifact creation and job completion, with an expected latest artifact version to avoid overwriting user edits.

One active research job per conversation initially; other conversations remain usable. A bounded native scheduler manages concurrent jobs and visible queue states. Run-level step/time/usage limits prevent unbounded searches; do not reset those limits at every stage. Expose useful usage where measured and label estimates. A limit produces a recoverable partial outcome, not a fabricated completed report.

Stop cancels outstanding requests and preserves committed work. Finish with what you have stops new collection and starts checking/writing from committed evidence; late responses cannot reopen collection. If evidence is insufficient, state that in the report. Application quit flushes committed progress and cancels requests. Startup marks abandoned running jobs interrupted without automatically making paid requests.

Keep research progress subscriptions separate from full chat snapshots. Summary updates are bounded/throttled; source/detail lists are loaded on demand. Switching views, tabs, or mounted panels must not own the run's AbortController. Reuse the app's existing quit/save flow rather than introducing a second generic confirmation flow.

### Source access and evidence

Resolve capabilities before starting: selected model can perform the coordinator's tool workflow; selected web route supports the necessary search/read behavior; selected connectors expose usable research tools; chosen files are available. A model with function calling does not automatically have web access. A provider-hosted research engine would be a separate future adapter; do not substitute one while claiming to use the selected Chat model.

Search/read adapters return normalized references and evidence records: source ID; source kind; URL or authorized connector resource locator; title; retrieval time; content hash/version when available; excerpt or bounded extracted content; page/section/range; tool/request provenance; relevant source restrictions. Treat results as reference data. A provider citation or search snippet alone must not be labeled a fully read or verified source.

First implementation must prove evidence acquisition for each supported provider path. Current hosted search callbacks mainly collect activity and URL/title metadata; extend adapters where provider responses expose useful evidence. Where they do not, use a separately supported read/search adapter or disclose that the source path is unsupported. Do not invent page contents or equate a final model answer with independent evidence. Domain restrictions must be enforceable by the chosen route, not merely prompt advice.

For connectors, preserve standard MCP. Use audited read/search mappings for supported tools; MCP `readOnlyHint` is not an enforcement guarantee. Unknown operations remain unavailable for unattended research until classified. Restrict tool arguments to selected repositories/folders/resources where the connector permits enforcement; if only account-wide scope is available, say so in the source picker. Reuse applicable execution grants, schema checks and credential handling. Sending, editing, deleting and uploading to external apps are excluded from Research's tool set, even if enabled for ordinary Chat.

Keep references to private source material local to the report store and disclose the selected material sent to the chosen model through the existing source/context UI. Export citations and necessary supporting data without automatically exporting entire private documents or connector responses. Any new network reader must use validated URLs/redirects, bounded content, cancellation and safe parsing; do not grant arbitrary local-network/file access through web results.

The coordinator uses a repeatable loop: investigate a subquestion, collect evidence, record findings and gaps, choose the next useful step, and stop when scope is covered or limits are reached. An evidence-checking pass flags unsupported claims, contradictions and stale information. Store claim-to-evidence links and distinguish direct quotations, sourced facts, calculations and model interpretation; validation is not a guarantee that every conclusion is correct.

### Research reports and visuals

Extend artifact storage using a validated report document type rather than arbitrary HTML or executable chart code. Suggested report components: Markdown body, citation map, structured tables, datasets, chart specifications, rendered chart assets, evidence references and research-job provenance. Give each revision immutable references so later research cannot change what an old citation meant.

Support a small set of deterministic chart types first (bar, line, scatter). A chart references stored dataset columns, units and labels, plus source IDs and any calculation method. Render through a controlled native service or bounded worker; the model proposes specifications/data transformations rather than executing arbitrary code in the renderer. Missing values stay missing. No invented numeric data or automatic chart inserted just to decorate the report.

Provide the rendered report, chart data as CSV, Markdown with local assets, and PDF containing tables/charts/source references. Preserve citations and dataset links on reopening and export. Artifact edits create a new version with conflict detection. A research follow-up links to the previous job/report and creates new evidence/report versions without replacing history.

### Interaction details and context menus

Use shared `@zq/ui` Radix/shadcn controls and existing compact light/dark styling. Source picker distinguishes available, selected, unsupported and used sources. Scope controls must reflect real backend capabilities. Disabled controls explain the specific missing capability; no decorative controls.

Include context menus at initial implementation:

- Research card/sidebar indicator: Open research, View plan, View sources, Stop, Finish with what you have, Resume, Open report as applicable to state. Actions match between card and sidebar; unavailable actions explain why.
- Source/evidence rows: View evidence, Open original where available, Copy citation/link, Remove from draft selection. Removing a draft source does not rewrite a completed report's provenance.
- Report/library rows: Open, Rename, View versions, Export Markdown/PDF, existing trash/restore behavior; use the existing artifact actions consistently.
- Charts and tables: View data, Copy table, Download CSV and Save chart where supported.

Preserve keyboard access, focus restoration, screen-reader status announcements and reduced motion. Changing views must never steal focus back to research. Add actionable notification support through the host contract if existing text-only `notify` cannot link to a report; the shell owns generic notification plumbing, not Research UI.

## Delivery sequence

Progress on 2026-09-20: steps 1–3 are implemented in source. The native runner/coordinator is connected to Research mode, explicit scoped source selection, editable plan review, persistent progress/cards/sidebar controls, and actionable completion notices. Source drafts survive reload; plan edits survive in-app navigation before acceptance. Validation: 124 targeted native/regression tests, native-backed browser flow, typecheck and a signed single-module build/API compatibility check passed. Production stays gated; the installed app and normal workspace were not changed. Historical milestone note: step 4 was the next step at this checkpoint; see the release status below. The browser publisher is a deterministic fixture, not a production artifact implementation.

1. **Native contract and recovery:** job schema/store, scheduler, typed IPC, generations, stop/finish/resume, quit behavior and capability declarations. Verify entirely with fake adapters and crash/restart tests.
2. **Research loop and source adapters:** capability negotiation, bounded stages, evidence/checking, existing connector read/search mappings and scope enforcement. Demonstrate supported OpenAI/Anthropic paths using current official API documentation; keep other models explicitly capability-gated. Do not weaken normal Chat limits or reopen unrelated connector backlog items.
3. **Chat experience:** Research composer mode, source picker, plan review, live card, sidebar indicators, navigation-safe subscriptions and actionable completion notification. Connect to the real native job lifecycle rather than a renderer-only simulation.
4. **Report artifacts:** Markdown report document, versioned citations/evidence, tables, chart datasets/specifications, rendered assets and Markdown/PDF export. Complete a cited table-and-chart report end to end.
5. **Integration/release:** failure/access/cancellation cases, navigation/restart, performance and artifact export verification; signed single-module compatibility checks and combined shell package. Restore the regular workspace after all isolated mutation tests.

Steps 1–4 together form the first complete feature; a source picker or progress card alone is not a finished release. Interactive chart widgets, scheduled research, cloud execution while zQ is closed, parallel researchers and new connector catalog integrations remain outside this initial implementation.

## Acceptance checks

- Start a deterministic research run, switch between multiple chats/tabs and Code/Notes, and return: same native job ID and progress, no duplicate requests, no missing sidebar entry. Ordinary Chat in a different conversation still works.
- Stop and Finish each behave as specified during collection/checking/writing. Repeat requests are idempotent; stale callback results cannot complete canceled work. Queued runs remain visibly queued.
- Quit/crash/restart at each checkpoint boundary: partial evidence survives, no automatic paid request, explicit resume continues remaining work. Simulate sleep/network interruption without claiming offline execution.
- Model/account/source configuration changes cannot silently reroute active work. Unsupported combinations fail before paid generation. Research honors connector scopes and rejects mutation tools despite misleading annotations.
- Known-answer research fixtures contain conflicting sources, duplicates, missing data and unsupported claims. Assert claim/source links resolve to stored evidence and gaps stay explicit; compare actual report quality separately from mechanical schema validity.
- Chart datasets match report values and transformations; units/labels/citations survive PDF and Markdown export. Reopen artifacts, inspect old versions, and test simultaneous user edits versus research publication.
- Renderer/provider/network/storage failures retain recoverable state. Schema migration preserves existing Chat/artifacts and ordinary queue/tool behavior. Job activity remains bounded and navigation responsiveness is measured under a large fixture run.
- Browser checks cover source menus, keyboard/focus, sidebar indicators, notification navigation, light/dark and reduced motion. Mutation tests use disposable workspaces; no real email/GitHub/file writes or paid-provider calls without explicit test authorization.
- Run typecheck, relevant Chat/provider/connector/artifact/native tests, isolated browser tests, signed Chat single-module build against the new shell capabilities, then the combined macOS package. Preserve normal sessions and Keychain helper identity when reopening.

## References

- [OpenAI deep research guide](https://developers.openai.com/api/docs/guides/deep-research): hosted background research and cited output; clarification/prompt preparation are separate application responsibilities. This is an optional future engine, not the chosen-model coordinator proposed above.
- [Anthropic research-system engineering account](https://www.anthropic.com/engineering/multi-agent-research-system): useful orchestration/evidence/evaluation reference; parallel-agent design is not a requirement for zQ's first release.
- `docs/research/provider-tools-core.md`, `docs/research/provider-tools-routing.md`, `docs/interoperability.md`, `docs/modules.md`: existing provider and module boundaries. Reverify changing API details against official documentation during implementation.

## Release status — 2026-09-20

Steps 1–4 are implemented in Chat 1.19.0 and the matching native shell. The production gate is removed with the real idempotent artifact publisher in place. Reports include immutable citations/evidence, typed tables, deterministic bar/line/scatter charts, Markdown/PDF/CSV/SVG exports, user-edited versions, and conflict-checked research follow-ups. Numeric chart transformations are deliberately limited to transcribed source values. Integration tests and packaged validation are recorded in `docs/chat-research.md`; live model/source quality remains a user evaluation task.

Step 5 complete: 326 native/regression tests passed (five optional checks skipped), typecheck and signed module compatibility checks passed, native-backed and packaged UI workflows passed, and PDF/light/dark visuals were inspected. The combined macOS app was updated at its existing release path and reopened in the regular workspace with Chat 1.19.0 active and no pending update. The previous app is retained under `.local-data/research-before-1.19.0-*`. The Keychain helper's signed bytes are unchanged. No paid-provider run was used for verification.
