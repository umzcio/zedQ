# zQ / zedQ — working product brief

Date: 2026-09-07
Status: discovery draft; requirements and architecture are not yet finalized.

Consolidated product design: [zQ product spec v0.1](zq-product-spec-v0.1.md). This brief retains discovery details; the consolidated spec is the primary document for the next design review.

## Product intent

Zach wants one personal HQ for daily work, with continuity across three Macs. The product is a productivity workspace. Fleet administration is explicitly outside its purpose.

The central experience should connect projects, notes, tasks, conversations, personal memory, and ongoing agent work. Machines provide places to work; they should not become the organizing principle of the product.

## Requirements stated by Zach

- Product name: zQ or zedQ, using a lowercase z.
- Brainstorm collaboratively and produce a full specification supported by current web research.
- Explore Code last, with dedicated attention to the existing workflow.
- Daily tools include Tailscale/tailnet, SSH, iTerm2, Atom, tmux, GitHub, FileZilla, and occasional scp.
- Approximately ten machines host different projects and CLI sessions.
- Typical remote workflow: SSH to a tailnet host, create or attach a named tmux session, enter a project directory, start an AI CLI, detach, and return later.
- Existing AI CLIs include Claude, Grok, Codex, Kimi, OpenCode, and Zach's custom bearcode tool.
- Closing the laptop must not terminate work running on a remote machine.
- Provide a clean GUI for seeing ongoing CLI work, progress, and updates while preserving access to the actual terminal.
- Provide notes/scratchpad and text editing, including direct editing of local files such as `.env`.
- Provide Kanban/task management and email/calendar integrations.
- Explore agents, including Hermes and OpenClaw.
- Organize AI interactions into Chat, Code, and Work; OpenWork is a possible basis for Work.
- Code should explore SSH connections, file trees, chats, terminals, consoles, and ports. Open VSX was an example of convenient third-party extensibility, not a required marketplace or compatibility target.
- Clarification: Zach wants a lightweight coding workspace for a vibe-coding workflow, not a full IDE. “IDE” primarily referred to convenient remote-server access, GitHub repositories, files, and terminals. Do not infer a need for a comprehensive software-engineering workbench.
- Coding must run through Zach's existing company-provided or custom CLI harnesses, preserving their existing authentication and usage/billing path. Zach wants to use his provider subscriptions for coding rather than replacing those harnesses with zQ-owned model API calls. Verify each CLI's supported account mode during integration; do not assume all providers have identical subscription entitlements.
- Integrate bulk uploads/downloads and occasional single-file transfers so FileZilla is no longer necessary.
- Support third-party plugins with limited custom modification.
- Support hosted models from OpenAI, Anthropic, xAI, Google, and Perplexity, plus multiple Ollama instances, vLLM, and other endpoints.
- Confirmed mode split: Chat and Work use model APIs, including Ollama/vLLM endpoints. Code uses existing authenticated CLI harnesses. This is a product decision; it does not assert universal provider restrictions on other integrations.
- Build a shared personal memory/second brain from existing data and make it usable across CLIs and future chats.
- SwiftUI was an initial possibility; synchronization is a concern.
- Zach likes shadcn/ui and has asked specifically about OpenUI Lang alongside LangChain/LangGraph. Evaluate Thesys OpenUI Lang for generated UI; do not conflate it with Open WebUI.
- Cross-Mac continuity must support both shared content/running sessions and resuming tabs/panels/layout, while also allowing a Mac to retain its own layout.
- Zach proposes a GitHub organization with a zQ shell and modules added incrementally. Repository topology and organization creation are not yet decided or performed.
- Zach has an always-on machine available. Cloud hosting is also acceptable, with shared zQ services accessible only through the tailnet; he suspects cloud hosting may be unnecessary for v1. Exact host and hosting location remain unselected.
- Work use cases identified by Zach: file management, email management, Microsoft Teams tasks, and browser tasks. Exact accounts and automation depth remain to be clarified; the examples below are design proposals.
- Email accounts confirmed: Gmail for personal use and Microsoft 365 for work. Teams is a requested work capability; its exact tenant/account permissions still need validation.
- Existing memory project: Zach authorized inspecting `/projects/zBrain` on `model-server`. The 2026-09-07 read-only inspection found a running implementation with a Markdown vault, FastAPI, SQLite/LanceDB, Ollama, source adapters, MCP tools, curation, and CLI brief hooks. See `zbrain-inspection-2026-09-07.md` for evidence and verification limits.
- Subsequent clarification: zBrain is a weekend experiment, not a production commitment. Zach is open to replacing it with something better across all machines and tools. The memory engine, storage, and architecture remain open decisions; the earlier recommendation to retain its backend is superseded by comparative evaluation.
- Confirmed: normal zQ Chat may use general knowledge and web research alongside zBrain memory. The earlier aspiration to use the second brain for future chats does not require all normal answers to be supported exclusively by the vault.
- Notes workflow confirmed: Zach uses both unsaved Atom tabs for scratch work and saved text/Markdown files. Both need first-class support.
- Task workflow confirmed: Zach currently uses no task-tracking system and thinks a Kanban board could help. Design for easy capture and finding unfinished work; there is no existing task system to migrate.
- Future module requested: assign tasks to agents from the Kanban board. Preserve this direction in the task/module contracts while keeping initial Kanban delivery lightweight.

## Proposed product model — for discussion

- **HQ:** recent work, tasks, upcoming commitments, and sessions needing attention.
- **Projects:** shared context connecting repositories, folders, notes, tasks, chats, artifacts, and sessions. A project need not contain code.
- **Chat:** conversations using a selected model and relevant personal/project context.
- **Code:** a lightweight workspace centered on projects and running coding agents, with local/remote files, terminals, GitHub access, and previews.
- **Work:** delegated tasks using documents, tools, and integrations, with inspectable outputs.
- **Memory:** shared records with sources, scope, correction, and deletion; accessible from all modes and supported external CLIs.

These are proposed relationships, not approved navigation or layout decisions.

## Research findings

### Native UI and synchronization are separate decisions

Apple documents cross-device data synchronization through SwiftData and CloudKit. SwiftUI is therefore not excluded by the need to use three Macs. The harder fit question is the editor/terminal/extension ecosystem and the desired reuse of web UI components.

Source: https://developer.apple.com/documentation/swiftdata/syncing-model-data-across-a-persons-devices

### An IDE framework is materially different from an editor widget

Theia supports desktop and browser deployments with separate frontend and backend processes. Its extension system supports VS Code extensions and uses Open VSX by default. Compatibility of Zach's actual required extensions still needs validation; registry availability alone does not establish compatibility.

Sources:
- https://theia-ide.org/docs/architecture/
- https://theia-ide.org/docs/extensions/
- https://open-vsx.org/

Monaco supplies an editor, but its own FAQ explicitly states that VS Code extensions do not simply run in standalone Monaco. A custom shell needs only the surrounding services required by the selected workflows; it needs an extension runtime if VS Code extension compatibility is retained as a requirement.

Source: https://github.com/microsoft/monaco-editor

### Terminal continuity and semantic agent status are separate capabilities

tmux explicitly supports detaching, reconnecting, and accessing remote programs from different computers. Keeping execution on the project host and attaching clients fits the current workflow. This does not provide recovery from host reboot or guarantee accurate interpretation of what an AI agent is doing.

Source: https://github.com/tmux/tmux/wiki/Getting-Started

ACP standardizes editor/agent communication. Its documentation states that full remote-agent support remains a work in progress. Evaluate ACP where supported, native agent interfaces where useful, and terminal-only access as a compatibility baseline. Do not promise uniform structured progress across all arbitrary CLIs.

Source: https://agentclientprotocol.com/get-started/introduction

### OpenWork is a reuse candidate with an existing runtime choice

OpenWork describes itself as a Cowork alternative powered by OpenCode. Its suitability as a fork, an integrated runtime, or design inspiration needs examination before choosing the Work implementation.

Source: https://github.com/different-ai/openwork

### OpenUI Lang and Open WebUI are different candidates

Zach has now asked about OpenUI Lang. Thesys OpenUI defines a language and rendering infrastructure for model-generated interfaces composed from registered components. It can supply rich responses in Chat/Work; it does not determine zQ's desktop shell, synchronization, or coding CLI integration. Open WebUI was an earlier conditional interpretation and is not a selected foundation.

Sources:
- https://github.com/thesysdev/openui
- https://docs.openwebui.com/getting-started/quick-start/connect-a-provider/
- https://docs.openwebui.com/features/

## Architecture candidates — provisional

1. **Custom web UI in a desktop shell:** current leading proposal following Zach's lightweight-Code and optional-Open-VSX clarifications. Compose a shadcn-based HQ with focused editing, terminal, file access, Git/GitHub, and preview capabilities. Electron versus Tauri remains undecided. Third-party extensibility is required as a design direction; VS Code/Open VSX compatibility is optional.
2. **Theia-based desktop workspace:** secondary alternative only if future requirements justify its infrastructure. Full IDE behavior and VS Code extension compatibility are not product requirements. Remote connectivity and custom UI integration need a feasibility assessment.
3. **SwiftUI application with selected embedded web surfaces:** viable native option, with more integration work anticipated for the requested web/IDE ecosystem. Synchronization alone is not a reason to reject it.

Across these candidates, evaluate shared workspace storage independently from per-Mac UI state and host-owned execution. Shared application state does not imply automatic synchronization of repositories, secrets, or arbitrary local files.

### Lightweight Code scope — proposed interpretation

The primary journey is opening a project on a chosen host, starting or reconnecting to an existing AI CLI, watching its actual terminal, editing a file when needed, inspecting changes, and opening the running result. Detailed Code discovery remains scheduled for later.

Candidate capabilities:
- Saved SSH/tailnet connections and project locations.
- Open an existing checkout or clone a GitHub repository onto the chosen local/remote host.
- File tree, search, text editing, and uploads/downloads.
- Real interactive terminal views backed by persistent remote sessions.
- Session overview and attention indicators where supported by the agent integration.
- Readable diffs and selected Git/GitHub actions, to be specified from actual usage.
- Port forwarding and app previews.

Monaco and xterm.js are candidate UI components for editing and terminal rendering. They do not supply the remote filesystem, SSH transport, or process persistence by themselves; those belong to backend adapters. This supports a modular custom shell without implying a full IDE implementation.

Sources:
- https://github.com/microsoft/monaco-editor
- https://xtermjs.org/

### Coding harness integration — clarified requirement

zQ acts as a client for the actual coding CLI running on the selected project host. It launches or reconnects to that CLI in a persistent session, renders its real terminal, and provides surrounding files, changes, previews, and workspace context. The CLI retains responsibility for its own agent loop, model access, and account authentication.

Proposed integration levels:
- Baseline: launch/attach, interactive terminal, host/project association, and persistence through client disconnects.
- Enhanced: supported native hooks or interfaces add structured activity, attention notifications, and session metadata while retaining the CLI's supported account path.
- Compatibility: arbitrary/custom tools such as bearcode remain usable through the terminal even when enhanced integration is unavailable.

No silent substitution of direct model API calls when a CLI integration or account mode is unavailable. Authentication should remain in the supported CLI flow on its execution host; do not copy private subscription tokens into a zQ provider gateway. Exact account support is verified per integration.

### Chat and Work model access — confirmed direction

Chat and Work use model APIs, including hosted providers and Zach's Ollama/vLLM servers. Code continues to use existing CLI harnesses and their authentication/usage arrangements.

Proposed shared model service for Chat and Work:
- Named connections with distinct endpoint IDs, protocol/provider type, base URL, credential reference, and available models. Several servers may expose the same model name.
- A common model picker showing both model and connection so Zach can select the intended server.
- Provider adapters that preserve native capabilities where needed, with OpenAI-compatible connections for endpoints that support them.
- Capability metadata for tool calls, image inputs, structured output, and context limits, validated against the selected model/server configuration.
- Visible usage where reported and configurable task defaults. Changing from a local endpoint to a hosted provider is an explicit choice unless a fallback policy is configured.

Work additionally requires an execution runtime to manage tool calls, files, progress, and resumable task state. Choosing a model API alone does not supply that runtime. OpenWork, Hermes, and OpenClaw remain candidates for later assessment rather than selected dependencies.

The shared memory service can supply context to both API-based modes and supported CLI integrations. Sharing memory does not imply transferring a live agent session between the two execution paths.

Ollama documents partial OpenAI API compatibility; compatibility and feature support must be checked rather than inferred from an endpoint's URL shape.

Source: https://docs.ollama.com/api/openai-compatibility

### LangChain, LangGraph, and OpenUI Lang — research and recommendation

These tools address different layers and can be combined:

- **LangChain:** model/tool integrations and a configurable agent harness. Current LangChain agents use LangGraph underneath. Candidate for API-based Chat/Work model and tool integration; not required for a simple streaming chat turn.
- **LangGraph:** stateful workflow/agent orchestration, streaming, persisted execution state, and interrupts/resumption. Leading candidate if zQ builds its own Work runtime. Persistent storage and restart/retry behavior must be implemented; an in-memory checkpointer is insufficient.
- **OpenUI Lang:** structured model-generated UI rendered from a registered component library. Optional rich-result layer for Chat/Work, alongside the fixed shadcn application interface. The OpenUI repository includes LangChain/LangGraph integration, demonstrating these are complementary choices.

Recommendation remains provisional: keep the desktop/module architecture independent; use provider adapters for Chat; assess LangChain/LangGraph for Work against reusing OpenWork's existing OpenCode runtime. Choose one primary Work task owner rather than nesting agent frameworks without a concrete need. Add OpenUI Lang once real tasks benefit from generated tables, forms, or other interactive results.

zQ's shared personal memory must have its own data/source/retrieval contract. Runtime checkpoints alone are not the personal knowledge system. Generated interface actions call validated zQ commands; model-generated output does not create arbitrary new privileges.

Sources:
- https://docs.langchain.com/oss/javascript/langchain/overview
- https://docs.langchain.com/oss/javascript/langgraph/overview
- https://docs.langchain.com/oss/javascript/langgraph/persistence
- https://github.com/thesysdev/openui

### Existing zBrain — reference implementation and evaluation baseline

Treat the existing Python zBrain service as an experimental reference and possible reuse candidate. Zach has explicitly clarified that he is not committed to its stack. Select the memory backend on demonstrated suitability for zQ across machines, modes, and existing CLIs. Existing captures and adapter lessons can remain useful even if the backend is replaced; existing data should not be discarded merely because implementation choices change.

Observed live: 1,266 indexed notes including transcripts/entities, all marked embedded; API health and one semantic query succeeded. This is limited operational evidence, not a full correctness or retrieval-quality evaluation.

Required design additions:
- Separate capture support from context injection/retrieval/write support for every CLI.
- Add real account/project/context filtering across retrieval and writes; the current brief's region/cwd behavior does not enforce those boundaries.
- Define corrections, superseded decisions, and verified facts rather than treating similar historical passages as current conclusions.
- Preserve SQLite operational state (proposals, ignored sessions, events) along with the vault during backups/migrations.
- Build multi-provider persistent Chat around shared retrieval; the current Ask endpoint is single-question, configured-Ollama, notes-only answering.
- Add subscription export and email capture deliberately. Existing plans defer chat exports; they are not already part of complete account ingestion.

If retained, the existing independent zBrain repository can remain separate behind its interface even if new zQ modules begin together in a monorepo. Repository ownership and migration depend on the eventual backend choice. No remote project or infrastructure changes were made during inspection.

Detailed source evidence: `zbrain-inspection-2026-09-07.md`.

### Shared memory across all machines — revised architecture direction

The intended capability is one logical personal/project memory service, reachable over the tailnet from every authorized zQ client and supported CLI. Multiple machines do not require independently merging multiple full brain databases. A central durable service with local retry queues/cache is the leading topology; detailed offline behavior remains to be specified.

Keep three boundaries explicit:
- **Source archive:** original captures and provenance, retained/exportable independently of any extracted facts or vector index.
- **Memory engine:** extraction, retrieval, deduplication, source attribution, corrections/supersession, and deletion.
- **Tool adapters:** capture and context injection for each CLI, plus direct API integration for zQ Chat/Work. Retain support for external CLI use outside the zQ interface.

Stable project IDs connect the same logical project across machine-specific paths. Host/path data remains available as evidence; two folders with the same basename do not automatically become the same project. Shared personal knowledge and scoped work/project knowledge remain distinguishable.

Initial options for comparison:
1. **Purpose-built memory engine behind zQ's own contract — recommended evaluation path.** Hindsight documents retain/recall/reflect APIs, self-hosting, local/OpenAI-compatible model support, and multiple coding-agent integrations. Its integration coverage makes it a leading candidate to test, not a selected or proven superior backend. Mem0 is a second candidate with library and self-hosted-server approaches and configurable model/index components.
2. **Evolve zBrain.** Retain known capture adapters and corpus handling, add the missing scope/correction contracts, and evaluate whether that is simpler than integrating an external engine.
3. **Build a new custom memory service.** Maximum control over archive, retrieval, and update semantics, with the largest implementation and maintenance responsibility. Pursue if the first two cannot meet the evaluated requirements.

Letta's shared context-block model is another relevant reference. Its inspected memory-block documentation is labeled legacy V1, so current architecture and fit must be rechecked before shortlisting a Letta dependency. Do not assume its agent runtime should replace the user's existing coding CLIs.

Evidence-backed evaluation proposal, not yet executed:
- Capture a project decision from one CLI and retrieve it through a different CLI on another host.
- Correct that decision, then check that subsequent retrieval favors the corrected fact while preserving evidence/history.
- Check relevant personal/work/project scope and similarly named projects on different hosts.
- Reprocess a capture and retry after disconnection without duplicate memories.
- Delete a memory and verify its archived source cannot silently recreate it against the configured deletion policy.
- Measure context relevance, unsupported-memory claims, ingestion and recall latency, token usage, and extraction cost against a small labeled dataset.
- Check actual CLI versions/hooks, supported authentication paths, API integration, export/restore, and local Ollama/vLLM configurations. Vendor integration listings do not prove compatibility with Zach's installed tools.

Define a small zQ-facing contract such as capture, recall, remember, correct, forget, and brief. Backend adapters translate that contract; the shell and task modules should not depend directly on a vendor's database schema. The first implementation need only support the chosen backend rather than shipping multiple engines simultaneously.

Automatic collection of permitted sources, extraction of candidate memories, and promotion to trusted durable facts are separate decisions. Zach's willingness to replace zBrain does not answer the pending question about automatic memory promotion.

Sources checked 2026-09-07:
- https://github.com/vectorize-io/hindsight
- https://github.com/vectorize-io/hindsight/blob/main/hindsight-integrations/README.md
- https://docs.mem0.ai/open-source/overview
- https://docs.letta.com/v1-sdk/memory/memory-blocks

### Normal Chat grounding — confirmed behavior and proposed details

Normal Chat can combine relevant zBrain memory, the active conversation, general model knowledge, and web research. Preserve the current zBrain notes-only Ask behavior as a possible optional view/mode, not the default restriction on zQ Chat.

Proposed details for the full spec:
- Retrieve personal/project memory when relevant, within the selected context scope.
- Attribute remembered claims to stored sources and researched claims to web sources; do not present general model knowledge as a fact remembered about Zach.
- When memory is missing, continue using the allowed information sources and disclose gaps where they affect the answer.
- When old memory conflicts with current information, make the conflict visible and apply the future correction/supersession rules.
- Separate using information during a conversation from promoting it into durable memory. Automatic capture and memory promotion behavior still require a decision.
- Context windows remain bounded; shared memory does not mean attaching the whole vault to every request.

### V1 hosting — proposed foundation

Use Zach's existing always-on machine for a small shared backend, durable application data, memory services, and a background Work runner. Serve the application backend privately over the tailnet; Tailscale Serve is a candidate for tailnet-only HTTPS access. Provider API calls still require outbound connectivity.

Each Mac remains a desktop client with local file access and local workspace state/cache. Code execution remains on the selected project host. UI closure does not own the lifecycle of backend Work jobs or remote CLI sessions.

Use a portable service deployment and explicit storage/backup configuration so the shared backend can later move to a cloud VM on the tailnet. A home host does not guarantee uninterrupted availability: specify automatic service restart, off-host backups, and user-visible disconnected behavior. Offline notes/edits and conflict handling remain to be decided.

AWS/Azure/Cloudflare are user-suggested future locations, not equivalent or selected deployment targets. Evaluate the concrete runtime and private-networking model if a cloud move is pursued. No cloud infrastructure or GitHub organization has been created.

Source: https://tailscale.com/docs/features/tailscale-serve

### Work capabilities — grounded in Zach's examples

Work is a general assistant that can combine file operations, communication services, and browser actions within one task. Prefer a reusable tool-using agent with persisted task state over a separate hardcoded workflow for every request. Repeatable routines can become saved workflows later.

Proposed representative journeys for evaluation:
- **Files:** organize a selected Downloads folder, rename documents consistently, and report what moved.
- **Email:** identify messages needing a response, prepare drafts, and turn follow-ups into linked zQ tasks.
- **Teams:** catch up on selected conversations, identify requests directed to Zach, and prepare replies or tasks with source links.
- **Browser:** navigate a signed-in portal, find and download documents, and file them in a selected project location.
- **Combined:** retrieve an attachment from a conversation, organize it, create a task, and prepare a related response.

These are candidate acceptance scenarios, not claims that connectors are implemented or authorization to execute actions now.

Proposed execution model:
- A shared Work runtime owns task state and dispatches tools.
- API connectors handle supported email/Teams operations when account permissions allow.
- A worker on the relevant Mac provides local filesystem and browser access. It may be part of the desktop app or a companion process; lifecycle details remain undecided.
- A worker on the always-on host can handle files and browser sessions located there.
- A task can be viewed from any Mac, but its tools act on explicitly identified hosts/accounts. Switching the viewing device must not redirect file or browser actions to that device.
- When a required Mac sleeps or disconnects, dependent steps wait with a visible reason; the central runner cannot keep manipulating that Mac. Unrelated server-side tasks can continue.
- Browser profile ownership, downloads, login handoff, tool retry behavior, and action authorization require explicit contracts. Reconnecting must not duplicate external writes.

Microsoft Graph documents Outlook message operations and Teams chat-message access. Teams' chat listing endpoint supports delegated work/school accounts with Chat.Read; delegated personal Microsoft accounts are not supported by that endpoint. Do not promise uniform Teams capabilities before validating available permissions. Email providers are now confirmed as personal Gmail and work Microsoft 365.

Microsoft's Playwright MCP is a candidate browser tool integration; evaluate its browser/profile modes for zQ rather than assuming access to an existing personal browser session. This capability does not replace the Work runtime.

Sources:
- https://learn.microsoft.com/en-us/graph/outlook-mail-concept-overview
- https://learn.microsoft.com/en-us/graph/outlook-create-send-messages
- https://learn.microsoft.com/en-us/graph/api/chat-list-messages?view=graph-rest-1.0
- https://github.com/microsoft/playwright-mcp

Framework implication: LangChain's general agent loop with LangGraph persistence remains a plausible custom-runtime path, while OpenWork remains a reuse candidate. Compare candidates using the representative journeys before committing to either. OpenUI Lang can optionally present file-change lists, task results, and drafts through defined components.

### Personal and work connections — confirmed providers, proposed behavior

- Gmail connection for personal email, using the Gmail API where suitable.
- Microsoft 365 connection for work Outlook mail/calendar and supported Teams features, using Microsoft Graph where suitable. Access to mail does not imply access to Teams; validate permissions per capability and tenant policy.
- Shared zQ email views and Work tools can expose both accounts, retaining account identity on messages, attachments, tasks, and actions.
- Personal and Work are proposed context scopes. Each task selects its account/context; each outgoing draft makes the sender account explicit. Unified views remain possible.
- Memory records derived from connected sources retain account/source provenance. Retrieval can target Personal, Work, a project, or an explicitly combined scope. Connecting an account and importing its contents into long-term memory are separate product capabilities.
- Do not automatically infer personal calendar usage or consent to ongoing full-mailbox ingestion from the email-provider answer.
- If using change notifications, validate their inbound delivery requirements against the tailnet-only backend. Select polling or a compatible event transport deliberately; do not assume an external provider can call a private tailnet URL.

Sources:
- https://developers.google.com/workspace/gmail/api/guides
- https://learn.microsoft.com/en-us/graph/permissions-overview

## Boundaries to retain in the eventual spec

- A model endpoint is not an agent harness. Provider support and running existing CLIs need separate interfaces.
- Multiple Ollama/vLLM servers require endpoint identities, not just model names.
- UI plugins, IDE extensions, agent protocols, and tool/data connectors are distinct integration surfaces.
- Shared personal memory is separate from each runtime's live conversation/session state.
- Imported archives, retrieved source material, and distilled memory should remain distinguishable.
- Editing a local `.env` does not inherently authorize indexing it into memory or copying it to other Macs.
- A disconnected session is not necessarily stopped, and an active terminal is not proof that an agent is making progress.
- Third-party reuse decisions need exact repositories, licenses, API boundaries, and upgrade-cost review once candidates are narrowed.

## Discovery sequence

1. Define continuity across Macs, offline expectations, and where shared state can live.
2. Understand notes, tasks, email/calendar, and their relationship to projects.
3. Define memory sources, ownership, retrieval behavior, corrections, and what “strictly use” memory means.
4. Define Chat and Work, model access, and the relationship to existing agent runtimes.
5. Deep-dive Code using concrete project/session journeys; identify CLI account/integration support, desired plugin capabilities, and transfer behavior.
6. Compare architecture candidates against those journeys and select components with evidence.
7. Produce the full product/architecture specification, phased delivery scope, acceptance criteria, and component contracts.

## Modular product proposal

### Notes and scratchpad — confirmed workflows, proposed behavior

Support both immediately usable scratch tabs and editing ordinary files:

- A new scratch tab opens without requiring a title, folder, or project selection.
- Scratch contents are automatically persisted in zQ and synchronized across Macs. “Untitled” describes the absence of a name, not the absence of durability. Show sync state when relevant; offline changes remain locally durable until synchronization is possible.
- A scratch tab can be named, associated with a project, or saved/exported as an ordinary text/Markdown file.
- Open existing local or remote text/Markdown/configuration files in editor tabs, retaining explicit host/path identity.
- Persist recovery drafts for edited files. Recovery persistence and writing changes to the underlying file are separate operations; do not assume an autosave-to-file preference from the scratchpad requirement.
- Restore tabs, draft content where eligible for synchronization, and editor view state as part of workspace continuation. A restored reference to a file on another Mac must identify its owner and availability, not resolve to a different local file with the same path.
- Scratch notes belong to shared workspace data. Existing file contents follow their resource synchronization settings; simply opening a local file does not copy it into shared memory.
- Notes and Code should reuse an editor capability and resource model where practical. The Notes module presents capture/writing workflows; Code provides the surrounding agent/project workflow.
- Saving a scratch or file does not itself specify whether its contents should be indexed or promoted into long-term zBrain memory. Define that behavior separately.

These details are proposals following the confirmed dual workflow. Exact offline conflict handling and file-draft synchronization settings remain to be specified.

### Tasks / Kanban — proposed first version

- One default board across zQ, with Inbox, Next, Doing, Waiting, and Done columns. Column names and organization remain proposed rather than approved.
- Creating a card requires only a title. Description, project, due date, and source links are optional.
- Cards can be created manually or from a note, Chat message, email/Teams item, or agent session, retaining a link to the source.
- Project views filter the shared task collection; they do not require duplicate cards on separate boards.
- Drag cards between columns and open a card for details without leaving the current workspace.
- Keep task completion separate from an agent process exiting. A completed agent run can surface its result for inspection; it does not establish that the underlying task is done.
- An optional linked agent run can expose its actual state on the card where supported. The board remains useful for manual tasks without agents.
- Personal/work/project filters and board state use the shared workspace data model and synchronize across Macs.
- Defer deadlines-as-requirements, elaborate estimation, sprint planning, and automatic task creation until a concrete need emerges.

Suggested initial habit: capture unfinished work in Inbox before switching away; use Next for the few items Zach intends to return to. This is a usability proposal, not an imposed routine.

### Future module: agent assignment from Kanban

Zach proposes adding a module that lets him assign board tasks to agents. Treat this as future scope, not a requirement to implement agent dispatch in the first Kanban release.

Proposed user flow:
1. Open a card and choose Assign to agent.
2. Select a coding CLI harness or a Work agent, depending on the task. Reuse saved project/host or model/tool defaults when available.
3. Attach the card description and selected context, then start the assignment.
4. See progress, attention requests, and results on the card; jump to the real terminal or Work session.
5. Inspect the result and mark the task done or request follow-up work.

Minimum foundations to preserve now:
- Stable task IDs and links to projects, notes, conversations, and artifacts.
- A module contribution point for card actions and linked activity.
- Keep task status, assignment, and execution status distinct.
- Represent each execution as a separate run linked to its originating task. A task can have multiple runs over time; retries and follow-ups do not overwrite prior results.

Detailed dispatch remains later work:
- Coding assignments launch the existing authenticated CLI on the selected host; they retain that CLI's account/usage path.
- Work assignments use API-backed models and the selected Work runtime/tools.
- A generic interactive terminal does not guarantee unattended task submission, structured progress, pause, or cancellation. Expose only verified capabilities per harness and show unsupported automation honestly.
- Define restart/reconnect and dispatch idempotency before unattended execution so reopening the app does not launch duplicate agents.
- Bulk assignment, automatic scheduling, multi-agent coordination, and concurrent edits to the same checkout are not implied by the initial future-module request; scope them when the module is designed.

### Platform interfaces

Build a small shell and add feature modules incrementally. The following boundaries are proposed, not yet approved:

- **Shell:** app windows, navigation, tabs/panels, command palette, theme, notifications, module activation, and layout restoration.
- **Shared platform:** project/resource identities, storage and sync contracts, credential access, search registration, model endpoint registry, and a common record of ongoing work. Introduce concrete implementations as modules need them.
- **Feature modules:** notes, tasks, memory, Chat, Code, Work, and email/calendar.
- **Adapters:** connect model providers, external agent runtimes, local/remote resources, and external services through defined capabilities.

Each module declares its identity and compatible platform version, contributed views/commands/search results, required capabilities, owned data and migrations, and serializable view state. Cross-module operations use explicit APIs and stable resource IDs rather than another module's database tables or private components. Disabling a module preserves its data.

First-party modules can be compiled and released with the app initially. Independently installable third-party plugins require a separate versioned API and execution/permission model. Theia provides a relevant precedent: its product-level extensions are composed at build time, while VS Code extensions can be installed at runtime. These mechanisms should not be conflated.

Source: https://theia-ide.org/docs/extensions/

### Repository recommendation

Start with one main repository inside the proposed GitHub organization, with separate packages for shell, shared contracts, UI, and each module. This permits changing a contract and its consumers in one reviewed change while the architecture is settling. Separate repositories are appropriate later for independently useful integrations, SDKs, or upstream forks with their own release cycles. Module boundaries do not require separate repositories or separately deployed services.

The organization name is a working label; GitHub namespace availability has not been checked.

### Cross-Mac behavior proposal

- Shared content and remote session references are available on every Mac.
- Layout snapshots are associated with the workspace and originating device.
- A Mac can restore another Mac's workspace snapshot or keep its own layout while accessing the shared content.
- Layout changes on one active Mac do not automatically rearrange another active Mac's windows.
- Restoration adapts panel sizes to the destination screen and identifies unavailable local resources instead of silently opening different files.
- Restoring a terminal view reconnects to execution on its owning host; it does not copy a running process to the destination Mac.
- Unsaved editor contents and simultaneous edits need explicit durability and conflict behavior in the detailed spec.

### Incremental delivery proposal

1. Define minimal shell/module contracts and validate local/remote file and terminal access. Preserve actual CLI harnesses and their account paths; third-party extensibility does not require full IDE compatibility.
2. Deliver shell plus Notes as a useful first slice, including storage and cross-Mac state restoration.
3. Add Tasks and project links to exercise cross-module operations.
4. Add Chat with a minimal shared memory path, then expand memory ingestion and retrieval.
5. Add Code, Work, and integrations in the order selected after their workflow designs. Code discovery remains a dedicated last deep-dive; that does not automatically require shipping Code last.

## Next open decision

Should memory capture and organization happen automatically in the background, or primarily when Zach explicitly saves something? Clarify capture versus promotion into durable facts using the existing zBrain behavior. Offline conflict handling and the exact always-on host remain pending foundation details.

## Code refinement: existing SSH and Herdr reference

Zach expects zQ to reuse his existing SSH access and supplied https://herdr.dev/ as an example of the experience he has in mind. This is a design reference, not a request to install Herdr or replace tmux.

Read-only local inspection with `ssh -G model-server` successfully resolved the existing alias to its tailnet hostname, user zach, and port 22. This verifies configuration resolution, not authentication or which private key is used; the listed identity paths include OpenSSH defaults. No private key contents were read. Proposed implementation uses system OpenSSH and each Mac's own configuration/agent, with GUI environment and interactive authentication validation.

Herdr's documented server/pane model closely fits the Code direction. Its individual terminal observer/controller interface makes backend reuse worth a bounded technical evaluation. It is a terminal UI, so a custom zQ GUI remains separate work. Existing tmux session access stays a requirement: Herdr explicitly does not detect agents inside nested tmux. Agent status can be screen-inferred rather than lifecycle-confirmed. Server restart restoration must not be described as uninterrupted process survival.

Sources: [Herdr repository](https://github.com/herdrdev/herdr), [remote access and bridges](https://herdr.dev/docs/persistence-remote/), [agent detection](https://herdr.dev/docs/agents/), [session restoration](https://herdr.dev/docs/session-state/), [OpenSSH configuration](https://man.openbsd.org/ssh_config).

The consolidated product spec's Code section now records this direction and the runtime evaluation. Desktop/runtime selection and memory capture policy remain open.

## Code deferred; foundation continues

Zach clarified that he has only just discovered Herdr and wants to research it before making a choice. Code implementation and runtime selection are deferred. The updated release proposal is Shell + Notes + manual Kanban; Code, Chat/Memory, and Work can follow as their designs become ready. This supersedes earlier suggestions that Code design or memory evaluation must finish before the first slice.

Preserve the known downstream needs in the foundation: local/remote resource identity, stable cross-module links, contributed views/commands, restorable view state, shared versus per-device data, and desktop access to native processes/files. Choose concrete adapters later. Modular boundaries reduce coupling but cannot promise that every future integration will require no shared changes.
