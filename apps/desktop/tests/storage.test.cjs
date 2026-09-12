const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { WorkspaceStore } = require('../electron/storage.cjs');

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'zq-store-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}
const state = () => ({ notes: [{ id: 'n1', title: 'Note', body: '你好', project: '', updated: 'Today', pinned: false }], tasks: [{ id: 't1', title: 'Task', description: '', project: '', status: 'Next', priority: 'Normal', noteId: 'n1' }], theme: 'system', palette: 'gunmetal', layout: { view: 'notes', selectedNote: 'n1', tabs: ['n1'], sidebar: true, split: false, quickCapture: '', activeFileId: null } });

test('workspace survives restart with private permissions and clean atomic replacement', (t) => {
  const directory = fixture(t);
  const store = new WorkspaceStore(directory);
  assert.equal(store.load(), null);
  store.save(state());
  const next = state(); next.notes[0].body = 'Updated';
  store.save(next);
  assert.deepEqual(new WorkspaceStore(directory).load(), next);
  assert.equal(fs.statSync(path.join(directory, 'workspace.json')).mode & 0o777, 0o600);
  assert.deepEqual(fs.readdirSync(directory), ['workspace.json']);
});

test('corrupt and future workspace versions are never overwritten', (t) => {
  const directory = fixture(t); const file = path.join(directory, 'workspace.json');
  for (const content of ['{broken', '{"version":99,"state":{}}', '{"version":1,"state":{"notes":[]}}']) {
    fs.writeFileSync(file, content);
    const store = new WorkspaceStore(directory);
    assert.throws(() => store.load(), { code: 'CORRUPT_STORE' });
    assert.throws(() => store.save(state()), { code: 'CORRUPT_STORE' });
    assert.equal(fs.readFileSync(file, 'utf8'), content);
  }
});

test('invalid workspace inputs cannot replace valid data', (t) => {
  const directory = fixture(t); const store = new WorkspaceStore(directory); store.save(state());
  for (const mutate of [s => s.theme = 'other', s => s.notes[0].pinned = 'yes', s => s.tasks[0].status = 'Unknown', s => s.notes.push({...s.notes[0]}), s => s.layout.bad = true, s => s.notes[0].body = 'x'.repeat(2 * 1024 * 1024 + 1), s => s.path = '/tmp/no']) {
    const invalid = state(); mutate(invalid);
    assert.throws(() => store.save(invalid), { code: 'INVALID_STATE' });
    assert.deepEqual(store.load(), state());
  }
});

test('workspace never follows a store symlink or blocks reading a nonregular store', (t) => {
  const directory = fixture(t); const store = new WorkspaceStore(directory); const target = path.join(directory, 'target');
  fs.writeFileSync(target, JSON.stringify({ version: 1, state: state() }));
  fs.symlinkSync(target, path.join(directory, 'workspace.json'));
  assert.throws(() => store.load(), { code: 'CORRUPT_STORE' });
  assert.throws(() => store.save(state()), { code: 'CORRUPT_STORE' });
  fs.unlinkSync(path.join(directory, 'workspace.json'));
  fs.mkdirSync(path.join(directory, 'workspace.json'));
  assert.throws(() => store.load(), { code: 'CORRUPT_STORE' });
});

test('workspace rejects a FIFO without blocking the main process', (t) => {
  const directory = fixture(t);
  execFileSync('mkfifo', [path.join(directory, 'workspace.json')]);
  const script = `const { WorkspaceStore } = require(process.argv[1]); try { new WorkspaceStore(process.argv[2]).load(); process.exit(2); } catch (error) { process.exit(error.code === 'CORRUPT_STORE' ? 0 : 3); }`;
  const result = spawnSync(process.execPath, ['-e', script, require.resolve('../electron/storage.cjs'), directory], { timeout: 1000 });
  assert.equal(result.error, undefined, 'A nonregular store must not block');
  assert.equal(result.status, 0);
});

test('mixed tab order persists and malformed tab orders cannot replace it', t => {
 const directory = fixture(t); const store = new WorkspaceStore(directory);
 const next = state(); next.layout.tabOrder = ['file:f1','note:n1'];
 store.save(next);
 assert.deepEqual(new WorkspaceStore(directory).load(), next);
 for (const order of [['note:n1','note:n1'],['unknown:n1'],['file:'],[5]]) {
  const invalid = structuredClone(next); invalid.layout.tabOrder = order;
  assert.throws(() => store.save(invalid), {code:'INVALID_STATE'});
  assert.deepEqual(store.load(), next);
 }
});
