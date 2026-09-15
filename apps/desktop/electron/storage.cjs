'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const limits = require('@zq/module-api/workspace-limits.json');
const MAX_STORE = limits.storeBytes;
function fail(code, message) { throw Object.assign(new Error(message), { code }); }
function object(value) { return value !== null && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype; }
function text(value, max = limits.titleBytes) { return typeof value === 'string' && Buffer.byteLength(value, 'utf8') <= max && !value.includes('\0') && Buffer.from(value).toString('utf8') === value; }
function keys(value, allowed) { return object(value) && Object.keys(value).every(key => allowed.includes(key)); }
function validState(state) {
  if (!keys(state, ['notes', 'tasks', 'theme', 'palette', 'layout']) || !['light', 'dark', 'system'].includes(state.theme) || !['green', 'blue', 'red', 'gunmetal'].includes(state.palette)) return false;
  for (const kind of ['notes', 'tasks']) {
    if (!Array.isArray(state[kind]) || state[kind].length > limits.records) return false;
    const ids = new Set();
    for (const record of state[kind]) {
      if(!object(record))return false;
      if(record.artifacts!==undefined&&(!Array.isArray(record.artifacts)||record.artifacts.length>50||!record.artifacts.every(a=>a&&typeof a==='object'&&Object.keys(a).every(k=>['artifactId','versionId','name'].includes(k))&&/^[a-f0-9-]{36}$/.test(a.artifactId)&&/^[a-f0-9-]{36}$/.test(a.versionId)&&text(a.name,256))))return false;
      const allowed = kind === 'notes' ? ['id', 'title', 'body', 'project', 'updated', 'openedAt', 'pinned', 'artifacts'] : ['id', 'title', 'description', 'project', 'status', 'priority', 'noteId', 'artifacts'];
      if (!keys(record, allowed) || !text(record.id, 256) || !record.id || ids.has(record.id) || !text(record.title) || !text(record.project)) return false;
      ids.add(record.id);
      if (kind === 'notes') {
        if (record.openedAt !== undefined && !(typeof record.openedAt === 'number' && Number.isFinite(record.openedAt) && record.openedAt >= 0)) return false;
        if (!text(record.body, limits.bodyBytes) || typeof record.pinned !== 'boolean' || !(text(record.updated, 256) || typeof record.updated === 'number' && Number.isFinite(record.updated))) return false;
      } else if (!text(record.description, limits.bodyBytes) || !['Inbox', 'Next', 'Doing', 'Waiting', 'Done'].includes(record.status) || !['Normal', 'High'].includes(record.priority) || record.noteId !== undefined && !text(record.noteId, 256)) return false;
    }
  }
  if (state.layout !== undefined) {
    const layout = state.layout;
    if (!keys(layout, ['view', 'selectedNote', 'tabs', 'sidebar', 'split', 'quickCapture', 'activeFileId', 'tabOrder'])) return false;
    for (const [key, value] of Object.entries(layout)) {
      if (['sidebar', 'split'].includes(key)) { if (typeof value !== 'boolean') return false; }
      else if (key === 'tabOrder') { if (!Array.isArray(value) || value.length > limits.tabs || new Set(value).size !== value.length || !value.every(id => text(id, 261) && /^(note|file):.+$/.test(id))) return false; }
      else if (key === 'tabs') { if (!Array.isArray(value) || value.length > limits.tabs || !value.every(id => text(id, 256))) return false; }
      else if (key === 'quickCapture') { if (!text(value, limits.bodyBytes)) return false; }
      else if (!(value === null && ['selectedNote', 'activeFileId'].includes(key)) && !text(value, 256)) return false;
    }
  }
  return true;
}

class WorkspaceStore {
  constructor(directory) { this.directory = path.resolve(directory); this.path = path.join(this.directory, 'workspace.json'); }
  load() {
    let fd;
    try {
      fd = fs.openSync(this.path, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
      const stat = fs.fstatSync(fd);
      if (!stat.isFile() || stat.size > MAX_STORE) fail('CORRUPT_STORE', 'Workspace store is not a bounded regular file.');
      const raw = fs.readFileSync(fd);
      const decoded = new TextDecoder('utf-8', { fatal: true }).decode(raw);
      const wrapper = JSON.parse(decoded);
      if (!keys(wrapper, ['version', 'state']) || wrapper.version !== 1 || !validState(wrapper.state)) fail('CORRUPT_STORE', 'Workspace store has an invalid or unsupported schema.');
      return wrapper.state;
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      if (['EACCES', 'EPERM'].includes(error.code)) throw error;
      fail('CORRUPT_STORE', 'Workspace store could not be read safely; the original is preserved.');
    } finally { if (fd !== undefined) fs.closeSync(fd); }
  }
  save(state) {
    if (!validState(state)) fail('INVALID_STATE', 'Workspace state is invalid or exceeds its limits.');
    const serialized = JSON.stringify({ version: 1, state });
    if (Buffer.byteLength(serialized) > MAX_STORE) fail('INVALID_STATE', 'Workspace exceeds its size limit.');
    this.load(); // Never replace a corrupt store, including corruption after startup.
    fs.mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    const temp = path.join(this.directory, `.workspace-${randomUUID()}.tmp`);
    let fd;
    try {
      fd = fs.openSync(temp, 'wx', 0o600);
      fs.writeFileSync(fd, serialized); fs.fsyncSync(fd); fs.closeSync(fd); fd = undefined;
      fs.renameSync(temp, this.path);
      const directoryFd = fs.openSync(this.directory, 'r');
      try { fs.fsyncSync(directoryFd); } finally { fs.closeSync(directoryFd); }
    } finally {
      if (fd !== undefined) fs.closeSync(fd);
      try { fs.unlinkSync(temp); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
  }
}
module.exports = { WorkspaceStore };
