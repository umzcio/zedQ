'use strict';
const path = require('node:path');
const yauzl = require('yauzl');
const FILE_LIMIT = 10 * 1024 * 1024;
const EXPANDED_LIMIT = 40 * 1024 * 1024;
const ENTRY_LIMIT = 2000;
const MIME_FORMATS = Object.freeze({
 'application/pdf': 'pdf',
 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
 'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
});
const OFFICE_FORMATS = new Set(['docx', 'xlsx', 'pptx']);

function documentFormat(name, mime) {
 if (typeof name !== 'string' || !name || Buffer.byteLength(name) > 256 || /[\\/\x00-\x1f\x7f]/.test(name) || typeof mime !== 'string') throw Error('Invalid document file metadata.');
 const extension = path.extname(name).slice(1).toLowerCase();
 const mimeFormat = MIME_FORMATS[mime.split(';', 1)[0].trim().toLowerCase()];
 if (mimeFormat && (OFFICE_FORMATS.has(extension) || extension === 'pdf') && mimeFormat !== extension) throw Error('Document MIME type and filename format disagree.');
 return mimeFormat || extension || 'file';
}

function validateOfficeZip(bytes) {
 return new Promise((resolve, reject) => {
  yauzl.fromBuffer(bytes, { lazyEntries: true, validateEntrySizes: true, strictFileNames: true }, (error, zip) => {
   if (error) return reject(Error('Invalid Office ZIP: ' + error.message));
   let finished = false, active, count = 0, declaredTotal = 0, actualTotal = 0;
   const names = new Set();
   function fail(error) {
    if (finished) return;
    finished = true;
    active?.destroy();
    zip.close();
    reject(error);
   }
   zip.on('error', fail);
   if (zip.entryCount > ENTRY_LIMIT) return fail(Error('Office ZIP exceeds the 2000 entry limit.'));
   zip.on('entry', entry => {
    if (finished) return;
    const filename = entry.fileName;
    const segments = filename.replace(/\/$/, '').split('/');
    if (!filename || /[\\\x00-\x1f\x7f]/.test(filename) || filename.startsWith('/') || /^[A-Za-z]:/.test(filename) || segments.some(part => !part || part === '.' || part === '..')) return fail(Error('Office ZIP contains an unsafe member path.'));
    const normalized = filename.normalize('NFC').toLowerCase();
    if (names.has(normalized)) return fail(Error('Office ZIP contains duplicate or ambiguous member names.'));
    names.add(normalized);
    if ((entry.generalPurposeBitFlag & 0x41) !== 0) return fail(Error('Encrypted Office ZIP entries are unsupported.'));
    if (((entry.externalFileAttributes >>> 16) & 0xf000) === 0xa000) return fail(Error('Office ZIP symbolic links are unsupported.'));
    if (++count > ENTRY_LIMIT || !Number.isSafeInteger(entry.uncompressedSize) || entry.uncompressedSize < 0 || (declaredTotal += entry.uncompressedSize) > EXPANDED_LIMIT) return fail(Error('Office ZIP exceeds the expanded size or entry limit.'));
    // Inspect every member, including styles, relationships, media and fonts.
    // Discard decompressed bytes immediately: this is a resource/integrity check,
    // not text extraction, sanitization, relationship resolution or rendering.
    zip.openReadStream(entry, (error, stream) => {
     if (error) return fail(error);
     if (finished) { stream.destroy(); return; }
     active = stream;
     let actual = 0;
     stream.on('error', fail);
     stream.on('data', chunk => {
      actual += chunk.length; actualTotal += chunk.length;
      if (actual > entry.uncompressedSize || actualTotal > EXPANDED_LIMIT) fail(Error('Office ZIP exceeds its declared or expanded size limit.'));
     });
     stream.on('end', () => {
      active = undefined;
      if (finished) return;
      if (actual !== entry.uncompressedSize) return fail(Error('Office ZIP member size does not match its declaration.'));
      zip.readEntry();
     });
    });
   });
   zip.on('end', () => {
    if (finished) return;
    finished = true;
    zip.close();
    resolve();
   });
   zip.readEntry();
  });
 });
}

// The renderer must use this returned format rather than independently trusting
// the filename: an Office MIME paired with "download.bin" still contains a ZIP.
async function validateDocumentFile({ name, mime, data } = {}) {
 const format = documentFormat(name, mime);
 if (typeof data !== 'string' || data.length > Math.ceil(FILE_LIMIT / 3) * 4) throw Error('Document exceeds the 10 MB file size limit.');
 const bytes = Buffer.from(data, 'base64');
 if (bytes.length > FILE_LIMIT || bytes.toString('base64') !== data) throw Error('Invalid document base64 or file size above 10 MB.');
 if (OFFICE_FORMATS.has(format)) await validateOfficeZip(bytes);
 return { format };
}
module.exports = { validateDocumentFile };
