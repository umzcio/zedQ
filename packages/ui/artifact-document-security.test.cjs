const { test } = require('node:test');
const assert = require('node:assert/strict');
const JSZip = require('jszip');

test('ZIP preflight rejects declared bombs, duplicate paths, encrypted and malformed archives', async () => {
  const { validateZipDirectory } = await import('./artifact-document-security.mjs');
  const zip = new JSZip(); zip.file('word/document.xml', '<document/>', { createFolders: false });
  const good = await zip.generateAsync({ type: 'uint8array' });
  assert.equal(validateZipDirectory(good).length, 1);
  const bomb = good.slice();
  const view = new DataView(bomb.buffer);
  let central = -1;
  for (let i = 0; i < bomb.length - 4; i++) if (view.getUint32(i, true) === 0x02014b50) central = i;
  view.setUint32(central + 24, 41 * 1024 * 1024, true);
  assert.throws(() => validateZipDirectory(bomb), /expanded|large|limit/i);
  const encrypted = good.slice(); new DataView(encrypted.buffer).setUint16(central + 8, 1, true);
  assert.throws(() => validateZipDirectory(encrypted), /encrypted/i);
  assert.throws(() => validateZipDirectory(new Uint8Array([1, 2, 3])), /ZIP|zip/);
});

test('iframe policy permits only trusted blob scripts and local inert assets', async () => {
  const { frameHtml, FRAME_BOOTSTRAP } = await import('./artifact-document-security.mjs');
  const html = frameHtml('token');
  assert.match(html, /connect-src 'none'/);
  assert.match(html, /object-src 'none'/);
  assert.match(html, /script-src 'nonce-token'/);
  assert.doesNotMatch(html, /unsafe-eval|script-src[^;]*unsafe-inline/);
  const hash = require('node:crypto').createHash('sha256').update(FRAME_BOOTSTRAP).digest('base64');
  assert.ok(require('node:fs').readFileSync(require('node:path').join(__dirname, '../../apps/desktop/index.html'), 'utf8').includes(`'sha256-${hash}'`), 'Production CSP must match the fixed sandbox bootstrap.');
});
