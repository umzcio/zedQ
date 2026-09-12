/** Check the central directory before any inflater sees untrusted Office bytes. */
export function validateZipDirectory(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length > 10 * 1024 * 1024 || bytes.length < 22) throw new Error('Invalid Office ZIP or file exceeds 10 MB.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (view.getUint32(i, true) === 0x06054b50 && i + 22 + view.getUint16(i + 20, true) === bytes.length) { end = i; break; }
  }
  if (end < 0) throw new Error('Invalid Office ZIP directory.');
  const count = view.getUint16(end + 10, true);
  const directorySize = view.getUint32(end + 12, true);
  let offset = view.getUint32(end + 16, true);
  if (view.getUint32(end + 4, true) !== 0 || view.getUint16(end + 8, true) !== count || count > 2000 || offset + directorySize !== end) throw new Error('Office ZIP exceeds entry limits or uses an unsupported multipart/ZIP64 archive.');
  const entries = []; const seen = new Set(); let total = 0;
  for (let index = 0; index < count; index++) {
    if (offset + 46 > end || view.getUint32(offset, true) !== 0x02014b50) throw new Error('Invalid Office ZIP entry.');
    const flags = view.getUint16(offset + 8, true);
    const method = view.getUint16(offset + 10, true);
    const compressed = view.getUint32(offset + 20, true);
    const size = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const length = 46 + nameLength + view.getUint16(offset + 30, true) + view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);
    if (flags & 1) throw new Error('Encrypted Office files cannot be previewed.');
    if (![0, 8].includes(method) || offset + length > end || localOffset + 30 > offset || compressed > bytes.length) throw new Error('Unsupported or invalid Office ZIP entry.');
    const name = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(offset + 46, offset + 46 + nameLength));
    if (seen.has(name) || name.includes('\\') || name.startsWith('/') || name.split('/').includes('..')) throw new Error('Office ZIP contains duplicate or unsafe entry paths.');
    seen.add(name); total += size;
    if (size > 20 * 1024 * 1024 || total > 40 * 1024 * 1024) throw new Error('Office file exceeds the 40 MB expanded preview limit.');
    if (/\.(?:xml|rels)$/i.test(name) && size > 5 * 1024 * 1024) throw new Error('Office XML exceeds the 5 MB entry limit.');
    entries.push({ name, size }); offset += length;
  }
  if (offset !== end) throw new Error('Invalid Office ZIP directory length.');
  return entries;
}

// Keep this fixed string in sync with its SHA-256 allowlist in the shell CSP.
// It only accepts trusted code from its parent; document bytes never become JS.
export const FRAME_BOOTSTRAP = `(()=>{const token=document.body.dataset.token;let started=false;addEventListener('message',async event=>{if(event.source!==parent||event.data?.zqDocument!==token||event.data.type!=='loadScripts'||started)return;started=true;try{for(const source of event.data.scripts){if(typeof source!=='string'||source.length>8000000)throw Error('Invalid viewer script');const url=URL.createObjectURL(new Blob([source],{type:'text/javascript'}));try{await new Promise((resolve,reject)=>{const script=document.createElement('script');script.nonce=token;script.src=url;script.onload=resolve;script.onerror=()=>reject(Error('Document viewer could not load'));document.head.append(script)})}finally{URL.revokeObjectURL(url)}}}catch(error){parent.postMessage({zqDocument:token,type:'error',message:error.message},'*')}});parent.postMessage({zqDocument:token,type:'loaderReady'},'*')})();`;

export function frameHtml(token) {
  if (!/^[a-zA-Z0-9-]+$/.test(token)) throw new Error('Invalid viewer frame configuration.');
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="referrer" content="no-referrer"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${token}'; style-src 'unsafe-inline'; img-src data: blob:; font-src data: blob:; connect-src 'none'; worker-src 'none'; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'"><style>
  *{box-sizing:border-box}html,body{margin:0;min-height:100%;background:transparent;color:#222;font:14px -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}body{padding:20px;overflow:auto}#document{margin:auto;min-width:0}.docx-wrapper{background:transparent!important;padding:0!important;display:flex;flex-direction:column;align-items:safe center!important;min-width:100%;gap:20px}.docx-wrapper>section.docx{margin:0!important;box-shadow:0 1px 5px #0002!important;flex:none}#status{padding:16px;text-align:center;color:#60646b}.sheet-tabs{display:flex;gap:4px;padding:8px;position:sticky;top:0;background:#f7f7f8;z-index:2;border:1px solid #d5d7da;max-width:100%;overflow:auto}.sheet-tabs button{font:inherit;padding:5px 10px;border:1px solid transparent;background:transparent;border-radius:4px;cursor:pointer;white-space:nowrap}.sheet-tabs button[aria-selected=true]{background:white;border-color:#c8ccd1}.sheet-tabs button:focus-visible{outline:2px solid #2869c9}.sheet-grid{border-collapse:collapse;table-layout:fixed;background:white;color:#222;box-shadow:0 1px 4px #0002}.sheet-grid td,.sheet-grid th{border:1px solid #e0e2e5;padding:4px 6px;overflow:hidden}.sheet-grid th{background:#f4f5f6;font:11px -apple-system,sans-serif;font-weight:400;color:#626870;text-align:center}.sheet-grid td{white-space:pre-wrap;overflow-wrap:break-word}a{cursor:text!important;text-decoration:none}#notice{margin:0 0 12px;padding:8px 10px;border-radius:4px;background:#f5f5f5;color:#60646b;font-size:12px;line-height:1.5}#notice:empty{display:none}
  </style></head><body data-token="${token}"><div id="notice" role="note"></div><div id="document"></div><div id="status" role="status">Rendering document…</div><script nonce="${token}">${FRAME_BOOTSTRAP}</script></body></html>`;
}
