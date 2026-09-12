'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const MAX_FILE = 2 * 1024 * 1024;
const MAX_STORE = 32 * 1024 * 1024;
function fail(code, message) { throw Object.assign(new Error(message), { code }); }
function hash(bytes) { return createHash('sha256').update(bytes).digest('hex'); }
function text(value, max = MAX_FILE) {
  return typeof value === 'string' && Buffer.byteLength(value) <= max && !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/u.test(value) && Buffer.from(value).toString('utf8') === value;
}
function readDisk(file) {
  let fd;
  try {
    // O_NONBLOCK prevents a file replaced by a FIFO from blocking the main process.
    fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.size > MAX_FILE) fail('INVALID_FILE', 'Choose a regular UTF-8 text file no larger than 2 MiB.');
    const buffer = Buffer.alloc(MAX_FILE + 1); let length = 0;
    while (length < buffer.length) { const count = fs.readSync(fd, buffer, length, buffer.length - length, null); if (!count) break; length += count; }
    if (length > MAX_FILE) fail('INVALID_FILE', 'File exceeds the 2 MiB limit.');
    const bytes = buffer.subarray(0, length);
    let body;
    try { body = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); } catch { fail('INVALID_FILE', 'File must contain valid UTF-8 text.'); }
    if (!text(body)) fail('INVALID_FILE', 'Binary files are not supported.');
    return { body, fingerprint: hash(bytes), mode: stat.mode & 0o777, dev: stat.dev, ino: stat.ino };
  } catch (error) {
    if (error.code === 'ENOENT') fail('MISSING_FILE', 'File is missing. Save a copy to retain your draft.');
    if (['ELOOP', 'EISDIR', 'ENXIO'].includes(error.code)) fail('INVALID_FILE', 'File is no longer a regular file.');
    throw error;
  } finally { if (fd !== undefined) fs.closeSync(fd); }
}
function atomicWrite(file, bytes, mode, beforeRename = () => {}) {
  const directory = path.dirname(file);
  const temp = path.join(directory, `.zq-${randomUUID()}.tmp`);
  let fd;
  try {
    fd = fs.openSync(temp, 'wx', 0o600);
    fs.writeFileSync(fd, bytes); fs.fchmodSync(fd, mode); fs.fsyncSync(fd); fs.closeSync(fd); fd = undefined;
    beforeRename(); fs.renameSync(temp, file);
    const directoryFd = fs.openSync(directory, 'r');
    try { fs.fsyncSync(directoryFd); } finally { fs.closeSync(directoryFd); }
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
    try { fs.unlinkSync(temp); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
}
function validateDocuments(wrapper) {
  if (!wrapper || wrapper.version !== 1 || Object.keys(wrapper).some(key => !['version', 'documents'].includes(key)) || !Array.isArray(wrapper.documents) || wrapper.documents.length > 1000) return false;
  const ids = new Set(); const paths = new Set();
  return wrapper.documents.every(doc => {
    if (!doc || typeof doc !== 'object' || Object.keys(doc).some(key => !['id', 'path', 'name', 'body', 'savedBody', 'fingerprint'].includes(key)) || !text(doc.id, 256) || !doc.id || ids.has(doc.id) || !text(doc.path, 32768) || !path.isAbsolute(doc.path) || paths.has(doc.path) || doc.name !== path.basename(doc.path) || !text(doc.body) || !text(doc.savedBody) || typeof doc.fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(doc.fingerprint) || hash(Buffer.from(doc.savedBody)) !== doc.fingerprint) return false;
    ids.add(doc.id); paths.add(doc.path); return true;
  });
}

class FileService {
  constructor(directory) {
    this.directory = path.resolve(directory); this.storePath = path.join(this.directory, 'files.json');
    const loaded = this.readStore(); this.documents = loaded.documents; this.storeFingerprint = loaded.fingerprint;
  }
  readStore() {
    let fd;
    try {
      fd = fs.openSync(this.storePath, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
      const stat = fs.fstatSync(fd);
      if (!stat.isFile() || stat.size > MAX_STORE) fail('CORRUPT_STORE', 'File recovery store is not a bounded regular file.');
      const raw = fs.readFileSync(fd);
      const wrapper = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw));
      if (!validateDocuments(wrapper)) fail('CORRUPT_STORE', 'File recovery store has an invalid or unsupported schema.');
      return { documents: wrapper.documents, fingerprint: hash(raw) };
    } catch (error) {
      if (error.code === 'ENOENT') return { documents: [], fingerprint: null };
      if (['EACCES', 'EPERM'].includes(error.code)) throw error;
      fail('CORRUPT_STORE', 'File recovery store could not be read safely; the original is preserved.');
    } finally { if (fd !== undefined) fs.closeSync(fd); }
  }
  checkStore() {
    if (this.readStore().fingerprint !== this.storeFingerprint) fail('CONFLICT', 'File recovery state changed outside this session. Restart to recover it.');
  }
  persist(documents) {
    this.checkStore();
    const serialized = JSON.stringify({ version: 1, documents });
    if (documents.length > 1000 || Buffer.byteLength(serialized) > MAX_STORE) fail('INVALID_FILE', 'File recovery store exceeds its size limit.');
    fs.mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    atomicWrite(this.storePath, serialized, 0o600, () => this.checkStore());
    this.documents = documents; this.storeFingerprint = hash(serialized);
  }
  get(id) {
    if (typeof id !== 'string') fail('UNKNOWN_FILE', 'No file grant exists for this ID.');
    const doc = this.documents.find(item => item.id === id);
    if (!doc) fail('UNKNOWN_FILE', 'No file grant exists for this ID.');
    return doc;
  }
  update(doc) { this.persist(this.documents.map(item => item.id === doc.id ? doc : item)); return { ...doc }; }
  list() {
    return this.documents.map(doc => {
      const result = { ...doc };
      try { if (readDisk(doc.path).fingerprint !== doc.fingerprint) result.warning = 'File changed on disk. Reload or save a copy.'; }
      catch (error) { result.warning = error.code === 'MISSING_FILE' ? 'File is missing. Your recovery draft is retained.' : 'File cannot be read. Your recovery draft is retained.'; }
      return result;
    });
  }
  open(chosenPath) {
    if (typeof chosenPath !== 'string' || !path.isAbsolute(chosenPath) || chosenPath.includes('\0')) fail('INVALID_FILE', 'An absolute native file path is required.');
    let file;
    try { file = fs.realpathSync(chosenPath); } catch (error) { if (error.code === 'ENOENT') fail('MISSING_FILE', 'File is missing.'); throw error; }
    const existing = this.documents.find(doc => doc.path === file);
    if (existing) return { ...existing };
    const disk = readDisk(file);
    const doc = { id: randomUUID(), path: file, name: path.basename(file), body: disk.body, savedBody: disk.body, fingerprint: disk.fingerprint };
    this.persist([...this.documents, doc]); return { ...doc };
  }
  edit(id, body) {
    const doc = this.get(id);
    if (!text(body)) fail('INVALID_FILE', 'Draft must be UTF-8 text no larger than 2 MiB.');
    return this.update({ ...doc, body });
  }
  save(id) {
    const doc = this.get(id); this.checkStore();
    const disk = readDisk(doc.path);
    if (disk.fingerprint !== doc.fingerprint) fail('CONFLICT', 'File changed on disk. Reload or save a copy.');
    atomicWrite(doc.path, doc.body, disk.mode, () => {
      this.checkStore(); const current = readDisk(doc.path);
      if (current.fingerprint !== doc.fingerprint || current.dev !== disk.dev || current.ino !== disk.ino) fail('CONFLICT', 'File changed during save. Your draft is retained.');
    });
    return this.update({ ...doc, savedBody: doc.body, fingerprint: hash(doc.body) });
  }
  saveAs(id, chosenPath) {
    const doc = this.get(id); this.checkStore();
    if (typeof chosenPath !== 'string' || !path.isAbsolute(chosenPath) || chosenPath.includes('\0')) fail('INVALID_FILE', 'An absolute native save path is required.');
    const target = path.join(fs.realpathSync(path.dirname(chosenPath)), path.basename(chosenPath));
    if (target === doc.path) return this.save(id);
    if (this.documents.some(item => item.path === target)) fail('CONFLICT', 'Target is already open. Choose another path.');
    let existing = null;
    try { existing = readDisk(target); } catch (error) { if (error.code !== 'MISSING_FILE') throw error; }
    // The main process owns the save dialog and its explicit overwrite confirmation.
    atomicWrite(target, doc.body, existing?.mode ?? 0o600, () => {
      this.checkStore();
      if (existing) {
        const now = readDisk(target);
        if (now.fingerprint !== existing.fingerprint || now.ino !== existing.ino || now.dev !== existing.dev) fail('CONFLICT', 'Save destination changed. Choose it again.');
      } else {
        try { fs.lstatSync(target); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
        fail('CONFLICT', 'Save destination appeared during save. Choose it again.');
      }
    });
    return this.update({ ...doc, path: target, name: path.basename(target), savedBody: doc.body, fingerprint: hash(doc.body) });
  }
  reload(id) {
    const doc = this.get(id); const disk = readDisk(doc.path);
    return this.update({ ...doc, body: disk.body, savedBody: disk.body, fingerprint: disk.fingerprint });
  }
  close(id) { this.get(id); this.persist(this.documents.filter(doc => doc.id !== id)); }
}
module.exports = { FileService };
