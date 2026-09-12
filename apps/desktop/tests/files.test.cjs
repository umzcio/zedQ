const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { FileService } = require('../electron/files.cjs');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zq-files-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const directory = path.join(root, 'store'); const file = path.join(root, 'note.md');
  fs.writeFileSync(file, 'original', { mode: 0o640 });
  return { root, directory, file, service: new FileService(directory) };
}

test('file grants and drafts survive restart without writing the original', (t) => {
  const { directory, file, service } = fixture(t);
  const doc = service.open(file);
  assert.equal(service.open(file).id, doc.id);
  service.edit(doc.id, 'draft 你好');
  const recovered = new FileService(directory).list()[0];
  assert.equal(recovered.body, 'draft 你好'); assert.equal(recovered.savedBody, 'original');
  assert.equal(fs.readFileSync(file, 'utf8'), 'original');
  assert.equal(fs.statSync(path.join(directory, 'files.json')).mode & 0o777, 0o600);
  const saved = new FileService(directory).save(doc.id);
  assert.equal(saved.body, saved.savedBody); assert.notEqual(saved.fingerprint, doc.fingerprint);
  assert.equal(fs.readFileSync(file, 'utf8'), 'draft 你好');
  assert.equal(fs.statSync(file).mode & 0o777, 0o640);
});

test('external edits and deletion preserve both external data and the recovery draft', (t) => {
  const { directory, file, service } = fixture(t); const doc = service.open(file);
  service.edit(doc.id, 'my draft'); fs.writeFileSync(file, 'external');
  assert.throws(() => service.save(doc.id), { code: 'CONFLICT' });
  assert.equal(fs.readFileSync(file, 'utf8'), 'external');
  assert.equal(new FileService(directory).list()[0].body, 'my draft');
  assert.ok(new FileService(directory).list()[0].warning);
  fs.unlinkSync(file);
  assert.throws(() => service.save(doc.id), { code: 'MISSING_FILE' });
  assert.equal(new FileService(directory).list()[0].body, 'my draft');
});

test('save-as writes a private new file, reload explicitly discards a draft, close revokes access', (t) => {
  const { root, file, directory, service } = fixture(t); const doc = service.open(file);
  service.edit(doc.id, 'copy'); const copy = path.join(root, 'copy.txt');
  const saved = service.saveAs(doc.id, copy);
  assert.equal(saved.path, fs.realpathSync(copy)); assert.equal(saved.savedBody, 'copy');
  assert.equal(fs.readFileSync(file, 'utf8'), 'original');
  assert.equal(fs.statSync(copy).mode & 0o777, 0o600);
  service.edit(doc.id, 'discard me'); fs.writeFileSync(copy, 'on disk');
  assert.equal(service.reload(doc.id).body, 'on disk');
  service.close(doc.id);
  assert.deepEqual(new FileService(directory).list(), []);
  for (const action of [() => service.edit(doc.id, 'no'), () => service.save(doc.id), () => service.saveAs(doc.id, file), () => service.reload(doc.id), () => service.close(doc.id)]) assert.throws(action, { code: 'UNKNOWN_FILE' });
});

test('rejects invalid UTF-8, binary, oversized, nonregular files and invalid drafts', (t) => {
  const { root, file, service } = fixture(t);
  for (const [name, body] of [['binary', Buffer.from([0, 1, 2])], ['utf8', Buffer.from([0xc3, 0x28])], ['large', Buffer.alloc(2 * 1024 * 1024 + 1, 65)]]) {
    const target = path.join(root, name); fs.writeFileSync(target, body);
    assert.throws(() => service.open(target), { code: 'INVALID_FILE' });
  }
  assert.throws(() => service.open(root), { code: 'INVALID_FILE' });
  const doc = service.open(file);
  for (const value of [null, {}, 'bad\u0000', '\ud800', 'a'.repeat(2 * 1024 * 1024 + 1)]) assert.throws(() => service.edit(doc.id, value), { code: 'INVALID_FILE' });
  assert.equal(service.list()[0].body, 'original');
});

test('corrupt persisted grants reject startup and never get silently reset', (t) => {
  const { directory, file, service } = fixture(t); service.open(file);
  const store = path.join(directory, 'files.json');
  for (const content of ['oops', '{"version":2,"documents":[]}', '{"version":1,"documents":[{"id":"bad"}]}']) {
    fs.writeFileSync(store, content);
    assert.throws(() => new FileService(directory), { code: 'CORRUPT_STORE' });
    assert.throws(() => service.edit(service.list()[0].id, 'draft'), { code: 'CORRUPT_STORE' });
    assert.equal(fs.readFileSync(store, 'utf8'), content);
  }
});

test('returned documents cannot mutate native grants and same-size edits cause conflict', (t) => {
  const { file, service } = fixture(t); const doc = service.open(file);
  doc.path = '/unauthorized'; doc.body = 'tampered';
  const listed = service.list(); listed[0].body = 'also tampered';
  assert.equal(service.list()[0].body, 'original');
  service.edit(doc.id, 'mine'); fs.writeFileSync(file, 'external');
  assert.throws(() => service.save(doc.id), { code: 'CONFLICT' });
});

test('replacing a grant with a symlink never writes its target', (t) => {
  const { root, file, service } = fixture(t); const doc = service.open(file); service.edit(doc.id, 'draft');
  const victim = path.join(root, 'other.txt'); fs.writeFileSync(victim, 'untouched');
  fs.unlinkSync(file); fs.symlinkSync(victim, file);
  assert.throws(() => service.save(doc.id), { code: 'INVALID_FILE' });
  assert.equal(fs.readFileSync(victim, 'utf8'), 'untouched');
  assert.equal(service.list()[0].body, 'draft');
});

test('another service cannot overwrite newer recovery drafts', (t) => {
  const { directory, file, service } = fixture(t); const doc = service.open(file);
  const second = new FileService(directory); second.edit(doc.id, 'newer draft');
  assert.throws(() => service.edit(doc.id, 'stale draft'), { code: 'CONFLICT' });
  assert.throws(() => service.save(doc.id), { code: 'CONFLICT' });
  assert.equal(new FileService(directory).list()[0].body, 'newer draft');
  assert.equal(fs.readFileSync(file, 'utf8'), 'original');
});

test('save-as preserves overwrite permissions and cannot clobber another open draft', (t) => {
  const { root, file, service } = fixture(t); const doc = service.open(file); service.edit(doc.id, 'new body');
  const target = path.join(root, 'existing.txt'); fs.writeFileSync(target, 'old', { mode: 0o644 });
  service.saveAs(doc.id, target);
  assert.equal(fs.readFileSync(target, 'utf8'), 'new body');
  assert.equal(fs.statSync(target).mode & 0o777, 0o644);
  const other = service.open(file); service.edit(other.id, 'keep draft');
  assert.throws(() => service.saveAs(doc.id, file), { code: 'CONFLICT' });
  assert.equal(service.list().find(item => item.id === other.id).body, 'keep draft');
});

test('UTF-8 byte-order marks survive save and recovery validation', (t) => {
  const { file, service, directory } = fixture(t); fs.writeFileSync(file, '\ufeffhello');
  const doc = service.open(file); assert.equal(doc.body, '\ufeffhello');
  service.edit(doc.id, '\ufeffchanged'); service.save(doc.id);
  assert.equal(new FileService(directory).list()[0].body, '\ufeffchanged');
  assert.deepEqual([...fs.readFileSync(file).subarray(0, 3)], [239, 187, 191]);
});
