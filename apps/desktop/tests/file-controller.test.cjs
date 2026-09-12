const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { FileService } = require('../electron/files.cjs');
const { FileController } = require('../../../modules/notes/file-controller.ts');

function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }
function fixture(t, delays = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zq-controller-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const directory = path.join(root, 'store');
  const file = path.join(root, 'note.txt'); const other = path.join(root, 'other.txt');
  fs.writeFileSync(file, 'original'); fs.writeFileSync(other, 'second');
  const service = new FileService(directory); const docs = [service.open(file), service.open(other)];
  const boundary = {
    open: async () => service.open(file),
    edit: async (id, body) => { await delays.edit?.(id, body); return service.edit(id, body); },
    save: async id => { await delays.save?.(); return service.save(id); },
    saveAs: async id => { await delays.saveAs?.(); return service.saveAs(id, path.join(root, 'copy.txt')); },
    reload: async id => { await delays.reload?.(); return service.reload(id); },
  };
  return { root, file, directory, service, docs, controller: new FileController(docs, boundary) };
}

test('save freezes editing immediately and flush waits for its delayed native response', async t => {
  const gate = deferred(); const entered = deferred();
  const { controller, docs, file, directory } = fixture(t, { save: async () => { entered.resolve(); await gate.promise; } });
  controller.edit(docs[0].id, 'latest accepted text');
  const saving = controller.action(docs[0].id, 'save');
  assert.equal(controller.snapshot.busy, true);
  controller.edit(docs[0].id, 'text typed into a frozen editor');
  await entered.promise;
  let flushed = false; const flush = controller.flush().then(() => { flushed = true; });
  await new Promise(resolve => setImmediate(resolve)); assert.equal(flushed, false);
  gate.resolve(); await saving; await flush;
  assert.equal(fs.readFileSync(file, 'utf8'), 'latest accepted text');
  assert.equal(new FileService(directory).list()[0].body, 'latest accepted text');
  assert.equal(controller.snapshot.files[0].body, 'latest accepted text');
  assert.equal(controller.snapshot.busy, false);
});

test('flush serializes pending edits across IDs and persists the latest optimistic text', async t => {
  const gate = deferred(); let first = true;
  const { controller, docs, directory } = fixture(t, { edit: async () => { if (first) { first = false; await gate.promise; } } });
  controller.edit(docs[0].id, 'one'); controller.edit(docs[1].id, 'other latest'); controller.edit(docs[0].id, 'one latest');
  const flushing = controller.flush(); gate.resolve(); await flushing;
  const recovered = new FileService(directory).list();
  assert.equal(recovered.find(doc => doc.id === docs[0].id).body, 'one latest');
  assert.equal(recovered.find(doc => doc.id === docs[1].id).body, 'other latest');
});

test('failed durability rejects flush and a later retry retains the latest text', async t => {
  const { controller, docs, directory } = fixture(t);
  const store = path.join(directory, 'files.json'); const originalStore = fs.readFileSync(store);
  fs.writeFileSync(store, 'corrupted externally');
  controller.edit(docs[0].id, 'first failed'); controller.edit(docs[0].id, 'latest failed');
  await assert.rejects(controller.flush(), { code: 'CORRUPT_STORE' });
  assert.equal(controller.snapshot.files[0].body, 'latest failed');
  assert.ok(controller.snapshot.error); assert.equal(controller.snapshot.busy, false);
  fs.writeFileSync(store, originalStore);
  await controller.flush();
  assert.equal(new FileService(directory).list()[0].body, 'latest failed');
  assert.equal(controller.snapshot.error, '');
});

test('reload and save-as share the queue and cannot replace accepted edits out of order', async t => {
  const gate = deferred(); const entered = deferred();
  const { controller, docs, file, root } = fixture(t, { reload: async () => { entered.resolve(); await gate.promise; } });
  controller.edit(docs[0].id, 'draft before reload');
  fs.writeFileSync(file, 'external content');
  const reload = controller.action(docs[0].id, 'reload'); await entered.promise;
  const copy = controller.action(docs[0].id, 'saveAs');
  gate.resolve(); await reload; await copy; await controller.flush();
  assert.equal(fs.readFileSync(path.join(root, 'copy.txt'), 'utf8'), 'external content');
  assert.equal(controller.snapshot.files[0].body, 'external content');
});

test('reopening a known file retains an optimistic draft after a failed recovery write', async t => {
  const { controller, docs, directory } = fixture(t);
  const store = path.join(directory, 'files.json'); const originalStore = fs.readFileSync(store);
  fs.writeFileSync(store, 'corrupted externally');
  controller.edit(docs[0].id, 'unpersisted latest text');
  await controller.open();
  assert.equal(controller.snapshot.files[0].body, 'unpersisted latest text');
  fs.writeFileSync(store, originalStore);
  await controller.flush();
  assert.equal(new FileService(directory).list()[0].body, 'unpersisted latest text');
});
