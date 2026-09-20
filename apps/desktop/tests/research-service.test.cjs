'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { randomUUID } = require('node:crypto');
const { ResearchService } = require('../electron/research/service.cjs');
const { ResearchStore } = require('../electron/research/store.cjs');
const schema = require('../electron/research/schema.cjs');

const tick = () => new Promise(resolve => setImmediate(resolve));
async function until(fn) { for (let i = 0; i < 500; i++) { if (fn()) return; await new Promise(resolve => setTimeout(resolve, 5)); } assert.fail('Research did not reach expected state.'); }
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function input(conversationId = 'conversation-1') { return { id: randomUUID(), conversationId, projectId: null, choice: { connectionId: 'selected-account', model: 'selected-model' }, brief: 'Compare the documented measurements and explain uncertainties.', sources: [{ kind: 'web', id: 'web', scope: ['example.test'] }] }; }
const plan = { title: 'Compare measurements', steps: ['Read the measurements', 'Compare and check the evidence'], questions: [] };
function sourceResult(job) {
 return { evidence: [{ id: 'e1', sourceId: job.input.sources[0].id, title: 'Measurements', locator: 'Table 1', url: 'https://example.test/measurements', retrievedAt: 1000, excerpt: 'A: 12, B: 20.', level: 'excerpt', provenance: { tool: 'read', requestId: 'read-1' } }],
  findings: [{ id: 'f1', text: 'B is larger than A in the reported sample.', evidenceIds: ['e1'], kind: 'sourced' }], gaps: ['The sample date is not stated.'], done: true, usage: { inputTokens: 21, outputTokens: 10 } };
}
function adapterFixture() {
 const published = new Map(), calls = [];
 const adapter = {
  revision: 'account-revision-1',
  async resolve(input) { return { adapterId: 'test-evidence-adapter', connectionRevision: adapter.revision, sources: input.sources.map(source => ({ ...source, label: source.id, revision: 'source-revision-1', capability: 'search_read', scopeDescription: 'Only the selected scope' })) }; },
  async runPhase({ job, stepId }) {
   calls.push({ id: job.id, phase: job.phase, choice: job.input.choice, stepId });
   if (job.phase === 'planning') return { plan };
   if (job.phase === 'researching') return sourceResult(job);
   if (job.phase === 'checking') return { findings: job.findings, gaps: job.gaps };
   return { reportDraft: { title: 'Comparison', markdown: 'B exceeds A. [Measurements](https://example.test/measurements)\n\nThe sample date is unknown.', citationIds: job.evidence.map(e => e.id) } };
  },
  async publish({ idempotencyKey, job }) {
   assert.equal(job.reportDraft.citationIds[0], 'e1');
   if (!published.has(idempotencyKey)) published.set(idempotencyKey, { artifactId: randomUUID(), versionId: randomUUID() });
   return published.get(idempotencyKey);
  },
 };
 return { adapter, published, calls };
}
function fixture(t, options = {}) {
 const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'zq-research-'));
 const fake = adapterFixture(), changes = [], services = [];
 const make = (override = {}) => { const service = new ResearchService({ directory, adapter: fake.adapter, onChange: change => changes.push(change), ...options, ...override }); services.push(service); return service; };
 const service = make();
 t.after(() => { for (const service of services) { try { service.shutdown(); } catch {} } fs.rmSync(directory, { recursive: true, force: true }); });
 return { directory, ...fake, changes, service, make };
}
async function planned(f, request = input()) { await f.service.create(request); await until(() => f.service.get(request.id).status === 'awaiting_plan'); return request; }
function accept(f, id) { const job = f.service.get(id); return f.service.acceptPlan({ id, expectedRevision: job.revision, plan: job.plan }); }

test('native research survives view subscription loss and checkpoints each phase before dependent execution', async t => {
 const f = fixture(t), request = await planned(f);
 assert.equal(f.service.get(request.id).usage.steps, 1);
 const original = f.adapter.runPhase;
 f.adapter.runPhase = async args => {
  const saved = new ResearchStore(f.directory).load(request.id);
  assert.equal(saved.steps.at(-1).status, 'started'); assert.equal(saved.steps.at(-1).id, args.stepId);
  if (args.job.phase === 'checking') assert.equal(saved.evidence[0].id, 'e1');
  return original(args);
 };
 f.service.onChange = () => { throw new Error('The view unmounted.'); };
 accept(f, request.id); await until(() => f.service.get(request.id).status === 'completed');
 const job = f.service.get(request.id);
 assert.deepEqual(job.steps.map(s => s.phase), ['planning', 'researching', 'checking', 'writing', 'publishing']);
 assert.equal(job.usage.inputTokens, 21); assert.equal(job.usage.unmeasuredSteps, 3);
 assert.equal(job.evidenceCount, 1); assert.equal(job.findingCount, 1); assert.deepEqual(job.usedSourceIds, ['web']);
 assert.deepEqual(job.choice, request.choice); assert.ok(job.report.versionId);
 assert.equal(fs.existsSync(path.join(f.directory, 'chat.json')), false);
 const restarted = f.make(); assert.deepEqual(restarted.get(request.id).report, job.report);
 assert.equal(f.published.size, 1);
});

test('summary events remain small and omit evidence/brief payloads', async t => {
 const f = fixture(t), request = await planned(f); accept(f, request.id);
 await until(() => f.service.get(request.id).status === 'completed');
 for (const { job } of f.changes) { assert.equal(job.evidence, undefined); assert.equal(job.brief, undefined); assert.equal(job.steps, undefined); assert.ok(Buffer.byteLength(JSON.stringify(job)) < 4096); }
});

test('one active job per conversation; request IDs prevent duplicate submissions', async t => {
 const f = fixture(t), request = await planned(f);
 assert.equal((await f.service.create(request)).id, request.id);
 await assert.rejects(f.service.create({ ...request, brief: 'Different brief' }), /already used/);
 await assert.rejects(f.service.create(input()), /already has active/);
 f.service.stop(request.id);
 const second = await planned(f, input());
 assert.throws(() => f.service.resume(request.id), /already has active/);
 assert.equal(f.service.get(second.id).status, 'awaiting_plan');
});

test('concurrent preparation cannot create two jobs for one conversation', async t => {
 const f = fixture(t), gate = deferred(), original = f.adapter.resolve;
 f.adapter.resolve = async request => { await gate.promise; return original(request); };
 const request = input(), first = f.service.create(request);
 await assert.rejects(f.service.create(input()), /already has active/);
 gate.resolve(); await first; await until(() => f.service.get(request.id).status === 'awaiting_plan');
});

test('source scopes are resolved exactly and unexpected secret fields cannot enter checkpoints', async t => {
 const f = fixture(t), original = f.adapter.resolve, request = input();
 f.adapter.resolve = async i => { const b = await original(i); b.sources[0].scope = []; return b; };
 await assert.rejects(f.service.create(request), /selected scope/);
 f.adapter.resolve = async i => ({ ...await original(i), apiKey: 'do-not-save' });
 await assert.rejects(f.service.create(request), /Unexpected research field/);
 assert.equal(f.service.list().length, 0); assert.equal(fs.readdirSync(f.directory).length, 0);
});

test('no adapter means no paid dispatch, no job, and an explicit unavailable capability', async t => {
 const f = fixture(t, { adapter: null }), request = input();
 const available = await f.service.availability(request);
 assert.equal(available.available, false); assert.match(available.reason, /not available/);
 await assert.rejects(f.service.create(request), /not available/);
 assert.deepEqual(f.service.list(), []);
});

test('plan acceptance rejects stale edits and unresolved questions', async t => {
 const f = fixture(t), request = await planned(f), job = f.service.get(request.id);
 assert.throws(() => f.service.acceptPlan({ id: request.id, expectedRevision: job.revision - 1, plan }), /plan changed/);
 assert.throws(() => f.service.acceptPlan({ id: request.id, expectedRevision: job.revision, plan: { ...plan, questions: ['Which year?'] } }), /clarification/);
 assert.equal(f.calls.length, 1);
 f.service.stop(request.id); f.service.resume(request.id);
 assert.equal(f.service.get(request.id).status, 'awaiting_plan'); assert.equal(f.calls.length, 1);
});

test('Stop is idempotent, preserves evidence, and rejects late results even when an adapter ignores abort', async t => {
 const f = fixture(t), request = await planned(f), gate = deferred();
 f.adapter.runPhase = () => gate.promise;
 accept(f, request.id); await until(() => f.service.get(request.id).status === 'running');
 await tick(); f.service.stop(request.id); const stopped = f.service.get(request.id);
 assert.equal(stopped.status, 'stopped'); assert.deepEqual(f.service.stop(request.id), stopped);
 gate.resolve(sourceResult(new ResearchStore(f.directory).load(request.id))); await tick(); await tick();
 assert.deepEqual(f.service.get(request.id), stopped); assert.equal(f.published.size, 0);
});

test('immediate Stop prevents the queued provider from starting', async t => {
 const f = fixture(t), request = await planned(f); accept(f, request.id); f.service.stop(request.id);
 await tick(); assert.equal(f.calls.length, 1); assert.equal(f.service.get(request.id).status, 'stopped');
});

test('Finish cancels collection and writes only committed evidence, with no late collection restart', async t => {
 const f = fixture(t), request = await planned(f), original = f.adapter.runPhase, late = deferred(); let collects = 0;
 f.adapter.runPhase = async args => {
  if (args.job.phase === 'researching') { collects++; if (collects === 1) return { ...sourceResult(args.job), done: false }; return late.promise; }
  return original(args);
 };
 accept(f, request.id); await until(() => collects === 2);
 const finishing = f.service.finish(request.id); assert.equal(finishing.phase, 'checking');
 assert.deepEqual(f.service.finish(request.id), finishing);
 await until(() => f.service.get(request.id).status === 'completed');
 late.resolve({ evidence: [{ ...sourceResult({ input: request }).evidence[0], id: 'late' }], findings: [], gaps: [], done: false }); await tick();
 const job = f.service.get(request.id); assert.deepEqual(job.evidence.map(e => e.id), ['e1']); assert.equal(collects, 2); assert.equal(job.finishRequested, true);
});

test('Finish with no evidence creates an explicitly partial report through checking/writing', async t => {
 const f = fixture(t), request = await planned(f), waiting = deferred();
 f.adapter.runPhase = async ({ job }) => {
  if (job.phase === 'researching') return waiting.promise;
  if (job.phase === 'checking') return { findings: [], gaps: ['No sources were collected.'] };
  assert.deepEqual(job.gaps, ['No sources were collected.']);
  return { reportDraft: { title: 'Incomplete research', markdown: 'No evidence was collected. No conclusion is supported.', citationIds: [] } };
 };
 f.adapter.publish = async ({ job }) => { assert.deepEqual(job.reportDraft.citationIds, []); return { artifactId: randomUUID(), versionId: randomUUID() }; };
 accept(f, request.id); await until(() => f.service.get(request.id).status === 'running'); f.service.finish(request.id);
 await until(() => f.service.get(request.id).status === 'completed'); assert.equal(f.service.get(request.id).evidenceCount, 0);
});

test('bounded scheduler leaves other jobs visibly queued and releases a cancelled slot', async t => {
 const f = fixture(t, { concurrency: 1 }), gate = deferred(); let started = 0;
 f.adapter.runPhase = () => { started++; return gate.promise; };
 const a = input('a'), b = input('b'); await f.service.create(a); await f.service.create(b);
 await until(() => started === 1); assert.equal(f.service.get(b.id).status, 'queued');
 f.service.stop(a.id); await until(() => started === 2); assert.equal(f.service.get(b.id).status, 'running');
 gate.resolve({ plan }); await until(() => f.service.get(b.id).status === 'awaiting_plan');
 assert.equal(f.service.get(a.id).status, 'stopped');
});

test('shutdown cancels all jobs, reopens without paid work, and explicit resume continues', async t => {
 const f = fixture(t), request = await planned(f), original = f.adapter.runPhase, waiting = deferred();
 f.adapter.runPhase = () => waiting.promise; accept(f, request.id); await until(() => f.service.get(request.id).status === 'running');
 f.service.shutdown(); assert.equal(f.service.get(request.id).status, 'interrupted');
 assert.throws(() => f.service.resume(request.id), /closes/); f.service.reopen(); await tick();
 assert.equal(f.service.get(request.id).status, 'interrupted');
 f.adapter.runPhase = original; f.service.resume(request.id); await until(() => f.service.get(request.id).status === 'completed');
 waiting.resolve(sourceResult({ input: request })); await tick(); assert.equal(f.published.size, 1);
});

test('preparation cannot dispatch if the application closes while capability resolution is pending', async t => {
 const f = fixture(t), gate = deferred(), original = f.adapter.resolve;
 f.adapter.resolve = async request => { await gate.promise; return original(request); };
 const preparation = f.service.create(input()); f.service.shutdown(); f.service.reopen(); gate.resolve();
 await assert.rejects(preparation, /interrupted/); assert.equal(f.calls.length, 0); assert.equal(f.service.list().length, 0);
});

test('crash recovery retains evidence, interrupts abandoned work and makes no automatic requests', async t => {
 const f = fixture(t), request = await planned(f); f.service.shutdown();
 const store = new ResearchStore(f.directory), saved = store.load(request.id);
 saved.revision++; saved.status = 'running'; saved.phase = 'researching'; saved.acceptedPlanVersion = saved.planVersion;
 saved.steps.push({ id: randomUUID(), phase: 'researching', status: 'started', startedAt: 1, finishedAt: null, reservedMs: saved.limits.stepTimeoutMs });
 saved.usage.steps++; saved.usage.activeMs += saved.limits.stepTimeoutMs; saved.usage.unmeasuredSteps++;
 saved.evidence = sourceResult(saved).evidence; store.save(saved, saved.revision - 1);
 const before = f.calls.length, restored = f.make(); await tick();
 assert.equal(f.calls.length, before); const recovered = restored.get(request.id);
 assert.equal(recovered.status, 'interrupted'); assert.equal(recovered.steps.at(-1).status, 'interrupted');
 assert.equal(recovered.usage.activeMs, saved.usage.activeMs); assert.deepEqual(recovered.evidence, saved.evidence);
 restored.resume(request.id); await until(() => restored.get(request.id).status === 'completed');
});

test('account/source changes are revalidated before dispatch and after completion', async t => {
 const f = fixture(t), request = await planned(f), original = f.adapter.runPhase;
 f.adapter.revision = 'different-account'; accept(f, request.id);
 await until(() => f.service.get(request.id).status === 'failed'); assert.equal(f.calls.length, 1);
 assert.equal(f.service.get(request.id).error.code, 'RESEARCH_ACCESS_CHANGED');
 f.adapter.revision = 'account-revision-1';
 f.adapter.runPhase = async args => { const result = await original(args); f.adapter.revision = 'changed-during-read'; return result; };
 f.service.resume(request.id); await until(() => f.service.get(request.id).status === 'failed');
 assert.equal(f.service.get(request.id).evidenceCount, 0);
});

test('invalid/unselected evidence and unresolved citations never replace the last good checkpoint', async t => {
 const f = fixture(t), request = await planned(f), original = f.adapter.runPhase;
 f.adapter.runPhase = async args => { const r = sourceResult(args.job); r.evidence[0].sourceId = 'private-unselected'; return r; };
 accept(f, request.id); await until(() => f.service.get(request.id).status === 'failed'); assert.equal(f.service.get(request.id).evidenceCount, 0);
 f.adapter.runPhase = async args => args.job.phase === 'writing' ? { reportDraft: { title: 'Invalid report', markdown: 'Invented citation', citationIds: ['missing'] } } : original(args);
 f.service.resume(request.id); await until(() => f.service.get(request.id).status === 'failed');
 assert.equal(f.service.get(request.id).evidenceCount, 1); assert.equal(f.published.size, 0);
 assert.match(f.service.get(request.id).error.message, /missing evidence/);
});

test('stored evidence is immutable across repeat reads', async t => {
 const f = fixture(t), request = await planned(f); let count = 0;
 f.adapter.runPhase = async args => { const r = sourceResult(args.job); if (++count > 1) r.evidence[0].excerpt = 'Changed content under same evidence ID'; return { ...r, done: false }; };
 accept(f, request.id); await until(() => f.service.get(request.id).status === 'failed');
 assert.equal(f.service.get(request.id).evidence[0].excerpt, 'A: 12, B: 20.');
});

test('collection limits are durable and reserve capacity for Finish', async t => {
 const f = fixture(t, { limits: { maxSteps: 7, maxActiveMs: 900000, stepTimeoutMs: 10000 } }), request = await planned(f), original = f.adapter.runPhase;
 f.adapter.runPhase = async args => args.job.phase === 'researching' ? { ...sourceResult(args.job), done: false } : original(args);
 accept(f, request.id); await until(() => f.service.get(request.id).status === 'interrupted');
 const job = f.service.get(request.id); assert.equal(job.error.code, 'RESEARCH_LIMIT'); assert.equal(job.usage.steps, 4);
 f.service.resume(request.id); await until(() => f.service.get(request.id).status === 'interrupted'); assert.equal(f.service.get(request.id).usage.steps, 4);
 f.service.finish(request.id); await until(() => f.service.get(request.id).status === 'completed'); assert.equal(f.service.get(request.id).usage.steps, 7);
});

test('hung requests time out, preserve budget usage and ignore eventual resolution', async t => {
 const f = fixture(t, { limits: { maxSteps: 10, maxActiveMs: 1000, stepTimeoutMs: 60 } }), request = await planned(f), gate = deferred();
 f.adapter.runPhase = () => gate.promise; accept(f, request.id);
 await until(() => f.service.get(request.id).status === 'interrupted'); const job = f.service.get(request.id);
 assert.equal(job.error.code, 'RESEARCH_TIMEOUT'); assert.ok(job.usage.activeMs >= 60); assert.equal(job.usage.steps, 2);
 gate.resolve(sourceResult({ input: request })); await tick(); assert.deepEqual(f.service.get(request.id), job);
});

test('idempotent report publication recovers a crash after artifact creation without duplicate versions', async t => {
 const f = fixture(t), request = await planned(f), original = f.adapter.publish; let attempts = 0;
 f.adapter.publish = async args => { const target = await original(args); if (++attempts === 1) throw new Error('Simulated lost acknowledgement after commit'); return target; };
 accept(f, request.id); await until(() => f.service.get(request.id).status === 'failed');
 assert.equal(f.published.size, 1); assert.ok(new ResearchStore(f.directory).load(request.id).reportDraft);
 const writes = f.calls.filter(c => c.phase === 'writing').length;
 f.service.shutdown(); const restored = f.make(); restored.resume(request.id);
 await until(() => restored.get(request.id).status === 'completed');
 assert.equal(f.published.size, 1); assert.equal(attempts, 2); assert.equal(f.calls.filter(c => c.phase === 'writing').length, writes);
});

test('provider errors are sanitized instead of persisting credential-bearing diagnostics', async t => {
 const f = fixture(t), request = await planned(f);
 f.adapter.runPhase = async () => { throw new Error('Authorization: secret-api-key'); };
 accept(f, request.id); await until(() => f.service.get(request.id).status === 'failed');
 assert.doesNotMatch(JSON.stringify(new ResearchStore(f.directory).load(request.id)), /secret-api-key|Authorization/);
});

test('storage failure halts dispatch, aborts requests and preserves the last checkpoint', async t => {
 const f = fixture(t), request = await planned(f), originalSave = f.service.store.save.bind(f.service.store), before = f.calls.length;
 f.service.store.save = () => { throw schema.fault('RESEARCH_STORAGE', 'Disk full'); };
 assert.throws(() => accept(f, request.id), /Disk full/); await tick(); assert.equal(f.calls.length, before);
 assert.equal(new ResearchStore(f.directory).load(request.id).status, 'awaiting_plan');
 assert.throws(() => f.service.resume(request.id), /Disk full/); assert.equal(f.changes.at(-1).error.code, 'RESEARCH_STORAGE');
 f.service.store.save = originalSave;
});

test('caller and adapter mutations cannot mutate accepted inputs or returned history', async t => {
 const f = fixture(t), request = input(), savedRequest = structuredClone(request);
 await f.service.create(request); request.sources[0].scope.push('another.test'); request.choice.model = 'another-model';
 await until(() => f.service.get(request.id).status === 'awaiting_plan');
 const shown = f.service.get(request.id); shown.sources[0].scope.length = 0; shown.plan.title = 'Changed externally';
 assert.deepEqual(new ResearchStore(f.directory).load(request.id).input, savedRequest);
 assert.equal(f.service.get(request.id).plan.title, plan.title);
});

test('retrying storage reloads the committed revision and never automatically resumes a request', async t => {
 const f = fixture(t), request = await planned(f), original = f.service.store.save.bind(f.service.store);
 f.service.store.save = (job, revision) => { original(job, revision); throw Object.assign(schema.fault('RESEARCH_STORAGE', 'Directory flush failed'), { committed: true }); };
 assert.throws(() => accept(f, request.id), /flush failed/);
 assert.equal(new ResearchStore(f.directory).load(request.id).status, 'queued');
 f.service.store.save = original; const before = f.calls.length; f.service.retryStorage(); await tick();
 assert.equal(f.calls.length, before); assert.equal(f.service.get(request.id).status, 'interrupted'); assert.equal(f.service.storageError, null);
 f.service.resume(request.id); await until(() => f.service.get(request.id).status === 'completed');
});

test('a late result from a stopped generation cannot overwrite a resumed generation', async t => {
 const f = fixture(t), request = await planned(f), gate = deferred(), original = f.adapter.runPhase; let started = false;
 f.adapter.runPhase = () => { started = true; return gate.promise; }; accept(f, request.id); await until(() => started);
 f.service.stop(request.id); f.adapter.runPhase = original; f.service.resume(request.id);
 await until(() => f.service.get(request.id).status === 'completed'); const complete = f.service.get(request.id);
 const stale = sourceResult({ input: request }); stale.evidence[0].excerpt = 'Stale content'; gate.resolve(stale); await tick(); await tick();
 assert.deepEqual(f.service.get(request.id), complete);
});
