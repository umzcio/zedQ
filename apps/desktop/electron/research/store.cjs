'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const schema = require('./schema.cjs');
const MAX_JOBS = 200, MAX_TOTAL_BYTES = 128 * 1024 * 1024;

/** One atomic checkpoint per job. Evidence never expands chat.json or progress IPC. */
class ResearchStore {
 constructor(directory) { this.directory = path.resolve(directory); }
 file(id) { schema.uuid(id); return path.join(this.directory, `${id}.json`); }
 entries() {
  try {
   const stat = fs.lstatSync(this.directory);
   if (!stat.isDirectory() || stat.isSymbolicLink()) throw Error('Invalid research directory.');
   const names = fs.readdirSync(this.directory).filter(name => name.endsWith('.json'));
   schema.assert(names.length <= MAX_JOBS, 'Research storage has too many jobs.');
   let total = 0;
   const entries = names.map(name => {
    const id = name.slice(0, -5), file = this.file(id), stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > schema.MAX_JOB_BYTES + 128) throw Error('Invalid checkpoint.');
    total += stat.size; return { id, size: stat.size };
   });
   if (total > MAX_TOTAL_BYTES) throw Error('Research storage is full.');
   return entries;
  } catch (error) { if (error.code === 'ENOENT') return []; throw schema.fault('RESEARCH_STORAGE', 'Research storage could not be read safely; the original files are preserved.'); }
 }
 load(id) {
  const file = this.file(id); let fd;
  try {
   const directoryStat = fs.lstatSync(this.directory);
   if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) throw Error('Invalid research directory.');
   fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
   const stat = fs.fstatSync(fd);
   if (!stat.isFile() || stat.size > schema.MAX_JOB_BYTES + 128) throw Error('Invalid checkpoint.');
   const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(fs.readFileSync(fd)));
   if (value.version !== 1 || Object.keys(value).some(key => !['version', 'job'].includes(key))) throw Error('Invalid checkpoint.');
   schema.job(value.job); if (value.job.id !== id) throw Error('Wrong checkpoint.');
   return value.job;
  } catch (error) { if (error.code === 'ENOENT') return null; throw schema.fault('RESEARCH_STORAGE', 'Research checkpoint could not be read safely; the original file is preserved.'); }
  finally { if (fd !== undefined) fs.closeSync(fd); }
 }
 loadAll() { return this.entries().map(({ id }) => this.load(id)); }
 save(job, expectedRevision) {
  schema.job(job); const current = this.load(job.id);
  if ((current?.revision ?? 0) !== expectedRevision || job.revision !== expectedRevision + 1) throw schema.fault('RESEARCH_CONFLICT', 'Research changed elsewhere. Reload it before trying again.');
  const body = JSON.stringify({ version: 1, job }), entries = this.entries();
  schema.assert(current || entries.length < MAX_JOBS, 'Research storage has reached its job limit.');
  schema.assert(entries.filter(e => e.id !== job.id).reduce((sum, e) => sum + e.size, 0) + Buffer.byteLength(body) <= MAX_TOTAL_BYTES, 'Research storage is full.');
  fs.mkdirSync(this.directory, { recursive: true, mode: 0o700 });
  const temp = path.join(this.directory, `.checkpoint-${randomUUID()}.tmp`); let fd, committed = false;
  try {
   fd = fs.openSync(temp, 'wx', 0o600); fs.writeFileSync(fd, body); fs.fsyncSync(fd); fs.closeSync(fd); fd = undefined;
   fs.renameSync(temp, this.file(job.id)); committed = true;
   const directoryFd = fs.openSync(this.directory, 'r'); try { fs.fsyncSync(directoryFd); } finally { fs.closeSync(directoryFd); }
  } catch (error) {
   throw Object.assign(schema.fault('RESEARCH_STORAGE', committed ? 'Research was saved, but the final disk flush failed. Keep zQ open and retry.' : 'Research could not be saved. Keep zQ open and check available storage.'), { committed, cause: error });
  } finally { if (fd !== undefined) fs.closeSync(fd); try { fs.unlinkSync(temp); } catch (error) { if (error.code !== 'ENOENT') { /* Preserve an orphaned temporary file; never erase a committed checkpoint. */ } } }
 }
}
module.exports = { ResearchStore };
