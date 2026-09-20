'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { randomUUID } = require('node:crypto');
const { ResearchAdapter, checkedFindings, report } = require('../electron/research/adapter.cjs');
const { ResearchService } = require('../electron/research/service.cjs');
const { ResearchStore } = require('../electron/research/store.cjs');
const { connector, checkConnectorScope, evidence } = require('../electron/research/sources.cjs');
const { getCatalogEntry } = require('../electron/mcp/catalog.cjs');
const { ChatService } = require('../electron/chat-service.cjs');
const { ConnectorService } = require('../electron/mcp/service.cjs');
const plan = { title: 'Compare measurements', steps: ['Read measurements', 'Check conflicts', 'Write a sourced comparison'], questions: [] };
const controller = () => new AbortController();
const json = value => ({ text: JSON.stringify(value), sources: [], usage: { inputTokens: 10, outputTokens: 5 } });
const action = value => json({ findings: [], gaps: [], action: value });
const until = async fn => { for (let i = 0; i < 500; i++) { if (fn()) return; await new Promise(resolve => setTimeout(resolve, 5)); } assert.fail('Expected research state was not reached'); };
function directory(t) { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zq-research-adapter-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true })); return dir; }
function fixture(response = () => json(plan)) {
 const selected = { id: 'account', provider: 'openai', baseUrl: 'https://api.openai.com/v1', updatedAt: 1, credentialRef: 'test-credential-ref', enabledModels: ['gpt-5'] };
 const conversation = { id: 'chat', connectionId: 'account', model: 'gpt-5', projectId: 'project', messages: [] };
 const notes = [{ id: 'note', title: 'Measurements', body: 'A: 12. B: 20.' }, { id: 'unselected', title: 'Private note', body: 'NEVER SEND PRIVATE NOTE' }];
 const calls = [], connectorCalls = [], rows = [], projects = [{ id: 'project', instructions: 'NEVER SEND PROJECT INSTRUCTIONS', files: [{ id: 'file', name: 'source.txt', text: 'B: 18. Date not stated.', mime: 'text/plain' }, { id: 'other-file', name: 'private.txt', text: 'NEVER SEND OTHER FILE', mime: 'text/plain' }] }];
 const chat = { state: { connections: [selected], conversations: [conversation] }, runs: new Map(), getNotes: () => notes, conversation: id => { assert.equal(id, conversation.id); return conversation; }, project: id => projects.find(p => p.id === id), attachments: { items: new Map() },
  connections: { assertAvailable() {}, adapter: async () => ({ researchRequest: async args => { calls.push(args); return response(args, calls.length); } }) },
  connectors: { list: () => structuredClone(rows), callTool: async (...args) => { connectorCalls.push(args); return { content: [{ type: 'text', text: 'Connector text' }] }; } },
 };
 const input = { id: randomUUID(), conversationId: 'chat', projectId: 'project', choice: { connectionId: 'account', model: 'gpt-5' }, brief: 'Compare A and B.', sources: [{ kind: 'note', id: 'note', scope: [] }] };
 const adapter = new ResearchAdapter({ chat });
 return { adapter, chat, input, selected, conversation, notes, calls, rows, connectorCalls, projects };
}
async function jobFor(f, phase = 'researching') {
 return { id: f.input.id, input: f.input, binding: await f.adapter.resolve(f.input), material: f.adapter.capture(f.input), plan, planVersion: 1, acceptedPlanVersion: 1, phase, steps: [], evidence: [], findings: [], gaps: [], finishRequested: false };
}
function row(kind, names) { return { id: 'connector', name: 'Research source', catalogId: kind, url: getCatalogEntry(kind).url, status: 'connected', revision: 1, tools: names.map(name => ({ name, enabled: true, readOnly: true, inputSchema: { type: 'object' } })) }; }
test('complete native loop saves evidence before analysis, checks contradictions, and publishes a cited draft', async t => {
 let service; const dir = directory(t); const published = [];
 const f = fixture((args, n) => {
  const prompt = JSON.parse(args.prompt), saved = service.jobs.get(f.input.id);
  assert.equal(args.model, 'gpt-5'); assert.equal(args.baseUrl, f.selected.baseUrl);
  assert.doesNotMatch(args.prompt, /NEVER SEND/);
  if (n === 1) { assert.equal(prompt.research, undefined); return json(plan); }
  if (n === 2) return action({ kind: 'read', sourceId: 'note', offset: 0 });
  if (n === 3) { assert.equal(new ResearchStore(dir).load(f.input.id).evidence.length, 1); return action({ kind: 'read', sourceId: 'file', offset: 0 }); }
  const [a, b] = saved.evidence;
  if (n === 4) return json({ findings: [{ id: 'difference', text: 'Sources disagree about B: 20 versus 18.', evidenceIds: [a.id, b.id], kind: 'sourced' }, { id: 'unsupported', text: 'The undated reading is newer.', evidenceIds: [b.id], kind: 'interpretation' }], gaps: ['The second source is undated.'], action: { kind: 'finish' } });
  if (n === 5) { assert.equal(prompt.research.findings.length, 2); return json({ findings: [saved.findings[0]], gaps: [] }); }
  assert.equal(n, 6); assert.equal(prompt.research.findings.length, 1);
  return json({ title: 'Measurements', markdown: `B is reported as 20 [e:${a.id}] and 18 [e:${b.id}]. The conflict remains unresolved.`, citationIds: [a.id, b.id] });
 });
 f.input.sources.push({ kind: 'project_file', id: 'file', scope: [] });
 f.adapter.publisher = async input => { published.push(input); return { artifactId: randomUUID(), versionId: randomUUID() }; };
 service = new ResearchService({ directory: dir, adapter: f.adapter }); t.after(() => service.shutdown());
 await service.create(f.input); await until(() => service.get(f.input.id).status === 'awaiting_plan'); assert.equal(f.calls.length, 1);
 const current = service.get(f.input.id); service.acceptPlan({ id: current.id, expectedRevision: current.revision, plan: current.plan });
 await until(() => ['completed', 'failed'].includes(service.get(f.input.id).status));
 assert.equal(service.get(f.input.id).status, 'completed', JSON.stringify(service.get(f.input.id).error));
 const result = published[0].job; assert.equal(result.evidence.length, 2); assert.equal(result.findings.length, 1); assert.equal(result.steps.filter(s => s.activity).length, 2);
 assert.match(result.reportDraft.markdown, /## Sources/); assert.match(result.reportDraft.markdown, /second source is undated/); assert.doesNotMatch(result.reportDraft.markdown, /reading is newer/);
 assert.equal(published[0].idempotencyKey, `research:${f.input.id}:report:1`); assert.equal(result.usage.inputTokens, 60); assert.equal(result.usage.unmeasuredSteps, 0);
});
test('selected attachments survive restart; selected note/file changes invalidate bindings', async t => {
 const f = fixture(() => action({ kind: 'read', sourceId: 'attachment', offset: 0 }));
 f.chat.attachments.items.set('attachment', { id: 'attachment', name: 'selected.txt', text: 'Saved attachment content.', mime: 'text/plain' });
 f.input.sources = [{ kind: 'attachment', id: 'attachment', scope: [] }];
 const job = await jobFor(f); f.chat.attachments.items.clear();
 assert.deepEqual(await f.adapter.resolve(f.input, { material: job.material }), job.binding);
 const result = await f.adapter.runPhase({ job, signal: controller().signal, stepId: 'test-step' }); assert.equal(result.evidence[0].excerpt, 'Saved attachment content.');
 const other = fixture(); const notesJob = await jobFor(other); other.notes[0].body = 'Changed'; await assert.rejects(other.adapter.runPhase({ job: notesJob, signal: controller().signal, stepId: 'test-step' }), /access changed/); assert.equal(other.calls.length, 0);
 const file = fixture(); file.input.sources = [{ kind: 'project_file', id: 'file', scope: [] }]; const fileJob = await jobFor(file); file.projects[0].files = []; await assert.rejects(file.adapter.resolve(file.input, { material: fileJob.material }), /no longer available/);
});
test('checkpointed attachment text resumes after a native service restart without reimporting files', async t => {
 const dir = directory(t); let service;
 const f = fixture(args => {
  const prompt = JSON.parse(args.prompt), job = service.jobs.get(f.input.id);
  if (!prompt.research) return json(plan);
  if (job.phase === 'checking') return json({ findings: [], gaps: [] });
  if (job.phase === 'writing') return json({ title: 'Recovered report', markdown: 'Recovered document [e:' + job.evidence[0].id + ']', citationIds: [job.evidence[0].id] });
  return job.evidence.length ? action({ kind: 'finish' }) : action({ kind: 'read', sourceId: 'attachment', offset: 0 });
 });
 f.input.sources = [{ kind: 'attachment', id: 'attachment', scope: [] }]; f.chat.attachments.items.set('attachment', { name: 'saved.txt', text: 'Text that must survive restart.', mime: 'text/plain' });
 f.adapter.publisher = async () => ({ artifactId: randomUUID(), versionId: randomUUID() });
 service = new ResearchService({ directory: dir, adapter: f.adapter });
 await service.create(f.input); await until(() => service.get(f.input.id).status === 'awaiting_plan'); service.shutdown(); f.chat.attachments.items.clear();
 service = new ResearchService({ directory: dir, adapter: f.adapter }); t.after(() => service.shutdown());
 assert.equal(f.calls.length, 1); assert.equal(service.get(f.input.id).material, undefined, 'Raw selected material is not broadcast to views');
 const saved = service.get(f.input.id); service.acceptPlan({ id: saved.id, expectedRevision: saved.revision, plan: saved.plan });
 await until(() => ['completed', 'failed'].includes(service.get(f.input.id).status));
 assert.equal(service.get(f.input.id).status, 'completed', JSON.stringify(service.get(f.input.id).error)); assert.equal(service.get(f.input.id).evidence[0].excerpt, 'Text that must survive restart.');
});
test('unknown models, busy conversations, changed projects/accounts and image-only files fail before generation', async () => {
 const mutations = [f => { f.selected.enabledModels = []; }, f => { f.conversation.model = 'other'; }, f => { f.conversation.projectId = null; }, f => { f.chat.runs.set('chat', {}); }, f => { f.conversation.queue = { items: [{}] }; }, f => { f.conversation.deletedAt = 1; }, f => { f.selected.provider = 'ollama'; }, f => { f.selected.baseUrl = 'https://other.example/v1'; }];
 for (const mutate of mutations) { const f = fixture(); mutate(f); await assert.rejects(f.adapter.resolve(f.input)); assert.equal(f.calls.length, 0); }
 const f = fixture(); f.input.sources = [{ kind: 'project_file', id: 'file', scope: [] }]; Object.assign(f.projects[0].files[0], { kind: 'image', text: undefined }); await assert.rejects(f.adapter.resolve(f.input), /no supported text/);
});
test('model-chosen unselected sources, commands and fabricated references are rejected', async () => {
 for (const value of [{ kind: 'read', sourceId: 'unselected', offset: 0 }, { kind: 'shell', sourceId: 'note', args: { command: 'cat private' } }, { kind: 'read', sourceId: 'note', offset: 500 }]) {
  const f = fixture(() => action(value)); const job = await jobFor(f); await assert.rejects(f.adapter.runPhase({ job, signal: controller().signal, stepId: 'step' }));
 }
 const f = fixture(() => json({ findings: [{ id: 'f1', kind: 'sourced', text: 'Claim', evidenceIds: ['invented'] }], gaps: [], action: { kind: 'finish' } }));
 await assert.rejects(f.adapter.runPhase({ job: await jobFor(f), signal: controller().signal, stepId: 'step' }), /not been collected/);
});
test('local chunk offsets preserve Unicode and repeated reads reuse immutable evidence', async () => {
 const f = fixture(() => action({ kind: 'read', sourceId: 'note', offset: 0 })); f.notes[0].body = '😀'.repeat(9000);
 const job = await jobFor(f); const first = await f.adapter.runPhase({ job, signal: controller().signal, stepId: 'first' });
 assert.equal(Buffer.byteLength(first.evidence[0].excerpt), 28000); assert.match(first.evidence[0].locator, /0–7000 of 9000/); assert.equal(first.evidence[0].level, 'excerpt');
 job.evidence = first.evidence;
 const second = await f.adapter.runPhase({ job, signal: controller().signal, stepId: 'second' }); assert.deepEqual(second.evidence, first.evidence);
});
test('web reads use search results, preserve failed reads as gaps and label snippet-only evidence', async () => {
 const f = fixture(args => args.mode === 'search' ? { text: 'FAKE MODEL EVIDENCE', sources: [{ url: 'https://example.org/read', title: 'Read' }, { url: 'https://example.org/blocked', title: 'Blocked', snippet: 'Short actual citation' }], usage: { inputTokens: 3, outputTokens: 2 } } : action({ kind: 'web_search', sourceId: 'web', query: 'public measurements' }));
 f.input.sources = [{ kind: 'web', id: 'web', scope: ['example.org'] }]; const reads = [];
 f.adapter.readPage = async (url, options) => { reads.push({ url, ...options }); if (url.endsWith('blocked')) throw Error('PRIVATE DIAGNOSTICS'); return { url, title: 'Document', text: 'Actual page text', retrievedAt: 1000 }; };
 const result = await f.adapter.runPhase({ job: await jobFor(f), signal: controller().signal, stepId: 'step' });
 assert.deepEqual(result.evidence.map(e => e.level), ['document', 'snippet']); assert.deepEqual(result.usage, { inputTokens: 13, outputTokens: 7 });
 assert.doesNotMatch(JSON.stringify(result), /FAKE MODEL|PRIVATE DIAGNOSTICS/); assert.match(result.gaps[0], /Could not read/); assert.deepEqual(reads[0].domains, ['example.org']);
});
test('mixed private/web runs cannot transmit a model-generated private search query', async () => {
 const f = fixture(args => args.mode === 'search' ? { text: '', sources: [] } : action({ kind: 'web_search', sourceId: 'web', query: 'PRIVATE COPIED CONTENT' }));
 f.input.sources.push({ kind: 'web', id: 'web', scope: [] });
 await f.adapter.runPhase({ job: await jobFor(f), signal: controller().signal, stepId: 'step' });
 assert.equal(JSON.parse(f.calls[1].prompt).query, f.input.brief); assert.doesNotMatch(f.calls[1].prompt, /PRIVATE COPIED/);
});
test('account revocation between coordinator and search prevents the second paid call', async () => {
 const f = fixture(() => { f.selected.updatedAt++; return action({ kind: 'web_search', sourceId: 'web', query: 'public measurements' }); });
 f.input.sources = [{ kind: 'web', id: 'web', scope: [] }];
 await assert.rejects(f.adapter.runPhase({ job: await jobFor(f), signal: controller().signal, stepId: 'step' }), /access changed/); assert.equal(f.calls.length, 1);
});
test('connector capabilities reject unknown endpoints and mutation tools despite read-only annotations', async () => {
 const f = fixture(); f.rows.push(row('gmail', ['get_thread', 'send_message'])); const selection = { id: 'connector', kind: 'connector', scope: ['allowed-thread'] };
 assert.deepEqual(connector(f.chat.connectors, selection).tools.map(t => t.name), ['get_thread']);
 f.rows[0].url = 'https://attacker.example/mcp'; assert.throws(() => connector(f.chat.connectors, selection), /supported research/);
 f.rows[0] = row('gmail', ['send_message']); assert.throws(() => connector(f.chat.connectors, selection), /supported read tool/);
});
test('scoped connector operations enforce paper/file/thread/calendar IDs before I/O', async () => {
 for (const [kind, good, bad] of [['arxiv', ['get_paper', { id: 'allowed' }], ['get_paper', { id: 'other' }]], ['gmail', ['get_thread', { threadId: 'allowed' }], ['get_thread', { threadId: 'other' }]], ['google-drive', ['read_file', { fileId: 'allowed' }], ['read_file', { fileId: 'other' }]], ['google-calendar', ['get_event', { calendarId: 'allowed' }], ['get_event', {}]], ['google-calendar', ['free_busy', { calendarIds: ['allowed'] }], ['free_busy', { calendarIds: ['allowed', 'other'] }]]]) {
  const r = row(kind, [good[0]]), selection = { id: 'connector', scope: ['allowed'] };
  assert.doesNotThrow(() => checkConnectorScope(r, selection, ...good)); assert.throws(() => checkConnectorScope(r, selection, ...bad), /outside/);
 }
 for (const requested of [{ kind: 'connector', sourceId: 'connector', tool: 'send_message', args: {} }, { kind: 'connector', sourceId: 'connector', tool: 'get_thread', args: { threadId: 'other' } }]) {
  const f = fixture(() => action(requested)); f.rows.push(row('gmail', ['get_thread', 'send_message'])); f.input.sources = [{ kind: 'connector', id: 'connector', scope: ['allowed'] }];
  await assert.rejects(f.adapter.runPhase({ job: await jobFor(f), signal: controller().signal, stepId: 'step' })); assert.equal(f.connectorCalls.length, 0);
 }
});
test('connector evidence requires plan acceptance and carries its exact pinned revision', async () => {
 const f = fixture(() => action({ kind: 'connector', sourceId: 'connector', tool: 'get_thread', args: { threadId: 'allowed' } }));
 f.rows.push(row('gmail', ['get_thread'])); f.input.sources = [{ kind: 'connector', id: 'connector', scope: ['allowed'] }];
 const job = await jobFor(f); job.acceptedPlanVersion = null;
 await assert.rejects(f.adapter.runPhase({ job, signal: controller().signal, stepId: 'step' }), /Accept the research plan/); assert.equal(f.calls.length, 0);
 job.acceptedPlanVersion = 1; const result = await f.adapter.runPhase({ job, signal: controller().signal, stepId: 'step' });
 assert.equal(f.connectorCalls[0][3].expectedRevision, 1); assert.equal(result.evidence[0].excerpt, 'Connector text'); assert.equal(result.activity.kind, 'connector');
 f.rows[0].tools[0].enabled = false; await assert.rejects(f.adapter.runPhase({ job, signal: controller().signal, stepId: 'step' })); assert.equal(f.connectorCalls.length, 1);
});
test('real MCP schema validation rejects invalid read arguments before reaching its transport', async t => {
 const dir = directory(t), f = fixture(() => action({ kind: 'connector', sourceId: 'connector', tool: 'get_thread', args: { threadId: 'allowed', unexpected: 'bad' } }));
 const service = new ConnectorService({ directory: dir, credentials: {}, openExternal() {} });
 service.rows = [row('gmail', ['get_thread'])]; service.rows[0].tools[0].inputSchema = { type: 'object', properties: { threadId: { type: 'string' } }, required: ['threadId'], additionalProperties: false };
 let network = 0; service.sessions.set('connector', { controller: controller(), client: { callTool: async () => { network++; } } });
 f.chat.connectors = service; f.input.sources = [{ kind: 'connector', id: 'connector', scope: ['allowed'] }];
 const result = await f.adapter.runPhase({ job: await jobFor(f), signal: controller().signal, stepId: 'step' });
 assert.equal(network, 0); assert.equal(result.evidence.length, 0); assert.match(result.gaps[0], /could not return/);
});
test('report citations and verbatim quotations cannot reference invented evidence', async () => {
 const f = fixture(); const job = await jobFor(f); const e = evidence(job, f.input.sources[0], { title: 'Measurement', locator: 'Table 1', text: 'A: 12.', tool: 'selected_reference', requestId: 'step' }); job.evidence = [e];
 assert.throws(() => checkedFindings([{ id: 'q1', text: 'A: 13.', kind: 'quotation', evidenceIds: [e.id] }], job), /does not match/);
 assert.doesNotThrow(() => checkedFindings([{ id: 'q1', text: 'A: 12.', kind: 'quotation', evidenceIds: [e.id] }], job));
 for (const draft of [{ title: 'Report', markdown: 'Claim [e:invented]', citationIds: ['invented'] }, { title: 'Report', markdown: `Claim [e:${e.id}]`, citationIds: [] }, { title: 'Report', markdown: 'Claim https://made-up.example', citationIds: [] }]) assert.throws(() => report(draft, job));
 await assert.rejects(f.adapter.publish({ job, signal: controller().signal }), /publishing is not available/);
});
test('release gate does not call capture, acquire credentials, save or dispatch research', async t => {
 const f = fixture(); let captures = 0; f.adapter.capture = () => { captures++; return []; };
 const dir = directory(t), service = new ResearchService({ directory: dir, adapter: f.adapter, disabledReason: 'Plan controls and reports are not ready.' });
 const status = await service.availability(f.input); assert.equal(status.available, false); assert.match(status.reason, /not ready/);
 await assert.rejects(service.create(f.input), /not ready/); assert.equal(f.calls.length, 0); assert.equal(captures, 0); assert.deepEqual(service.list(), []); assert.deepEqual(fs.readdirSync(dir), []);
});
test('ordinary Chat cannot race a research run in the same conversation', async t => {
 const service = new ChatService({ directory: directory(t), provider: { streamChat: async () => {} } }); t.after(() => service.shutdown());
 const connection = service.saveConnection({ name: 'Test', provider: 'ollama', baseUrl: 'http://example.test:11434' });
 const chat = service.createConversation({ connectionId: connection.id, model: 'local' }); service.researchBusy = id => id === chat.id;
 await assert.rejects(service.sendMessage({ conversationId: chat.id, text: 'Conflicting turn' }), /Stop or finish research/);
 assert.throws(() => service.send({ conversationId: chat.id, text: 'Conflicting turn' }), /Stop or finish research/); assert.equal(service.conversation(chat.id).messages.length, 0);
});
