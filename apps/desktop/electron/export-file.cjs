'use strict';
const fs = require('node:fs');
const path = require('node:path');
const {randomUUID} = require('node:crypto');

function destinationStat(file) {
 try {
  const stat = fs.lstatSync(file);
  if (!stat.isFile()) throw Error('Choose a regular file as the export destination.');
  return stat;
 } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
function sameFile(before, after) {
 return before === null ? after === null : after !== null && ['dev','ino','size','mtimeMs','ctimeMs','mode'].every(key => before[key] === after[key]);
}

// The native save dialog owns destination selection and overwrite confirmation.
function exportFile(selectedPath, data) {
 if (typeof selectedPath !== 'string' || !path.isAbsolute(selectedPath) || selectedPath.includes('\0')) throw Error('An absolute export destination is required.');
 if (typeof data !== 'string' && !Buffer.isBuffer(data)) throw Error('Export content must be text or bytes.');
 const bytes = Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf8');
 const selected = path.join(fs.realpathSync(path.dirname(selectedPath)), path.basename(selectedPath));
 let linked = false;
 try { linked = fs.lstatSync(selected).isSymbolicLink(); } catch (error) { if (error.code !== 'ENOENT') throw error; }
 // Existing exports followed a selected symlink. Keep the link, atomically
 // replace its resolved regular target, and reject dangling links.
 const destination = linked ? fs.realpathSync(selected) : selected;
 const before = destinationStat(destination);
 const directory = path.dirname(destination);
 const temporary = path.join(directory, `.zq-export-${randomUUID()}.tmp`);
 let fd, directoryFd, failure, committed = false;
 try {
  directoryFd = fs.openSync(directory, fs.constants.O_RDONLY);
  fd = fs.openSync(temporary, 'wx', 0o600);
  for (let offset = 0; offset < bytes.length;) {
   const count = fs.writeSync(fd, bytes, offset, bytes.length - offset, null);
   if (!count) throw Error('Could not complete the export write.');
   offset += count;
  }
  fs.fchmodSync(fd, before ? before.mode & 0o777 : 0o600);
  fs.fsyncSync(fd);
  fs.closeSync(fd); fd = undefined;
  let unchanged = false;
  try { unchanged = (!linked || fs.lstatSync(selected).isSymbolicLink() && fs.realpathSync(selected) === destination) && sameFile(before, destinationStat(destination)); } catch { /* Treat replacement by a nonregular path as a conflict. */ }
  if (!unchanged) throw Object.assign(Error('The export destination changed while saving. Choose the destination again.'), {code:'EXPORT_CONFLICT'});
  fs.renameSync(temporary, destination); committed = true;
  fs.fsyncSync(directoryFd);
 } catch (error) { failure = error; }
 finally {
  for (const handle of [fd, directoryFd]) if (handle !== undefined) {
   try { fs.closeSync(handle); } catch (error) { failure ??= error; }
  }
  try { fs.unlinkSync(temporary); } catch (error) { if (error.code !== 'ENOENT') failure ??= error; }
 }
 if (failure && committed) throw Object.assign(Error('The file was saved, but final disk flush or cleanup failed. Its durability could not be confirmed.', {cause:failure}), {code:'EXPORT_COMMITTED'});
 if (failure) throw failure;
}
module.exports = {exportFile};
