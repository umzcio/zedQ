'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const MAX_PACKAGE_BYTES = 16 * 1024 * 1024;
const VIEWS = { 'zq.hq': 'HQ', 'zq.notes': 'Notes', 'zq.tasks': 'Tasks', 'zq.chat': 'Chat' };
const HASH = /^[a-f0-9]{64}$/;
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;
const clone = value => JSON.parse(JSON.stringify(value));
const hash = text => crypto.createHash('sha256').update(text).digest('hex');
const has = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

function exact(object, keys) {
  if (!object || typeof object !== 'object' || Array.isArray(object) || Object.keys(object).length !== keys.length || keys.some(key => !has(object, key))) throw new Error('Invalid module schema');
}
function version(value) {
  if (typeof value !== 'string' || value.length > 128 || !SEMVER.test(value)) throw new Error('Invalid semantic module version');
  return SEMVER.exec(value);
}
function compare(a, b) {
  const aa = version(a), bb = version(b);
  for (let index = 1; index <= 3; index++) {
    const diff = BigInt(aa[index]) - BigInt(bb[index]);
    if (diff) return diff > 0n ? 1 : -1;
  }
  if (aa[4] === bb[4]) return 0;
  if (!aa[4]) return 1;
  if (!bb[4]) return -1;
  const ap = aa[4].split('.'), bp = bb[4].split('.');
  for (let index = 0; index < Math.max(ap.length, bp.length); index++) {
    if (ap[index] === undefined) return -1;
    if (bp[index] === undefined) return 1;
    if (ap[index] === bp[index]) continue;
    const an = /^\d+$/.test(ap[index]), bn = /^\d+$/.test(bp[index]);
    if (an && bn) return BigInt(ap[index]) > BigInt(bp[index]) ? 1 : -1;
    if (an !== bn) return an ? -1 : 1;
    return ap[index] > bp[index] ? 1 : -1;
  }
  return 0;
}

function readFile(file, maximum) {
  if (typeof file !== 'string' || !file) throw new Error('Invalid module file path');
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.size > maximum) throw new Error('Invalid or oversized module file');
    const chunk = Buffer.allocUnsafe(Math.min(64 * 1024, maximum + 1));
    const chunks = [];
    let size = 0;
    // A file may grow after fstat. Read only one byte beyond the limit to detect it.
    while (size <= maximum) {
      const count = fs.readSync(fd, chunk, 0, Math.min(chunk.length, maximum + 1 - size), size);
      if (!count) break;
      size += count;
      if (size > maximum) throw new Error('Oversized module file');
      chunks.push(Buffer.from(chunk.subarray(0, count)));
    }
    return Buffer.concat(chunks, size).toString('utf8');
  } finally { fs.closeSync(fd); }
}

// Rename publishes an entire durable file, so a crash never exposes partial JSON.
function atomicWrite(file, text) {
  const temporary = `${file}.tmp-${crypto.randomUUID()}`;
  let fd;
  try {
    fd = fs.openSync(temporary, 'wx', 0o600);
    fs.writeFileSync(fd, text, 'utf8');
    fs.fsyncSync(fd);
    fs.closeSync(fd); fd = undefined;
    fs.renameSync(temporary, file);
    const directoryFd = fs.openSync(path.dirname(file), 'r');
    try { fs.fsyncSync(directoryFd); } finally { fs.closeSync(directoryFd); }
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
    try { fs.unlinkSync(temporary); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
}

class ModuleStore {
  constructor({ directory, bundles, trustedKeys, apiVersion = 1 }) {
    if (apiVersion !== 1) throw new Error('Unsupported module API version');
    if (typeof directory !== 'string' || !directory) throw new Error('Module directory is required');
    this.directory = path.resolve(directory);
    this.keys = new Map(Object.entries(trustedKeys || {}).map(([id, pem]) => {
      const key = crypto.createPublicKey(pem);
      if (key.asymmetricKeyType !== 'ed25519') throw new Error('Module keys must be Ed25519');
      return [id, key];
    }));
    this.bundles = new Map();
    this.entries = new Map();
    if (!Array.isArray(bundles) || bundles.length !== 4) throw new Error('All four bundled modules are required');
    for (const input of bundles) {
      const artifact = this.verify(input, false);
      if (this.bundles.has(artifact.manifest.id)) throw new Error('Duplicate bundled module');
      this.bundles.set(artifact.manifest.id, artifact);
    }
    for (const folder of [this.directory, path.join(this.directory, 'artifacts')]) {
      fs.mkdirSync(folder, { recursive: true, mode: 0o700 });
      if (!fs.lstatSync(folder).isDirectory()) throw new Error('Module storage must be a real directory');
    }
    for (const id of this.bundles.keys()) this.start(id);
  }

  verify(input, restrict = true) {
    const serialized = JSON.stringify(input);
    if (!serialized || Buffer.byteLength(serialized) > MAX_PACKAGE_BYTES) throw new Error('Module package exceeds 16 MiB');
    const artifact = JSON.parse(serialized);
    exact(artifact, ['format', 'manifest', 'code', 'css', 'keyId', 'signature']);
    const { format, manifest, code, css, keyId, signature } = artifact;
    exact(manifest, ['id', 'version', 'apiVersion', 'title', 'view', 'icon', 'capabilities']);
    if (format !== 1 || manifest.apiVersion !== 1) throw new Error('Incompatible module format or API version');
    if (!has(VIEWS, manifest.id) || VIEWS[manifest.id] !== manifest.view) throw new Error('Invalid module identity or view');
    version(manifest.version);
    if (typeof manifest.title !== 'string' || !manifest.title.trim() || manifest.title.length > 80 || typeof manifest.icon !== 'string' || !manifest.icon || manifest.icon.length > 80) throw new Error('Invalid module title or icon');
    if (!Array.isArray(manifest.capabilities) || manifest.capabilities.length > 64 || manifest.capabilities.some(value => typeof value !== 'string' || !value || value.length > 128) || new Set(manifest.capabilities).size !== manifest.capabilities.length) throw new Error('Invalid module capabilities');
    if (typeof code !== 'string' || !code.trim() || typeof css !== 'string' || typeof keyId !== 'string' || !this.keys.has(keyId)) throw new Error('Invalid module payload or untrusted signing key');
    if (typeof signature !== 'string' || !/^[A-Za-z0-9+/]{86}==$/.test(signature)) throw new Error('Invalid module signature');
    const payload = JSON.stringify({ format, manifest, code, css, keyId });
    if (!crypto.verify(null, Buffer.from(payload), this.keys.get(keyId), Buffer.from(signature, 'base64'))) throw new Error('Invalid module signature');
    if (restrict) {
      const builtin = this.bundles.get(manifest.id)?.manifest;
      if (!builtin || manifest.icon !== builtin.icon || manifest.title !== builtin.title || manifest.capabilities.some(value => !builtin.capabilities.includes(value))) throw new Error('Module identity or capabilities exceed bundled permissions');
    }
    return artifact;
  }

  recordPath(id) { return path.join(this.directory, `${id}.json`); }
  save(id, state) { atomicWrite(this.recordPath(id), JSON.stringify(state)); }
  artifact(id, ref) {
    if (ref === null) return this.bundles.get(id);
    if (typeof ref !== 'string' || !HASH.test(ref)) throw new Error('Invalid module artifact reference');
    const text = readFile(path.join(this.directory, 'artifacts', `${ref}.json`), MAX_PACKAGE_BYTES);
    if (hash(text) !== ref) throw new Error('Corrupt module artifact hash');
    const artifact = this.verify(JSON.parse(text));
    if (artifact.manifest.id !== id) throw new Error('Invalid stored module identity');
    return artifact;
  }

  start(id) {
    let state = { format: 1, active: null, previous: null };
    let error;
    try {
      const saved = JSON.parse(readFile(this.recordPath(id), 4096));
      exact(saved, has(saved, 'pending') ? ['format', 'active', 'previous', 'pending'] : ['format', 'active', 'previous']);
      if (saved.format !== 1 || ['active', 'previous', ...(has(saved, 'pending') ? ['pending'] : [])].some(key => saved[key] !== null && (typeof saved[key] !== 'string' || !HASH.test(saved[key])))) throw new Error('Invalid module state');
      state = saved;
    } catch (failure) {
      if (failure.code !== 'ENOENT') error = `Invalid module state; using bundled ${id}: ${failure.message}`;
    }
    const oldActive = state.active;
    let artifact, ref;
    const candidates = has(state, 'pending') ? [state.pending, state.active, state.previous, null] : [state.active, state.previous, null];
    for (const candidate of [...new Set(candidates)]) {
      try { artifact = this.artifact(id, candidate); ref = candidate; break; }
      catch (failure) { error = `Failed to load ${id}; recovered a verified fallback: ${failure.message}`; }
    }
    // Retain the old active package only when it is verified and distinct.
    let previous = state.previous;
    if (ref !== oldActive) {
      try { this.artifact(id, oldActive); previous = oldActive; }
      catch { previous = null; }
    }
    if (previous === ref) previous = null;
    try { this.artifact(id, previous); } catch { previous = null; }
    const next = { format: 1, active: ref, previous };
    if (JSON.stringify(next) !== JSON.stringify(state)) {
      try { this.save(id, next); } catch (failure) { error = `Module recovery could not be saved: ${failure.message}`; }
    }
    this.entries.set(id, { state: next, artifact, ref, error, failed: new Set() });
  }

  entry(id) {
    if (typeof id !== 'string' || !this.entries.has(id)) throw new Error('Unknown module identity');
    return this.entries.get(id);
  }
  runtime(entry) {
    return clone({ manifest: entry.artifact.manifest, code: entry.artifact.code, css: entry.artifact.css, source: entry.ref === null ? 'bundled' : 'installed', ...(entry.error ? { error: entry.error } : {}) });
  }
  getRuntime() { return [...this.entries.values()].map(entry => this.runtime(entry)); }
  row(id) {
    const entry = this.entry(id), bundled = this.bundles.get(id);
    const getVersion = ref => { try { return this.artifact(id, ref).manifest.version; } catch { return null; } };
    return {
      id, title: entry.artifact.manifest.title, version: entry.artifact.manifest.version,
      bundledVersion: bundled.manifest.version,
      pendingVersion: has(entry.state, 'pending') ? getVersion(entry.state.pending) : null,
      previousVersion: entry.state.previous === null && entry.ref === null ? null : getVersion(entry.state.previous),
      source: entry.ref === null ? 'bundled' : 'installed', ...(entry.error ? { error: entry.error } : {}),
    };
  }
  list() { return [...this.entries.keys()].map(id => this.row(id)); }

  installFile(file) {
    return this.install(JSON.parse(readFile(file, MAX_PACKAGE_BYTES)));
  }

  install(input) {
    const artifact = this.verify(input), { id, version: incoming } = artifact.manifest;
    const entry = this.entry(id);
    const pending = has(entry.state, 'pending') ? this.artifact(id, entry.state.pending).manifest.version : null;
    if (compare(incoming, entry.artifact.manifest.version) <= 0 || (pending && compare(incoming, pending) <= 0)) throw new Error('Module update must be newer than the running and pending versions');
    const text = JSON.stringify(artifact), ref = hash(text);
    atomicWrite(path.join(this.directory, 'artifacts', `${ref}.json`), text);
    const state = { ...entry.state, pending: ref };
    this.save(id, state);
    entry.state = state;
    return this.row(id);
  }

  rollback(id) {
    const entry = this.entry(id);
    let target = entry.state.previous;
    try { this.artifact(id, target); } catch { target = null; }
    const state = { ...entry.state, pending: target };
    this.save(id, state); entry.state = state;
    return this.row(id);
  }

  recover(id, failedVersion) {
    const entry = this.entry(id);
    if (entry.artifact.manifest.version !== failedVersion) return this.runtime(entry);
    entry.failed.add(failedVersion);
    let artifact = this.bundles.get(id), ref = null;
    for (const candidate of [entry.state.previous, null]) {
      try {
        const possible = this.artifact(id, candidate);
        if (!entry.failed.has(possible.manifest.version)) { artifact = possible; ref = candidate; break; }
      } catch { /* Continue to the bundled fallback. */ }
    }
    const state = { format: 1, active: ref, previous: null };
    entry.artifact = artifact; entry.ref = ref; entry.state = state;
    entry.error = `Module ${id} ${failedVersion} failed to start; using ${artifact.manifest.version}.`;
    try { this.save(id, state); } catch (failure) { entry.error += ` Recovery could not be saved: ${failure.message}`; }
    return this.runtime(entry);
  }
}

// A single deadline includes DNS, redirects, headers, and the entire response body.
async function downloadPackage(input, { fetch: fetcher = globalThis.fetch, timeoutMs = 15000 } = {}) {
  const controller = new AbortController();
  let reader;
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error('Module download timed out'));
      controller.abort();
      if (reader) void reader.cancel().catch(() => {});
    }, Math.max(1, Math.min(Number(timeoutMs) || 15000, 15000)));
  });
  const download = async () => {
    let url = new URL(input);
    for (let redirects = 0; redirects <= 3; redirects++) {
      if (url.protocol !== 'https:') throw new Error('Module downloads require HTTPS');
      if (url.username || url.password) throw new Error('Module download URLs must not contain credentials');
      const response = await fetcher(url, { signal: controller.signal, redirect: 'manual', credentials: 'omit', cache: 'no-store', headers: { accept: 'application/json' } });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        if (response.body) await response.body.cancel();
        const location = response.headers.get('location');
        if (!location || redirects === 3) throw new Error('Invalid or excessive module download redirects');
        url = new URL(location, url);
        continue;
      }
      if (!response.ok) {
        if (response.body) await response.body.cancel();
        throw new Error(`Module download failed: HTTP ${response.status}`);
      }
      const length = response.headers.get('content-length');
      if (length !== null && (!/^\d+$/.test(length) || Number(length) > MAX_PACKAGE_BYTES)) {
        if (response.body) await response.body.cancel();
        throw new Error('Module download exceeds 16 MiB');
      }
      if (!response.body) throw new Error('Module download has no JSON body');
      reader = response.body.getReader();
      const chunks = [];
      let size = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_PACKAGE_BYTES) throw new Error('Module download exceeds 16 MiB');
        chunks.push(Buffer.from(value));
      }
      try { return JSON.parse(Buffer.concat(chunks, size).toString('utf8')); }
      catch { throw new Error('Module download contains invalid JSON'); }
    }
  };
  try { return await Promise.race([download(), timeout]); }
  finally {
    clearTimeout(timer);
    controller.abort();
    if (reader) void reader.cancel().catch(() => {});
  }
}

module.exports = { ModuleStore, downloadPackage, MAX_PACKAGE_BYTES };
