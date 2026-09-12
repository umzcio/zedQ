# zBrain inspection for zQ

Inspected: 2026-09-07, via authorized SSH to `model-server` and noninteractive sudo.
Scope: project documentation, selected source, aggregate database metadata, container status, and live read endpoints. No source, configuration, vault, or deployment changes were made. No private note bodies, conversation transcripts, or credentials are reproduced here.

## Recommendation

**Subsequent user clarification:** Zach considers zBrain a weekend experiment and is open to replacing it for better support across all machines/tools. The retention recommendation below records the initial inspection conclusion; it is not a selected architecture. The current working brief calls for comparative evaluation of reuse and replacement.

Retain zBrain as zQ's initial memory backend. Build a zQ Memory module using its existing REST/MCP interfaces, then extend the contracts for scope, corrections, and reliable integration across tools. Preserve the existing Python backend and Markdown corpus; the proposed TypeScript desktop shell does not require rewriting them.

This is an architectural inspection, not a full security audit, retrieval-quality evaluation, or test-suite run. The source checkout and deployed container were not compared byte for byte. Historical reports are distinguished from checks performed during this inspection.

## Observed implementation

Source checkout: `/projects/zBrain/app`, clean tracked/untracked status at inspection, HEAD `3b4bc5d`.

| Part | Observed design |
|---|---|
| Frontend | React, TypeScript, Vite, Radix/shadcn-style components; map, vault reader, Ask, review queue, sync views |
| Backend | Python/FastAPI with REST, SSE, and MCP interfaces |
| Memory documents | Host Markdown vault at `/projects/zBrain/vault`, with its own Git history |
| Metadata and operational state | SQLite at `/projects/zBrain/data/zbrain.db` |
| Semantic index | LanceDB with Ollama embeddings |
| Capture | Source adapters parse CLI histories and project documents; pipeline writes capture notes and transcript companions |
| Curation | Librarian proposes summaries, regions, links, and people; review code applies decisions |
| Retrieval | Semantic search with transcript hits attributed to parent captures; Ask adds temporal handling and source citations |
| Context injection | REST/MCP session briefs plus tool-specific hook scripts |

The adapter contract is already separated from the writer: each adapter discovers and parses sessions into `RawCapture`, and the pipeline owns note identity, paths, and persistence. Existing source categories include Claude, Codex, bearcode, Grok, Gemini, Kimi, OpenCode, and project documentation.

## Live observations

- `zbrain-web` was running, reported up 7 days.
- `zbrain-api` was running, reported up 8 days.
- Local API `/health` returned `status=ok`, `vault=true`, `ollama=true`.
- A read-only semantic query, “shared memory across coding sessions,” requested three results and received three with snippets. Only result counts/source categories were printed.
- A SQLite connection opened with `mode=ro` and `query_only=ON` reported 1,266 indexed notes, all marked `embedded`.
- The count includes transcript companions and entity notes. It is not a count of unique conversations or independently verified facts.
- Proposal status counts: 616 approved, 1 rejected, no pending rows at inspection.
- Six ignored-session records were present.
- Latest indexed creation timestamp: `2026-09-07T03:16:55Z`.

Indexed source totals:

| Source | Note rows, including transcript companions |
|---|---:|
| Claude | 510 |
| Codex | 472 |
| bearcode | 70 |
| Grok | 58 |
| Gemini | 50 |
| Kimi | 46 |
| OpenCode | 26 |
| Project docs | 19 |
| Manual | 14 |
| MCP | 1 |

These checks establish that the service and one retrieval path work. They do not establish complete source capture, complete vector coverage, accurate answers, or working hooks on every host.

## Existing integration surface

Source declares six MCP tools:

- `search`
- `get_note`
- `append_note`
- `region_activity`
- `recent_captures`
- `session_brief`

Relevant REST routes include `/search`, `/brief`, `/ask`, `/notes/{note_id}`, `/brain/snapshot`, `/events`, and Librarian queue/review routes. MCP invocation and write routes were not exercised.

The Claude script injects a project-oriented brief at session start. The bearcode/Kimi script injects a task-oriented brief at the first user prompt. Both scripts have short timeouts and allow the CLI session to continue when the memory service is unavailable.

Historical rollout reports describe working Claude and bearcode/Kimi installs, and deferred/limited integration for Codex, Grok, Gemini, and OpenCode. Those tool/version constraints must be revalidated before implementing zQ; this inspection did not traverse other hosts or run authenticated coding agents.

## Consequences for the zQ design

### Preserve the memory service boundary

zQ owns the unified experience, accounts, projects, tasks, and conversations. zBrain initially owns memory capture, documents, indexing, retrieval, and its curation process. The desktop calls the backend instead of mounting and independently writing its live data directories.

An existing independent zBrain repository is a reasonable exception to the proposed monorepo starting point: its interfaces already permit reuse. GitHub organization migration is a separate later action.

### Separate capture from memory use

Reading a CLI's session history does not prove that the CLI receives memory at its next prompt. Track capture support, automatic context injection, explicit MCP retrieval, and memory writes as separate capabilities per tool. Keep terminal operation available even when enhanced memory integration is missing.

### Add scope to retrieval contracts

The inspected search API accepts query, result count, and transcript inclusion; it does not expose account or project filters. The brief's region parameter narrows its recent section, while its semantic search still spans the corpus. Its `cwd` ranks recent project matches rather than enforcing isolation.

Before Gmail/M365 ingestion, introduce explicit source-account and context scope across storage, search, briefs, and writes. Existing region labels and source-tool metadata do not provide that boundary.

### Define what qualifies as a remembered fact

The current system preserves sessions, adds filing summaries, and retrieves relevant passages. zQ needs explicit semantics for preferences, decisions, corrections, superseded claims, and source evidence.

For example, `brief.py` uses a similarity threshold to render matching excerpts under “Don't redo” as conclusions already reached. Similarity alone does not establish that an excerpt is a valid, current decision. Evaluate this behavior against real cases before using it as authoritative memory in every mode.

### Preserve more than Markdown in backups

The note index is reconstructable from the vault, but the same SQLite database also contains proposals, ignored-session records, and sync events. Do not treat the entire database as disposable. Backup and migration rules need to preserve operational state as well as the Markdown source and vault Git history.

### Evolve Ask into the chosen Chat behavior

The inspected `/ask` request contains only a question; its payload sends one user question to the configured Ollama chat model with retrieved source context. It instructs the model to answer only from provided notes. That is a useful grounded-answer mode, but it is not yet the multi-provider, persistent-conversation Chat experience proposed for zQ.

Decide whether ordinary Chat should use memory as background, require evidence from memory, or offer both modes. A prompting instruction to use only notes is not by itself a guarantee against unsupported claims.

### Extend capture incrementally

Desktop/subscription chat-export imports are recorded as deliberately deferred in the existing plans. Gmail/M365 ingestion is additional work. Preserve those distinctions instead of describing the current corpus as an archive of every subscription and account.

## Evidence map

All paths below are remote, relative to `/projects/zBrain/app` unless otherwise specified:

- `AGENTS.md`, `README.md`: project boundaries and architecture.
- `package.json`, `api/requirements.txt`: source dependency declarations.
- `api/zbrain/adapters/__init__.py`: adapter contract and source/storage identity distinction.
- `api/zbrain/pipeline.py`: capture IDs, Markdown layout, recapture, transcript limits, ignored-session handling.
- `api/zbrain/index.py`: note schema, proposal records, ignored sessions, sync events.
- `api/zbrain/search.py`: search and parent-capture attribution.
- `api/zbrain/brief.py`: brief retrieval, region/cwd semantics, conclusion phrasing.
- `api/zbrain/models.py`, `api/zbrain/ask.py`: Ask input, model payload, source-grounded prompt.
- `api/zbrain/librarian.py`, `api/zbrain/mcp_server.py`: curation proposal generation and memory tools.
- `api/zbrain/app.py`: REST routes and lifecycle.
- `api/scripts/zbrain-session-brief-hook.sh`, `api/scripts/zbrain-bearcode-brief-hook.sh`: context injection implementations.
- `plans/README.md`, `plans/013-brief-fanout-rollout.md`: historical rollout scope and caveats. Earlier plan text contains statements corrected by the index; reports are not a substitute for current runtime verification.

Some documentation is stale: for example, `AGENTS.md` describes older dependency pins than the inspected requirements and completed upgrade report. Prefer source and current checks for implementation decisions.
