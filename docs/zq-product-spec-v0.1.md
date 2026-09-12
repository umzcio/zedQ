# zQ / zedQ — product and architecture specification

Version: 0.1, 2026-09-07
Status: proposed design for discussion, not an approved implementation plan.

Design preview: Zach requested a clickable prototype and explicitly requires light and dark modes. `prototype/` now holds a separate browser prototype for visual feedback with sample data and local persistence. It is not the production desktop/server foundation. Earlier statements that no implementation exists refer to the design stage before this prototype.

This is the consolidated product document. The working brief records discovery and research; the zBrain inspection records evidence about the experiment. Confirmed requirements below come from Zach. Designs, delivery boundaries, and evaluation criteria are proposals unless explicitly labeled confirmed.

## 1. Product

zQ is Zach's personal desktop workspace for thinking, organizing, and doing. It brings projects, notes, tasks, conversations, memory, and ongoing agent work into one experience across three Macs.

Its central promise is continuity: open zQ, understand what needs attention, and return directly to the relevant work even when that work is running on another machine.

### Confirmed requirements

- A modular shell with capabilities added incrementally; a GitHub organization is the intended home.
- A lightweight coding workspace using existing AI CLIs: Claude, Codex, Grok, Kimi, OpenCode, bearcode, and extensible support for others.
- Code preserves each CLI's own supported account and usage arrangement. Chat and Work use model APIs and local endpoints.
- SSH/tailnet access to roughly ten machines, persistent sessions, visible real terminals, files, repositories, previews/ports, and integrated transfers.
- Notes support untitled scratch tabs and ordinary saved text/Markdown files, including local configuration files.
- Kanban for tracking unfinished work; assigning cards to agents is a future module.
- Gmail for personal email; Microsoft 365 for work, with Teams and calendar capabilities to investigate.
- Work handles file, email, Teams, and browser tasks.
- Shared memory across tools and machines, with normal Chat also allowed to use general knowledge and web research.
- Hosted providers include OpenAI, Anthropic, xAI, Google, and Perplexity. Multiple Ollama instances, vLLM, and compatible endpoints are required.
- Both workspace continuation across Macs and retaining a device's own layout.
- Preference for shadcn UI. Third-party extensibility matters; Open VSX compatibility is optional.
- An always-on machine is available. Cloud hosting is acceptable; backend access should remain private to the tailnet.
- Existing zBrain is experimental and replaceable.
- Use current stable dependency releases, verified when implementation begins; avoid outdated templates and remembered version defaults.

### Product boundaries

Machines are execution locations rather than the main product hierarchy. Fleet administration is outside scope. Full IDE parity, mandatory VS Code extension compatibility, and replacing the existing coding harnesses are outside the confirmed requirements.

## 2. Product structure

| Surface | Responsibility |
|---|---|
| HQ | Recent work, upcoming commitments, active sessions, and attention requests |
| Projects | Connect folders/checkouts, tasks, notes, conversations, and runs |
| Notes | Capture scratch text and edit files |
| Tasks | One task collection shown as Kanban and filtered by context/project |
| Chat | Persistent API-powered conversations with selected context and models |
| Code | Focused terminal, files, changes, and previews for coding projects |
| Work | Delegate tasks using tools and inspect progress/results |
| Memory | Inspect, search, correct, and manage shared knowledge |

Personal and work are context scopes, distinct from the Work execution mode. Project membership is optional for a note, task, or conversation.

## 3. Primary journeys

### Resume work on another Mac

Zach opens zQ on Mac B and sees the shared project/task/session collection. He can resume Mac A's saved workspace or retain Mac B's layout. Restoring a remote terminal reconnects to its existing execution host. It does not start a second CLI or move the process.

### Capture a thought

New scratch opens immediately without a naming dialog. The content is preserved locally and synchronized. Zach can later name it, attach it to a project, or save/export it as a regular file.

### Return to unfinished coding

A project or task links to the correct host, checkout, and persistent session. Zach opens the real CLI terminal, reviews output, edits a file if needed, and opens a preview. He can leave the project and close the client while the remote session continues.

### Ask with personal context

Chat retrieves relevant memory within the selected scope, combines it with the conversation and allowed knowledge/tools, and streams a response. Remembered and researched claims retain their source links. Changing the model does not discard the conversation record.

### Delegate everyday work

Zach asks Work to organize a folder or collect documents from a website. The task records the selected host/account, tools, progress, and outputs. He can inspect the task from another Mac. A step requiring an unavailable Mac waits until that resource is available.

## 4. Modules and shared contracts

### Navigation refinement — approved for prototype

Zach accepted the prototype as a starting direction, with refinements expected during development. Appearance has two independent choices: Light/Dark/System and Green/Blue/Red/Gunmetal color theme. The prototype exposes both under Settings → Appearance and persists them locally. Production themes should use shared semantic tokens across modules; color must not be the only indicator of selection or status.

Further feedback: the Red theme must coordinate its background surfaces with its accent rather than retaining Blue's cool gray surfaces. The prototype now gives Red warm light surfaces and warm charcoal dark surfaces, including appearance previews. Remove the decorative workspace identity card: a workspace selector is only useful when it performs actual switching. Multiple workspaces remain unimplemented; if introduced, use a functional dropdown with current selection, searchable workspaces, and a create action, following Zach's supplied references.

Avoid decorative controls and persistent filler labels. Remove the top-right design-preview/sample-workspace labels and duplicate avatar, and the bottom-right prototype tagline. Keep truthful local-save status. Candidate future uses are contextual actions in the top-right area and actual save/sync/connection status below, introduced only with working behavior. Rail tooltips must dismiss on click, pointer exit, blur, or Escape rather than remain latched to CSS hover/focus.

Zach also supplied a compact calendar/date/time reference for the bottom-right status area. Record this as a future option, not an immediate prototype change. A live local date/time display could later open the calendar or agenda through the date control once that functionality exists. Preserve room for operational status without crowding the footer.

Zach supplied a two-sidebar reference and approved trying a persistent narrow module rail plus a contextual sidebar. The shell owns the rail and shared utilities. Each module supplies the adjacent navigation and workspace. Collapsing the contextual sidebar leaves the module rail visible. Notes places its collections and note list in this second column rather than adding a third navigation column. Tasks supplies its views and project filters. Both light and dark modes cover the full navigation structure.

The prototype now demonstrates HQ, Notes, Tasks, and Settings through this structure. Chat, Code, and Work icons are labeled as planned and remain inactive; their presence is a visual preview, not an implementation commitment.

### First-release foundation proposal

#### Dependency version policy — confirmed preference

Zach explicitly wants current versions. At scaffolding time, verify official release information and package-registry stable tags for every selected core dependency, including React/React DOM, Electron, TypeScript, build tooling, styling, and shadcn tooling/components. Use current stable releases rather than prerelease/canary builds by default. Recheck when adding a later module; today's research is not a permanent version pin.

Validate peer dependencies, runtime/engine requirements, supported macOS versions on Zach's machines, and native-module packaging together. Do not silently select an older framework to accommodate a stale template or optional library: first evaluate a current alternative, then document and surface any necessary compatibility exception. React and React DOM must use matching versions.

Record the exact versions selected and verification date, commit the package-manager lockfile, and use reproducible installs. Avoid floating `latest` dependency declarations in the shipped project. Add automated dependency update proposals during repository setup; updates must pass the relevant checks before adoption. shadcn component source copied into the repository needs its own upstream-change review, beyond package updates.

Research checkpoint, 2026-09-07: the official React versions page lists the 19.2 line, with 19.2.7 as its newest listed patch. Revalidate against the registry before installation. [React versions](https://react.dev/versions), [Electron releases](https://releases.electronjs.org/), [TypeScript installation](https://www.typescriptlang.org/download/), [shadcn installation](https://ui.shadcn.com/docs/installation)

#### Recommended foundation

Zach approved proceeding with the shell, Notes, and manual Kanban while Code remains deferred. The following implementation choices are recommendations for review, not yet approved stack decisions.

Recommend Electron with React, TypeScript, and shadcn UI for the desktop. Electron supplies a web UI alongside a Node.js main process and utility processes, fitting the planned local file and future terminal integrations. Expose narrow, validated desktop operations through a context-isolated bridge; feature UI must not directly access arbitrary filesystem or process APIs. Keep long-running work outside the renderer and avoid blocking the main process. [Electron process model](https://www.electronjs.org/docs/latest/tutorial/process-model)

Tauri remains a viable alternative with external sidecar support, but would introduce a Rust/sidecar boundary for integrations implemented in Node. Electron is recommended here to reduce integration friction, accepting the footprint of a bundled browser/runtime. This is an engineering judgment, not a measured performance comparison. Node-pty is evidence of an available Node terminal integration path, not a selected Code dependency; its native-module packaging would still need validation. [Tauri sidecars](https://v2.tauri.app/develop/sidecar/), [node-pty](https://github.com/microsoft/node-pty)

For the first release, the shell presents HQ, Notes, Tasks, and Settings. HQ contains recent notes and tasks needing attention; later modules contribute their own entries when available. Notes and task boards open as restorable tabs, with a simple split view for working on a note alongside a board. Keep window/view state separate from note/task content so closing a tab does not delete its resource.

Implement only the module contracts exercised by Notes and Tasks: register a view, register a command, open a resource, and save/restore view state. Keep contributed IDs namespaced and persisted state versioned. Broader provider and runtime contracts in this document describe future boundaries; they do not require empty implementations in the first release.

First-release Notes includes scratch notes and local text/configuration files. Remote file browsing and transfer remain in the deferred remote-access scope. Scratch content synchronizes; opening a host-owned file preserves that identity and does not automatically copy its contents between Macs. Manual Tasks adds the board and note/project links without requiring an agent runtime.

Shared application data remains owned by one always-on service, with durable local recovery and queued edits on each Mac. The local app should open and permit Notes/Tasks work while disconnected. No database file is shared directly over a network filesystem. Select the persistence library, service host, and authentication/backup setup in the bounded foundation design before implementation.

The shell owns windows, navigation, tab/panel composition, command dispatch, theme, notifications, module activation, and layout restoration.

Feature modules own domain behavior and contribute views, commands, search results, card actions, and context providers through explicit contracts. They do not read another module's private tables or import its private UI internals.

A module declaration includes ID, version, supported platform API version, required capabilities, contributions, data migrations, activation/deactivation behavior, and view-state serialization. Disabling a module retains its data and leaves recognizable placeholders for saved views.

First-party modules initially build and release with the desktop application. Third-party installation later requires a versioned public API and a defined execution boundary. Runtime-downloadable plugins are not a prerequisite for modular development. Open VSX and MCP are distinct extension surfaces; neither is the complete zQ module contract.

### Shared objects

| Object | Minimum responsibility |
|---|---|
| Project | Stable ID, display name, context scope, references to working locations |
| Working location | Host ID, checkout/folder path, optional repository reference |
| Resource reference | Stable identity plus owning provider/account/host and locator |
| Note | ID, body, optional title/project, revision, creation/update metadata |
| Task | ID, title, status, optional description/project/due date, source links |
| Conversation | ID, scope, messages, attachments, model/connection attribution |
| Session reference | Host, runtime identity, persistent session locator, project link |
| Run | Task/conversation link, runtime, state, event sequence, results, execution location |
| Connection | Provider/protocol, endpoint identity, credential reference, capabilities |
| Workspace snapshot | Device origin, views/resources, active selection, layout, view-state versions |
| Memory record | Evidence, scope, provenance, temporal/update status, backend reference |

IDs are stable independently of display names and paths. Two projects with the same directory basename are not automatically merged.

## 5. Deployment and state ownership

### Recommended topology

- A desktop client on each Mac provides the UI, local files, local recovery state, and the local tool bridge.
- One always-on host provides the shared application service, durable data, memory service, and background Work execution.
- Existing project machines retain their repositories, tmux sessions, coding CLIs, and running applications.
- Backend access is private over the tailnet. Hosted model/provider integrations use outbound authenticated connections.

Tailscale Serve is a candidate for private HTTPS access and honors tailnet access rules. Its documentation distinguishes Serve's private access from public Funnel access. [Tailscale Serve](https://tailscale.com/docs/features/tailscale-serve)

Package the shared service for relocation to a cloud VM later. Define storage migration and configuration boundaries without selecting AWS/Azure/Cloudflare infrastructure prematurely. No provider deployment is included in this design stage.

### Proposed state rules

- Shared notes/tasks/conversations have an authoritative server revision plus locally durable pending operations.
- Each submitted mutation has a stable operation ID so retrying after a disconnect does not duplicate it.
- Concurrent edits must not silently discard text. For initial Notes, preserve a conflicting revision for resolution rather than requiring real-time collaborative editing.
- Layouts are saved per device with explicit cross-device restore. They do not continuously force active windows on other Macs into the same arrangement.
- Original files belong to their execution hosts. A reference to a local file is not an automatic copy of that file into shared storage.
- A disconnected view is distinct from a stopped process. Query the owner before assigning an execution state after reconnection.
- Local unsynchronized edits remain available during backend outages; operations needing an unreachable host show their dependency.

### Reliability requirements

Services restart automatically. Backups cover application data, memory operational state, source archives, and relevant history. Restore is tested with a separate destination. A home host remains dependent on its power and internet; the UI reports unavailability without implying data loss or task completion.

## 6. Notes

- Support untitled scratch tabs with automatic local preservation and synchronization.
- Support local/remote file tabs with text editing and explicit file identity.
- Preserve edited-file recovery drafts separately from saving to the underlying file.
- Permit naming, project linking, and text/Markdown export of scratch notes.
- Reuse editor components with Code where useful.
- Restore selection/scroll/tab state, adapting layout dimensions to the destination screen.
- File-draft cross-device synchronization follows the resource's selected policy; opening a local `.env` is not authorization to copy or index it.
- Indexing notes into memory and promoting facts are separate from the basic save operation.

Acceptance: create an untitled note, restart the client, and recover it; sync it to another Mac; edit a real file without losing an unsaved recovery draft; preserve both versions of a conflicting edit.

## 7. Tasks and future assignment

Proposed board: Inbox, Next, Doing, Waiting, Done. A title is the only required card field. Cards can link to projects, notes, messages, sessions, and artifacts. Filters create different views of the same task collection.

Agent process completion does not automatically establish that a task is done. The user can inspect results and change task status.

The later assignment module contributes an Assign to agent action. Coding assignments select an existing CLI/host; Work assignments select an API-backed runtime/tool context. Each attempt becomes a separate run with preserved history and results. Only supported harness capabilities are exposed; an interactive terminal does not imply unattended task submission.

Acceptance: create and move a card, restore its state on another Mac, and open its source resource. Initial delivery does not require agent dispatch.

## 8. Code — implementation deferred while Zach researches options

Code remains in the product scope. Zach wants time to research Herdr before selecting an approach. Its runtime selection and detailed interaction design do not block Shell, Notes, or manual Tasks. Preserve the requirements below without treating Herdr as an adopted dependency.

### Baseline

1. Add/open a local project or saved SSH host/path.
2. Link an existing checkout or clone a selected GitHub repository onto a selected host.
3. Discover and attach existing tmux sessions, including those created outside zQ; support creating a session when needed.
4. Run the actual installed CLI through an interactive terminal, preserving its own account flow.
5. Browse and edit files, inspect changes, and open a forwarded preview.
6. Switch between projects/sessions and reconnect after closing the client.

Zach supplied Herdr as a reference for the Code experience. Proposed default workspace: project/session navigation, a prominent terminal, and file/change/preview tabs available alongside it. An activity overview aggregates sessions across projects; selecting a session opens its real terminal. This reference sharpens the direction but does not select Herdr as the implementation.

### Existing SSH access

Use the Mac's system OpenSSH and existing host configuration, including configured includes, identity files, agent access, and jump hosts. Bash/zsh launches SSH; the SSH configuration and authentication services supply connection behavior. Do not require importing private keys into zQ or synchronizing them through the shared backend. Each Mac must have working access of its own. [OpenSSH configuration](https://man.openbsd.org/ssh_config)

Host suggestions may come from explicit SSH Host entries, with manual alias entry for wildcard/dynamic configurations. A saved project references a host alias and remote path. Validate GUI-launched agent availability and passphrase/Keychain interaction: an app opened from the Dock may not inherit the terminal shell's environment. Shell aliases/functions are not SSH Host entries. Authentication failures retain the target and provide an interactive recovery path.

### Herdr reference and reuse evaluation

Herdr is a terminal application with a persistent background server, real CLI panes, and remote access through normal OpenSSH. Its remote documentation describes individual terminal attach plus observer/controller streams for third-party bridges. These make it a plausible Code runtime adapter beneath zQ's desktop interface; they do not establish a ready-made desktop SDK. [Herdr](https://github.com/herdrdev/herdr), [remote access and terminal bridges](https://herdr.dev/docs/persistence-remote/)

Evaluate two implementations against the same user journey: system SSH plus existing tmux, and a Herdr adapter for Herdr-owned sessions. Preserve access to existing tmux sessions regardless of the choice. Herdr does not inspect tmux sessions nested inside a pane, so placing tmux inside Herdr is not sufficient for agent status. Its status authority varies by agent: some integrations provide lifecycle events; others infer state from terminal screens. zQ must retain the status source and distinguish inferred, verified, stale, and unknown state. [Herdr agent detection](https://herdr.dev/docs/agents/)

The evaluation must demonstrate interactive terminal fidelity, disconnect/reconnect, cross-Mac input ownership, activity updates without focusing a pane, and compatibility with Zach's actual CLI versions (including custom tools). Check bridge version compatibility and recovery before selecting it. Herdr's documented restart restoration rebuilds layout and may resume supported agent conversations; it does not preserve arbitrary running processes after its server stops. [Herdr persistence](https://herdr.dev/docs/session-state/)

### Required distinctions

- A terminal is a first-class interactive surface, including CLI prompts and tool-specific interfaces.
- Terminal rendering, SSH transport, process persistence, and semantic agent events are separate capabilities.
- Generic sessions report observable connectivity/process/output state. Rich agent status is shown only when supported by a verified integration.
- Supported runtime capabilities include separate flags for launch, attach, structured events, task submission, interrupt/cancel, resume, and memory injection.
- Scope each SSH session by host and remote user. Privilege escalation, if needed for a project, is an explicit supported connection behavior rather than an assumed global root session.
- Remote tmux persistence survives client disconnects, not host reboot. Host reboot is a separate failure/recovery case.
- Multiple viewers must not accidentally interleave terminal input; define active-input ownership before enabling simultaneous control.

tmux documents detach/reattach and remote session access from multiple computers. Monaco and xterm.js provide embeddable editor/terminal UI; the transport and persistence services remain separate. [tmux](https://github.com/tmux/tmux/wiki/Getting-Started), [Monaco](https://github.com/microsoft/monaco-editor), [xterm.js](https://xtermjs.org/)

### Files, Git, and transfers

Support browsing/searching, editing text/configuration, readable diffs, and selected Git/GitHub operations based on the finalized workflow. Transfers show source and destination host/path, progress, partial failures, and overwrite conflicts. A queued transfer persists its intent; resumability is advertised only for supported transfer mechanisms. Bulk transfer is part of the product target, though a first Code slice can begin with individual files.

Acceptance: attach an externally created session, interact with a chosen authenticated CLI, close zQ, reconnect from another Mac, and reach the same process; edit a remote file; preview a forwarded application; transfer a file to the chosen location; report an unreachable host without losing session references.

## 9. Chat and model connections

Named connections identify endpoint and model separately. Multiple Ollama/vLLM hosts can expose identical model names. A model picker shows both identities.

Use provider-native adapters where needed and compatible protocols where supported. Track verified capabilities for tools, images, structured output, and context limits. Changing from a local endpoint to a hosted provider requires a chosen fallback policy or an explicit selection. Ollama documents partial OpenAI API compatibility, so protocol shape alone does not prove complete feature parity. [Ollama compatibility](https://docs.ollama.com/api/openai-compatibility)

Conversations are durable and shared. Preserve messages and model attribution across model changes. Context assembly selects relevant history/memory within a bounded budget. Normal answers may use general knowledge, memory, and web research. Source links distinguish research from personal memory. A notes-only view remains optional.

Interrupted requests preserve partial output and error state. Retrying produces an identifiable new attempt instead of duplicating the user's message or silently replacing a prior result. Usage is recorded when reported; estimated costs are labeled as estimates.

Acceptance: continue a conversation across Macs, choose between two endpoints serving the same model name, inspect cited memory/web sources, and recover an interrupted response with a visible retry.

## 10. Shared memory

### Contract

The zQ-facing service supports capture, recall, remember, correct, forget, and brief through versioned interfaces. It retains source attribution, project/account scope, event time, and update history. Backends may implement these differently; the shell does not depend on vendor tables.

Keep source archive, extracted memory, search indexes, and live agent session state distinct. Retrying source ingestion is idempotent. Corrections supersede prior claims with traceable evidence. Deletion rules cover extracted records and future recapture from retained sources. Automatic collection and automatic promotion to trusted facts remain a user-policy decision.

### Backend evaluation

Evaluate Hindsight, Mem0, and extending zBrain against the same labeled examples. A new custom service is the fallback if existing approaches miss essential requirements. No engine is selected. Hindsight documents self-hosting and coding-agent integrations; Mem0 documents configurable library/server deployment. Vendor claims are starting evidence, not validation against Zach's tools. [Hindsight](https://github.com/vectorize-io/hindsight), [integrations](https://github.com/vectorize-io/hindsight/blob/main/hindsight-integrations/README.md), [Mem0](https://docs.mem0.ai/open-source/overview)

Existing zBrain has useful capture adapters and a corpus. Inspection found working health/search, but source capture, context injection, retrieval scope, and fact correction need separate evaluation. Preserve its data until a migration is verified. See [inspection](zbrain-inspection-2026-09-07.md).

### Selection exercise

Use a small labeled dataset with cross-tool recall, corrected decisions, similarly named projects, personal/work scoping, repeated captures, deletion/recapture, and offline delivery. Measure answer support, relevance, latency, context size, and processing cost. Verify hooks/account behavior on actual CLI versions. Select one initial engine after this comparison; do not ship a multi-engine administration interface in v1.

Acceptance: a decision captured through one supported tool is recalled through another on a different machine; a correction changes subsequent retrieval; excluded scope does not leak through semantic search; deletion survives recapture according to policy.

## 11. Work

A general tool-using runtime owns each task and its durable execution state. A selected model supplies reasoning through APIs; tool connections provide actions.

Initial scenarios: organize files, triage email and prepare replies, summarize Teams requests, and navigate a portal to retrieve documents. Combine capabilities only once their individual behavior is reliable.

LangChain/LangGraph is a candidate custom-runtime path. LangChain agents use LangGraph; persistent execution requires durable storage and intentional retry handling. Reusing OpenWork is an alternative involving its OpenCode engine. Choose one primary execution owner. Hermes/OpenClaw remain integration candidates rather than required dependencies. [LangChain](https://docs.langchain.com/oss/javascript/langchain/overview), [LangGraph persistence](https://docs.langchain.com/oss/javascript/langgraph/persistence), [OpenWork](https://github.com/different-ai/openwork)

Tools execute on explicit hosts/accounts. A task dependent on a sleeping Mac waits; a hosted browser session is a different resource from the user's local signed-in browser. Browser automation must define profile ownership, login handoff, download destination, and local/server execution. Playwright MCP is a candidate integration. [Playwright MCP](https://github.com/microsoft/playwright-mcp)

Model-generated UI through OpenUI Lang is optional for task results, forms, and comparisons. Stable navigation and controls are built in the normal shell. Generated actions route through validated application commands. [OpenUI](https://github.com/thesysdev/openui)

Acceptance: complete a selected file task with a clear result; resume a server-owned task after closing the client; wait correctly for a missing local dependency; prevent a retried task step from duplicating an external action.

## 12. Email, calendar, and Teams

Gmail and M365 are separate connections with consistent zQ views and explicit account identity. Preserve source links when creating notes/tasks. Calendar scope and exact desired actions require a short follow-up once the core workspace is settled.

Use Gmail APIs and Microsoft Graph for supported operations. Validate tenant permissions separately for Outlook and Teams. Do not equate a successful email connection with Teams access. Microsoft documents delegated access constrained by both application permissions and the signed-in user's access. [Gmail](https://developers.google.com/workspace/gmail/api/guides), [Graph permissions](https://learn.microsoft.com/en-us/graph/permissions-overview), [Teams messages](https://learn.microsoft.com/en-us/graph/api/chat-list-messages?view=graph-rest-1.0)

Provider event delivery must work with the tailnet-only backend. Choose polling or an appropriate event transport explicitly; a private tailnet URL is not a public webhook receiver.

Account access, task execution authority, and durable memory ingestion have separate settings. Browser automation does not bypass unavailable account permissions.

## 13. Architecture decisions to validate

| Decision | Current direction | Evidence needed before commitment |
|---|---|---|
| Desktop foundation | Recommend Electron + React/TypeScript + shadcn; Tauri alternative | Review recommendation, validate local files, packaging and desktop bridge; full Code runtime deferred |
| Full IDE framework | Not leading | Reconsider only if actual required capabilities justify it |
| Code session runtime | Deferred; preserve existing SSH/tmux access, Herdr is a research candidate | Existing session access, terminal bridge, real CLI status, cross-Mac control and recovery |
| Shared host | Existing always-on machine, private tailnet access | Host selection, backup destination, service lifecycle |
| Shared data implementation | Central revisions and locally durable operations | Offline/conflict prototype and restore behavior |
| Memory | Hindsight/Mem0/zBrain comparison | Same-corpus quality and real CLI integration exercise |
| Work runtime | LangChain/LangGraph or reuse OpenWork | Representative file/browser/connector task |
| Third-party extensions | Versioned zQ capability/contribution API | Concrete plugin use cases and process boundary |
| Automatic memory | Undecided | User preference for capture and fact promotion |

SwiftUI is technically compatible with cross-device sync, so the desktop decision rests on integration fit. Standalone Monaco does not provide VS Code extension compatibility; that compatibility is optional here. [Apple sync](https://developer.apple.com/documentation/swiftdata/syncing-model-data-across-a-persons-devices), [Monaco FAQ](https://github.com/microsoft/monaco-editor)

## 14. Proposed delivery sequence

The overall spec describes the destination; each delivery slice receives its own implementation plan and bounded acceptance checks.

| Slice | User-visible result | Exit evidence |
|---|---|---|
| Foundation validation | Chosen desktop/shared-data approach with room for later Code integration | Local resource access, sync and restoration validated; desktop bridge can support future processes and streams |
| 1. Shell and Notes | A useful desktop scratchpad with cross-Mac continuity | Local recovery, sync, restore, conflict preservation |
| 2. Tasks | Manual Kanban linked to notes/projects | Durable cards and reliable return-to-work links |
| Later: Code core | Open projects, attach real remote CLIs, edit files, see previews | Same remote session survives client closure and Mac switch |
| Later: Chat and Memory | API/local-model chat with useful shared memory | Cross-tool recall, corrections, scopes, persistent conversations |
| Later: Work and connections | Files/browser tasks plus Gmail/M365 capabilities incrementally | End-to-end tasks on verified accounts/hosts |
| Later: Agent assignment | Dispatch supported agents from cards | Distinct runs/results, reconnect without duplicate dispatch |

With Code deferred, the proposed first daily-use release is shell, Notes, and manual Kanban. Later modules can proceed when their own designs are ready; memory engine selection does not block Notes or Tasks storage. This updates the earlier proposal to include Code in the first release.

Foundation decisions still affect downstream work. Define local/remote resource identity, stable project/task links, module-contributed views and commands, versioned layout restoration, and ownership of shared versus device-local data. Ensure the desktop bridge can later support native processes, terminal streams, and file access. Keep runtime-specific session IDs behind adapters and out of core task/note schemas. Add capabilities as real modules need them rather than attempting a complete universal plugin/runtime API now. Modularity limits the scope of future changes; it does not guarantee zero rework.

## 15. Repository and development strategy

Use a GitHub organization and one primary repository for new tightly connected modules, shared interfaces, UI components, and application builds. Keep independent upstream forks/integrations in separate repositories when they have their own lifecycle. Do not split every module into a separately deployed service.

Proposed layout: `apps/desktop`, `apps/server`, `packages/platform`, `packages/module-api`, `packages/ui`, `modules/*`, `integrations/*`, and `docs/*`. The memory engine's language/runtime can differ from the desktop's.

Before implementation, select the shell and shared-data approach and turn the approved first slice into an implementation plan. Detailed Code design is deferred and is not a prerequisite for the first slice. Organization name availability, repository visibility, and creation are separate setup decisions. No organization, repository, deployment, or product implementation has been created during this design discussion.

## 16. Next design review

Focus on the shell, shared-data ownership, and Notes/Tasks first-release experience. Compare desktop foundations against the known local-file and future terminal requirements without selecting a Code runtime. Resume detailed Code review after Zach has researched Herdr and other options.


### Desktop foundation checkpoint — September 7, 2026

The first local desktop milestone now lives in `apps/desktop`. It uses the approved design with native versioned atomic local stores, sandboxed IPC, real file dialogs, UTF-8 editing/recovery and conflict checks, plus persistent Notes/Tasks/appearance/basic layout. `packages/module-api` and `modules/core` establish the internal module catalog; public plugin APIs are not shipped. The original browser prototype is retained separately.

This checkpoint precedes shared-data implementation. Local JSON storage is behind native service boundaries, not a choice of the eventual synchronization database. File drafts are device-owned and separate from shared-candidate workspace content. The packaged target currently covers Apple Silicon Macs running macOS 13 or later; other machines need compatibility checks.

Terminal process attachment and the explicitly selected Ollama endpoint have native runtime checks. Zach's known-working test endpoint is `http://127.0.0.1:11434/`. Use that endpoint for subsequent model validation unless Zach selects another; do not start a local Ollama service as a substitute. Full Code, Chat and Work modules and cross-Mac synchronization remain unimplemented.
# Dropdown consistency

Use the shared shadcn Select for in-app dropdowns across modules. Project filters, note projects, task status, task projects, and priority use the same themed trigger, menu, focus, and selection styling. Match light/dark/system appearance and the selected color palette. Preserve keyboard navigation and Escape dismissal. Native macOS app menus and file dialogs remain system controls.

## Document tab interactions — implemented

Notes and local files share one tab strip. Drag tabs to reorder with a visible insertion marker; the shadcn context menu offers Close tab, Close other tabs, Close tabs to the right, Close all tabs, and Move left/right. Middle-click closes a tab. Arrow/Home/End navigation, Delete-to-close, and Option–Shift–Left/Right reordering are available while a tab is focused. Closing affects the view only: notes and local recovery drafts are retained. Desktop order and open tabs persist across restarts, with migration from the original note-only tab layout. Both desktop and browser prototype use the same components.

Validation: 45 tests pass, both production builds pass, and CUA verified note/file reordering, order restored after restart, and file-tab closure retaining the draft without writing the original file.

Note actions: Sidebar scratchpads and HQ pinned notes now share a shadcn context menu with Open note, Rename, and Pin/Unpin. Note tabs include the same Rename and Pin/Unpin actions ahead of tab controls; double-clicking a note tab also opens Rename. The dialog preselects the current name, rejects blank names, and updates the note by ID across sidebar, tab, and editor. File names remain filesystem-managed. Verified renaming and persistence in the isolated desktop workspace; both builds pass.

Sidebar density: Scratchpads use compact 32px rows with a file icon, single-line title, and optional pin indicator. Previews, project labels, and timestamps are removed from these rows. Right-click note actions remain available on the entire row.

### Desktop Chat milestone — September 8, 2026

Chat is enabled in the desktop shell. Settings supports named Ollama connections, endpoint testing and editing. Each conversation stores its connection and model choice. The native process owns bounded streaming requests, so changing modules leaves responses running. Stop preserves partial output; restart marks unfinished output interrupted. Saved history and explicitly selected note snapshots use a separate private, atomic `chat.json` store on this Mac.

Attachments are selected Notes only (up to ten, 100 KB total). Notes are flushed before snapshotting. Prior attachments remain part of the conversation context; local file contents are never implicitly included. Responses render as safe Markdown, with collapsible thinking/reference sections. No model tools or execution are enabled. Composer drafts survive module/conversation navigation during the current session; unsent drafts are not yet saved across restarts.

Initial limits: three concurrent conversations, 64 KB submitted messages, 512 KB conversation prompt, 2 MiB generated content/thinking, 32 MiB total chat storage with reserved finalization space. Metadata explicitly declaring non-completion models is filtered from the model list. Cloud API adapters, Work integrations, conversation export/deletion and cross-Mac sync remain subsequent work.

Verified with the packaged app using the approved model-server tailnet Ollama endpoint and installed gemma4:latest: connection test, model choice, selected fixture note response, generation across module navigation, draft retention, Stop, and saved history after quit/reopen. No models were downloaded and no local Ollama service was started. Native provider/service and existing workspace checks: 88 passing tests. Light/dark Chat UI inspected, including a long conversation and fixed shell/scroll-pane sizing.


### Chat visual redesign — September 8, 2026

User feedback: Chat should feel closer to ChatGPT/Claude; the initial screen felt clunky and boxy. The desktop Chat view now has a centered new-conversation composer that moves below the thread after sending, a single model trigger inside the composer, an app-styled searchable model popover, a compact attachment button, restrained right-aligned user bubbles, and unboxed assistant responses. The two-navigation shell and existing appearance palettes remain. Refresh/settings actions are inside the model popover instead of a permanent toolbar/footer. Connection endpoints appear only in connection settings.

Replies render headings, lists, emphasis, tables, and fenced code using react-markdown 10.1.0 and remark-gfm 4.0.1 (current registry releases at implementation). HTML is skipped and remote images/links remain inert. No model output executes. Verified a live short Markdown response with the supplied Ollama endpoint, existing long-history rendering, light/dark layouts, model filtering/selection, and composer focus. Existing native/storage suite: 88 passing tests.


### Chat motion polish — September 8, 2026

Installed/imported tw-animate-css 1.4.0, the animation utility package used by shadcn. Shared popover and dialog transitions now resolve to real CSS animations. Chat adds once-only entry for new messages (not replayed on streaming updates or history navigation), a 280 ms first-send composer translation, animated thinking activity, Radix Collapsible thinking sections, attachment-chip entry, and send/stop icon transitions. CSS and native Web Animations respect prefers-reduced-motion. Model endpoint URLs were removed from the model picker and remain in connection settings. Verified packaged UI menu open/Escape dismissal, thinking expansion/collapse, and a live first-send response against the approved Ollama endpoint.

## Module architecture correction — September 9, 2026

The navigation-only `modules/core` catalog is superseded. HQ, Notes, Tasks and Chat now each own their renderer entry, behavior and styles under `modules/*`, build separately, and load from signed local packages through shell API version 1. Shared shadcn UI lives in `packages/ui`; model provider implementation lives in `packages/providers`. The shell controls native capabilities, storage and close/flush. Settings → Modules supports signed file or HTTPS installation, next-launch activation and rollback. Existing first-party modules can update without rebuilding the desktop; new identities/native capabilities and breaking SDK changes need a shell release. There is no untrusted third-party plugin isolation, hosted update catalog or cross-Mac update synchronization. See `docs/modules.md` for exact build/release commands and verified behavior.
