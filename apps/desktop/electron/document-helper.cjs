'use strict';

// The executable is configured by the trusted desktop host, never by a document
// request. This transport has no script, path, dependency or fallback operation.
const path = require('node:path');
const { spawn } = require('node:child_process');
const yauzl = require('yauzl');
const { parseContent } = require('./artifact-renderer.cjs');
const { checkTypography } = require('./artifact-typography.cjs');
const { validateDocumentFile } = require('./artifact-document-validation.cjs');
const SOURCE_LIMIT = 100 * 1024;
const REQUEST_LIMIT = 1024 * 1024;
const OUTPUT_LIMIT = 4 * 1024 * 1024;
const STDOUT_LIMIT = 6 * 1024 * 1024;
const MIME = Object.freeze({
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
});
const OFFICE = {
  docx: { part: 'word/document.xml', root: 'document', ns: 'http://schemas.openxmlformats.org/wordprocessingml/2006/main', type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml' },
  xlsx: { part: 'xl/workbook.xml', root: 'workbook', ns: 'http://schemas.openxmlformats.org/spreadsheetml/2006/main', type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml' },
  pptx: { part: 'ppt/presentation.xml', root: 'presentation', ns: 'http://schemas.openxmlformats.org/presentationml/2006/main', type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml' },
};
function abortError() { return Object.assign(new Error('Document rendering was cancelled.'), { name: 'AbortError' }); }
function cleanText(value) { return value.toWellFormed().replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').replace(/\r\n?/g, '\n'); }
function prepare(input) {
  checkTypography(input?.typography);
  if (!input || !Object.hasOwn(MIME, input.format)) throw Error('Unsupported artifact format. Choose PDF, DOCX, XLSX, or PPTX.');
  if (typeof input.title !== 'string' || input.title.length > 160) throw Error('Artifact title must be a string of at most 160 characters.');
  if (typeof input.content !== 'string' || !input.content.trim()) throw Error('Artifact content is required.');
  if (Buffer.byteLength(input.content) > SOURCE_LIMIT) throw Error('Artifact content exceeds the 100 KB source limit.');
  const title = cleanText(input.title).replace(/\s+/g, ' ').trim() || 'Untitled artifact';
  const blocks = parseContent(cleanText(input.content));
  if (!blocks.length) throw Error('Artifact content is required.');
  const document = { format: input.format, title, blocks, typography: input.typography ?? {} };
  const request = Buffer.from(JSON.stringify({ version: 1, operation: 'render_document', document }));
  if (request.length > REQUEST_LIMIT) throw Error('Document helper request exceeds the 1 MiB limit.');
  // Match the existing host renderer's filename and inert preview conventions.
  const base = title.replace(/[<>:"/\\|?*\u202a-\u202e\u2066-\u2069]/g, '-').replace(/^[.\s]+|[.\s]+$/g, '').slice(0, 140) || 'artifact';
  const previewText = `${title}\n\n${blocks.map(block => block.type === 'table' ? block.rows.map(row => row.join('\t')).join('\n') : `${block.type === 'list' ? block.marker + ' ' : ''}${block.text}`).join('\n\n')}`.slice(0, SOURCE_LIMIT);
  return { request, format: input.format, name: `${base}.${input.format}`, previewText };
}
function exactKeys(value, keys) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}
function parseOfficeXml(xml, visit) {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw Error('Office format rejects XML entity declarations.');
  const parser = require('sax').parser(true, { xmlns: true });
  let depth = 0, root;
  parser.onopentag = node => { if (++depth > 100) throw Error('Office XML exceeds the nesting limit.'); root ??= node; visit?.(node); };
  parser.onerror = error => { throw error; };
  parser.onclosetag = () => depth--;
  parser.write(xml).close();
  if (!root || depth !== 0) throw Error('Office format contains empty or incomplete XML.');
  return root;
}
// Resource/integrity validation runs first. This second pass establishes the
// actual Office format from required package parts and XML, not its extension.
function validateOfficeFormat(bytes, format) {
  const spec = OFFICE[format];
  const wanted = new Set(['[Content_Types].xml', '_rels/.rels', spec.part]);
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(bytes, { lazyEntries: true, validateEntrySizes: true, strictFileNames: true }, (error, zip) => {
      if (error) return reject(error);
      const files = new Map(), names = new Set();
      let finished = false, stream;
      const fail = error => { if (!finished) { finished = true; stream?.destroy(); zip.close(); reject(error); } };
      zip.on('error', fail);
      zip.on('entry', entry => {
        names.add(entry.fileName);
        if (!wanted.has(entry.fileName)) return zip.readEntry();
        zip.openReadStream(entry, (error, current) => {
          if (error) return fail(error);
          if (finished) return current.destroy();
          stream = current;
          const chunks = [];
          current.on('error', fail);
          current.on('data', chunk => chunks.push(chunk));
          current.on('end', () => { if (!finished) { files.set(entry.fileName, Buffer.concat(chunks).toString('utf8')); stream = undefined; zip.readEntry(); } });
        });
      });
      zip.on('end', () => {
        if (finished) return;
        try {
          if ([...wanted].some(name => !files.has(name))) throw Error(`Office ${format} is missing a required package part.`);
          let declared = false, linked = false;
          const types = parseOfficeXml(files.get('[Content_Types].xml'), node => {
            if (node.local === 'Override' && node.attributes.PartName?.value === '/' + spec.part && node.attributes.ContentType?.value === spec.type) declared = true;
          });
          const rels = parseOfficeXml(files.get('_rels/.rels'), node => {
            if (node.local === 'Relationship' && node.attributes.Type?.value === 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument' && [spec.part, '/' + spec.part].includes(node.attributes.Target?.value) && node.attributes.TargetMode?.value !== 'External') linked = true;
          });
          const main = parseOfficeXml(files.get(spec.part));
          if (types.local !== 'Types' || types.uri !== 'http://schemas.openxmlformats.org/package/2006/content-types' || rels.local !== 'Relationships' || rels.uri !== 'http://schemas.openxmlformats.org/package/2006/relationships' || !declared || !linked || main.local !== spec.root || main.uri !== spec.ns) throw Error(`Office content does not match the requested ${format} format.`);
          if (format === 'xlsx' && ![...names].some(name => /^xl\/worksheets\/sheet\d+\.xml$/.test(name))) throw Error('Office XLSX is missing a worksheet part.');
          if (format === 'pptx' && ![...names].some(name => /^ppt\/slides\/slide\d+\.xml$/.test(name))) throw Error('Office PPTX is missing a slide part.');
          finished = true; zip.close(); resolve();
        } catch (error) { fail(error); }
      });
      zip.readEntry();
    });
  });
}
async function validateReply(raw, prepared) {
  let reply;
  try { reply = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw)); } catch { throw Error('Document helper returned malformed JSON.'); }
  if (exactKeys(reply, ['version', 'ok', 'error']) && reply.version === 1 && reply.ok === false && typeof reply.error === 'string' && reply.error.length <= 4096) throw Error('Document helper failed: ' + reply.error);
  if (exactKeys(reply, ['exitCode', 'error', 'files']) && Number.isInteger(reply.exitCode) && typeof reply.error === 'string' && reply.error.length <= 4096 && Array.isArray(reply.files) && reply.files.length === 0) throw Error('Document helper failed: ' + reply.error);
  if (!exactKeys(reply, ['version', 'ok', 'file', 'warnings']) || reply.version !== 1 || reply.ok !== true || !Array.isArray(reply.warnings) || reply.warnings.length > 100 || reply.warnings.some(w => typeof w !== 'string' || w.length > 4096) || !exactKeys(reply.file, ['name', 'mime', 'data'])) throw Error('Document helper returned an invalid response schema.');
  const file = reply.file;
  if (typeof file.name !== 'string' || !file.name || Buffer.byteLength(file.name) > 256 || /[<>:"/\\|?*\x00-\x1f\x7f\u202a-\u202e\u2066-\u2069]/.test(file.name) || file.name.startsWith('.') || file.name !== file.name.trim() || path.extname(file.name) !== '.' + prepared.format || file.mime !== MIME[prepared.format]) throw Error('Document helper filename or MIME does not match the requested format.');
  if (typeof file.data !== 'string' || !file.data.length || file.data.length > Math.ceil(OUTPUT_LIMIT / 3) * 4) throw Error('Document helper output exceeds the 4 MiB limit or is empty.');
  const bytes = Buffer.from(file.data, 'base64');
  if (!bytes.length || bytes.length > OUTPUT_LIMIT || bytes.toString('base64') !== file.data) throw Error('Document helper output has invalid base64 or exceeds the 4 MiB limit.');
  await validateDocumentFile(file);
  if (prepared.format === 'pdf') {
    if (!/^%PDF-(?:1\.[0-7]|2\.0)[\r\n]/.test(bytes.subarray(0, 16).toString('ascii')) || !/%%EOF\s*$/.test(bytes.subarray(-1024).toString('ascii'))) throw Error('Document helper returned an invalid PDF signature or trailer.');
  } else await validateOfficeFormat(bytes, prepared.format);
  return { name: prepared.name, mime: file.mime, data: file.data, previewText: prepared.previewText };
}
function execute(helperPath, spawnImpl, prepared, signal, timeoutMs, killGraceMs) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError());
    let child, failure, timer, killTimer, closed = false;
    const chunks = []; let size = 0;
    const stop = error => {
      if (failure || closed) return;
      failure = error;
      child.stdin.destroy();
      child.kill('SIGTERM');
      killTimer = setTimeout(() => { if (!closed) child.kill('SIGKILL'); }, killGraceMs);
    };
    const onAbort = () => stop(abortError());
    try { child = spawnImpl(helperPath, [], { shell: false, stdio: ['pipe', 'pipe', 'pipe'] }); } catch (error) { reject(error); return; }
    signal?.addEventListener('abort', onAbort, { once: true });
    timer = setTimeout(() => stop(Error('Document helper timed out.')), timeoutMs);
    child.on('error', error => { failure ??= error.code === 'ENOENT' ? Error('The document helper is unavailable. Rebuild or reinstall zQ to create documents.', { cause: error }) : error; });
    child.stdin.on('error', error => stop(Error('Document helper request could not be written: ' + error.message)));
    child.stdout.on('error', error => stop(error));
    child.stderr.on('error', error => stop(error));
    // Drain diagnostics without retaining or interpreting potentially huge output.
    child.stderr.on('data', () => {});
    child.stdout.on('data', chunk => {
      if (failure) return;
      size += chunk.length;
      if (size > STDOUT_LIMIT) stop(Error('Document helper stdout exceeds the 6 MiB limit.'));
      else chunks.push(chunk);
    });
    child.on('close', async (code, exitSignal) => {
      closed = true; clearTimeout(timer); clearTimeout(killTimer);
      signal?.removeEventListener('abort', onAbort);
      if (signal?.aborted) return reject(abortError());
      if (failure) return reject(failure);
      if (code !== 0) return reject(Error(`Document helper exited with ${exitSignal ? 'signal ' + exitSignal : 'exit code ' + code}.`));
      try { const result = await validateReply(Buffer.concat(chunks, size), prepared); if (signal?.aborted) throw abortError(); resolve(result); } catch (error) { reject(error); }
    });
    if (signal?.aborted) onAbort();
    else child.stdin.end(prepared.request);
  });
}
function createDocumentRenderer({ helperPath, spawnImpl = spawn, timeoutMs = 30_000, killGraceMs = 1000 } = {}) {
  if (typeof helperPath !== 'string' || !path.isAbsolute(helperPath)) throw Error('Document helper requires a trusted absolute executable path.');
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000 || !Number.isInteger(killGraceMs) || killGraceMs < 1 || killGraceMs > 1000) throw Error('Invalid document helper timing limits.');
  let active = false;
  const queue = [];
  function pump() {
    if (active || !queue.length) return;
    const job = queue.shift();
    active = true;
    job.signal?.removeEventListener('abort', job.cancel);
    execute(helperPath, spawnImpl, job.prepared, job.signal, timeoutMs, killGraceMs).then(job.resolve, job.reject).finally(() => { active = false; pump(); });
  }
  return async (input, { signal } = {}) => {
    if (signal?.aborted) throw abortError();
    if (queue.length >= 8) throw Error('Document helper queue is full. Wait for a document to finish.');
    const prepared = prepare(input);
    return new Promise((resolve, reject) => {
      const job = { prepared, signal, resolve, reject, cancel: () => { const index = queue.indexOf(job); if (index >= 0) { queue.splice(index, 1); reject(abortError()); } } };
      queue.push(job);
      signal?.addEventListener('abort', job.cancel, { once: true });
      if (signal?.aborted) job.cancel();
      pump();
    });
  };
}
module.exports = { createDocumentRenderer };
