'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { randomUUID } = require('node:crypto');
const { ResearchStore } = require('../electron/research/store.cjs');
const { DEFAULT_LIMITS } = require('../electron/research/schema.cjs');

function job() {
 const id = randomUUID(), source = { id: 'source', kind: 'note', scope: [] };
 return { id, revision: 1, input: { id, conversationId: 'chat', projectId: null, choice: { connectionId: 'account', model: 'chosen' }, brief: 'Compare the references.', sources: [source] },
  binding: { adapterId: 'fixture', connectionRevision: 'v1', sources: [{ ...source, label: 'A note', revision: 'r1', capability: 'read', scopeDescription: 'This note only' }] },
  phase: 'planning', status: 'queued', generation: 0, plan: null, planVersion: 0, acceptedPlanVersion: null, steps: [], evidence: [], findings: [], gaps: [], reportDraft: null,
  report: null, publicationKey: `research:${id}:report:1`, finishRequested: false, createdAt: 1, updatedAt: 1,
  usage: { steps: 0, activeMs: 0, inputTokens: 0, outputTokens: 0, unmeasuredSteps: 0 }, limits: { ...DEFAULT_LIMITS }, error: null };
}
function fixture(t) {
 const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'zq-research-store-')), store = new ResearchStore(path.join(directory, 'research'));
 t.after(() => fs.rmSync(directory, { recursive: true, force: true })); return { directory, store };
}
test('checkpoint storage is lazy, private, atomic and returns detached data', t => {
 const { store } = fixture(t); assert.deepEqual(store.loadAll(), []); assert.equal(fs.existsSync(store.directory), false);
 const saved = job(); store.save(saved, 0);
 assert.equal(fs.statSync(store.file(saved.id)).mode & 0o777, 0o600); assert.equal(fs.statSync(store.directory).mode & 0o777, 0o700);
 assert.deepEqual(store.load(saved.id), saved);
 store.load(saved.id).input.brief = 'mutated read'; assert.equal(store.load(saved.id).input.brief, saved.input.brief);
 assert.deepEqual(fs.readdirSync(store.directory), [`${saved.id}.json`]);
});
test('checkpoint compare-and-swap prevents old owners overwriting newer revisions', t => {
 const { store } = fixture(t), saved = job(); store.save(saved, 0);
 const newer = { ...saved, revision: 2, generation: 1 }; store.save(newer, 1);
 assert.throws(() => store.save({ ...saved, revision: 2 }, 1), /changed elsewhere/);
 assert.deepEqual(store.load(saved.id), newer);
});
test('truncated, foreign-version and corrupt checkpoints are preserved', t => {
 const { store } = fixture(t), saved = job(); store.save(saved, 0);
 for (const body of ['{"partial":', '{"version":99,"job":{}}', JSON.stringify({ version: 1, job: { ...saved, apiKey: 'secret' } })]) {
  fs.writeFileSync(store.file(saved.id), body); assert.throws(() => store.loadAll(), /preserved/);
  assert.throws(() => store.save({ ...saved, revision: 2 }, 1), /preserved/); assert.equal(fs.readFileSync(store.file(saved.id), 'utf8'), body);
 }
});
test('unsafe paths, symlink checkpoints, and symlink storage directories fail closed', t => {
 const { directory, store } = fixture(t), saved = job();
 assert.throws(() => store.load('../../secret')); assert.throws(() => store.save({ ...saved, id: '../outside' }, 0));
 store.save(saved, 0); const target = path.join(directory, 'original.json'); fs.renameSync(store.file(saved.id), target); fs.symlinkSync(target, store.file(saved.id));
 assert.throws(() => store.load(saved.id), /preserved/); assert.throws(() => store.loadAll(), /preserved/);
 const linked = path.join(directory, 'linked'); fs.symlinkSync(store.directory, linked); assert.throws(() => new ResearchStore(linked).loadAll(), /preserved/);
 assert.throws(() => new ResearchStore(linked).load(saved.id), /preserved/);
});
test('invalid provider payloads cannot write unselected evidence or broken finding references', t => {
 const { store } = fixture(t), saved = job(); store.save(saved, 0);
 const e = { id: 'e', sourceId: 'not-selected', title: 'title', locator: 'line 1', retrievedAt: 1, excerpt: 'content', level: 'excerpt', provenance: { tool: 'read', requestId: 'r' } };
 assert.throws(() => store.save({ ...saved, revision: 2, evidence: [e] }, 1), /unselected/);
 assert.throws(() => store.save({ ...saved, revision: 2, findings: [{ id: 'f', text: 'claim', evidenceIds: ['missing'], kind: 'sourced' }] }, 1), /missing evidence/);
 assert.throws(() => store.save({ ...saved, revision: 2, input: { ...saved.input, brief: '\ud800' } }, 1), /Invalid research/);
 assert.deepEqual(store.load(saved.id), saved);
});
test('rename failure leaves old checkpoint intact and removes the uncommitted temporary file', t => {
 const { store } = fixture(t), saved = job(); store.save(saved, 0);
 const rename = fs.renameSync;
 try {
  fs.renameSync = () => { throw Object.assign(new Error('disk failure'), { code: 'EIO' }); };
  assert.throws(() => store.save({ ...saved, revision: 2 }, 1), error => error.committed === false);
 } finally { fs.renameSync = rename; }
 assert.deepEqual(store.load(saved.id), saved); assert.deepEqual(fs.readdirSync(store.directory), [`${saved.id}.json`]);
});
test('directory flush failure reports that rename committed so recovery can reconcile correctly', t => {
 const { store } = fixture(t), saved = job(); store.save(saved, 0);
 const fsync = fs.fsyncSync; let calls = 0;
 try {
  fs.fsyncSync = fd => { if (++calls === 2) throw new Error('directory flush failed'); return fsync(fd); };
  assert.throws(() => store.save({ ...saved, revision: 2 }, 1), error => error.committed === true);
 } finally { fs.fsyncSync = fsync; }
 assert.equal(store.load(saved.id).revision, 2);
});
