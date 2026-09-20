'use strict';
const https = require('node:https');
const dns = require('node:dns').promises;
const ipaddr = require('ipaddr.js');
const { fault, assert } = require('./schema.cjs');
const MAX_BYTES = 1024 * 1024;
const SKIP = new Set(['script', 'style', 'noscript', 'template', 'svg', 'canvas', 'nav', 'footer', 'header']);
const BREAK = new Set(['p', 'div', 'section', 'article', 'main', 'li', 'tr', 'br', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6']);
function allowedDomains(scope) {
 assert(Array.isArray(scope) && scope.length <= 40 && scope.every(v => typeof v === 'string' && v.length <= 253 && /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/.test(v)), 'Use lower-case domain names without schemes, paths or wildcards.');
 return scope;
}
function publicAddress(address) { try { return ipaddr.process(address).range() === 'unicast'; } catch { return false; } }
function urlFor(value, domains = []) {
 allowedDomains(domains); let url;
 try { url = new URL(value); } catch { throw fault('RESEARCH_URL', 'This source has an invalid URL.'); }
 if (typeof value !== 'string' || value.length > 4096 || /[\x00-\x20\x7f]/.test(value) || url.protocol !== 'https:' || url.username || url.password || url.port) throw fault('RESEARCH_URL', 'Research reads public HTTPS pages on the standard port.');
 const hostname = url.hostname.replace(/^\[|\]$/g, '');
 if (ipaddr.isValid(hostname) && !publicAddress(hostname)) throw fault('RESEARCH_URL', 'Private and reserved network addresses cannot be research sources.');
 if (domains.length && !domains.some(d => hostname === d || hostname.endsWith('.' + d))) throw fault('RESEARCH_SCOPE', 'This page is outside the selected domains.');
 url.hash = ''; return url;
}
function wait(promise, signal) {
 signal.throwIfAborted();
 return new Promise((resolve, reject) => {
  const abort = () => reject(signal.reason); signal.addEventListener('abort', abort, { once: true });
  Promise.resolve(promise).then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
 });
}
async function htmlText(html) {
 const { Parser } = await import('htmlparser2');
 const stack = [], chunks = [], title = []; let nodes = 0, chars = 0;
 const add = value => { chars += value.length; if (chars > 300000) throw fault('RESEARCH_PAGE_LIMIT', 'This page contains too much text.'); chunks.push(value); };
 const parser = new Parser({
  onopentag(name, attributes) {
   if (++nodes > 50000 || stack.length >= 256) throw fault('RESEARCH_PAGE_LIMIT', 'This page is too complex to read.');
   const hidden = stack.at(-1)?.hidden || SKIP.has(name) || Object.hasOwn(attributes, 'hidden') || attributes['aria-hidden'] === 'true';
   stack.push({ name, hidden }); if (!hidden && BREAK.has(name)) add('\n');
  },
  ontext(text) { if (stack.some(n => n.name === 'title')) title.push(text); else if (!stack.at(-1)?.hidden) add(text); },
  onclosetag(name) { const node = stack.pop(); if (!node?.hidden) { if (BREAK.has(name)) add('\n'); else if (name === 'td' || name === 'th') add(' | '); } },
 }, { decodeEntities: true });
 parser.end(html);
 return { text: chunks.join('').replace(/[\t \f\v]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').replace(/\0/g, '').trim(), title: title.join('').replace(/\s+/g, ' ').trim().slice(0, 250) };
}
function responseFor(url, address, signal, requestImpl) {
 return new Promise((resolve, reject) => {
  let req;
  try {
   req = requestImpl(url, { agent: false, signal, family: address.family,
    lookup: (_hostname, options, callback) => options?.all ? callback(null, [address]) : callback(null, address.address, address.family),
    headers: { Accept: 'text/html, text/plain, application/json;q=0.8', 'Accept-Encoding': 'identity', 'User-Agent': 'zQ-Research/1.0' },
   }, response => { if (signal.aborted) { response.destroy(); reject(signal.reason); } else resolve(response); });
   req.on('error', reject);
  } catch (error) { reject(error); }
 });
}
async function readWebPage(value, { signal, domains = [], lookup = dns.lookup, requestImpl = https.get } = {}) {
 const combined = AbortSignal.any([signal, AbortSignal.timeout(15000)].filter(Boolean));
 let url = urlFor(value, domains); const visited = new Set();
 for (let hop = 0; hop <= 3; hop++) {
  combined.throwIfAborted(); if (visited.has(url.href)) throw fault('RESEARCH_REDIRECT', 'This source redirects in a loop.'); visited.add(url.href);
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  const addresses = ipaddr.isValid(hostname) ? [{ address: hostname, family: ipaddr.parse(hostname).kind() === 'ipv4' ? 4 : 6 }] : await wait(lookup(hostname, { all: true, verbatim: true }), combined);
  if (!Array.isArray(addresses) || !addresses.length || addresses.some(a => !publicAddress(a.address))) throw fault('RESEARCH_URL', 'Private and reserved network addresses cannot be research sources.');
  const response = await wait(responseFor(url, addresses[0], combined, requestImpl), combined);
  try {
   if (response.socket?.remoteAddress && !publicAddress(response.socket.remoteAddress)) throw fault('RESEARCH_URL', 'The source resolved to a private address.');
   if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
    if (hop === 3 || typeof response.headers.location !== 'string') throw fault('RESEARCH_REDIRECT', 'This source has too many redirects.');
    url = urlFor(new URL(response.headers.location, url).href, domains); continue;
   }
   if (response.statusCode !== 200) throw fault('RESEARCH_PAGE_UNAVAILABLE', `This source returned HTTP ${Number(response.statusCode) || 0}.`);
   const encoding = response.headers['content-encoding']; if (encoding && encoding !== 'identity') throw fault('RESEARCH_PAGE_TYPE', 'This source did not return an uncompressed page.');
   const mime = String(response.headers['content-type'] ?? '').split(';')[0].toLowerCase().trim();
   if (!mime.startsWith('text/') && !['application/xhtml+xml', 'application/json'].includes(mime)) throw fault('RESEARCH_PAGE_TYPE', 'This source is not a readable text page. Attach a PDF or document directly to include it.');
   const length = response.headers['content-length']; if (length !== undefined && (!/^\d+$/.test(String(length)) || Number(length) > MAX_BYTES)) throw fault('RESEARCH_PAGE_LIMIT', 'This page exceeds the 1 MiB download limit.');
   const chunks = []; let bytes = 0; const iterator = response[Symbol.asyncIterator]();
   while (true) { const { done, value: chunk } = await wait(iterator.next(), combined); if (done) break; bytes += chunk.length; if (bytes > MAX_BYTES) throw fault('RESEARCH_PAGE_LIMIT', 'This page exceeds the 1 MiB download limit.'); chunks.push(chunk); }
   let text; try { text = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)); } catch { throw fault('RESEARCH_PAGE_TYPE', 'This page is not readable UTF-8 text.'); }
   const parsed = mime.includes('html') ? await htmlText(text) : { text: text.replace(/\0/g, '').trim(), title: '' };
   combined.throwIfAborted(); if (!parsed.text) throw fault('RESEARCH_PAGE_EMPTY', 'This page has no readable text.');
   return { url: url.href, title: parsed.title || url.hostname, text: parsed.text, retrievedAt: Date.now() };
  } finally { response.destroy(); }
 }
}
module.exports = { readWebPage, htmlText, publicAddress, urlFor, allowedDomains };
