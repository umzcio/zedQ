'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('node:stream');
const { EventEmitter } = require('node:events');
const { readWebPage, htmlText, publicAddress, urlFor } = require('../electron/research/web-reader.cjs');
const publicLookup = async () => [{ address: '93.184.216.34', family: 4 }];
function fixture(pages) {
 const calls = [], responses = [];
 const requestImpl = (url, options, callback) => {
  calls.push({ url: url.href, options }); const page = pages.shift(); assert.ok(page, 'Unexpected request');
  const response = Readable.from(page.chunks ?? [Buffer.from(page.text ?? '')]);
  response.statusCode = page.status ?? 200; response.headers = { 'content-type': 'text/html; charset=utf-8', ...page.headers }; response.socket = { remoteAddress: page.address ?? '93.184.216.34' }; responses.push(response);
  const req = new EventEmitter(); queueMicrotask(() => callback(response)); return req;
 };
 return { requestImpl, lookup: publicLookup, calls, responses };
}
test('web reader extracts readable text and tables, excluding active/hidden/navigation content', async () => {
 const html = '<html><head><title>Study &amp; results</title><script>STEAL</script><style>hidden</style></head><body><nav>MENU</nav><main><h1>Results</h1><p>A &lt; B</p><table><tr><td>A</td><td>12</td></tr></table><span hidden>SECRET</span><div aria-hidden="true">IGNORE</div></main><footer>FOOTER</footer></body></html>';
 const f = fixture([{ text: html }]); const result = await readWebPage('https://example.org/paper#section', f);
 assert.equal(result.title, 'Study & results'); assert.match(result.text, /A < B/); assert.match(result.text, /A \| 12/); assert.doesNotMatch(result.text, /STEAL|SECRET|IGNORE|MENU|FOOTER|Study/);
 assert.equal(result.url, 'https://example.org/paper'); assert.ok(f.responses[0].destroyed);
 assert.equal(f.calls[0].options.agent, false); assert.equal(f.calls[0].options.headers.Authorization, undefined); assert.equal(f.calls[0].options.headers.Cookie, undefined);
 f.calls[0].options.lookup('example.org', {}, (error, address, family) => { assert.equal(error, null); assert.equal(address, '93.184.216.34'); assert.equal(family, 4); });
});
test('private, mapped, reserved, credentials, nonstandard ports and domain escapes fail before I/O', async () => {
 for (const address of ['127.0.0.1', '10.0.0.1', '169.254.169.254', '192.168.0.1', '::1', '::ffff:127.0.0.1', 'fc00::1', '0.0.0.0', '100.64.0.1']) assert.equal(publicAddress(address), false, address);
 for (const url of ['http://example.org', 'https://127.1', 'https://2130706433', 'https://[::ffff:127.0.0.1]', 'https://user:pass@example.org', 'https://example.org:8443', 'file:///tmp/private']) assert.throws(() => urlFor(url));
 assert.throws(() => urlFor('https://example.org.attacker.com', ['example.org']), /outside/);
 assert.equal(urlFor('https://sub.example.org', ['example.org']).hostname, 'sub.example.org');
 let requests = 0;
 for (const addresses of [[{ address: '10.0.0.2', family: 4 }], [{ address: '93.184.216.34', family: 4 }, { address: '::1', family: 6 }]]) await assert.rejects(readWebPage('https://example.org', { lookup: async () => addresses, requestImpl: () => { requests++; } }), /Private/);
 assert.equal(requests, 0);
});
test('redirects revalidate DNS, domain scope and protocol at every hop', async () => {
 for (const location of ['http://example.org/a', 'https://127.0.0.1/a', 'https://other.org/a']) {
  const f = fixture([{ status: 302, headers: { location } }]);
  await assert.rejects(readWebPage('https://example.org', { ...f, domains: ['example.org'] })); assert.equal(f.calls.length, 1); assert.ok(f.responses[0].destroyed);
 }
 const f = fixture([{ status: 302, headers: { location: '/next' } }]); let lookups = 0;
 await assert.rejects(readWebPage('https://example.org', { ...f, lookup: async () => ++lookups === 1 ? publicLookup() : [{ address: '127.0.0.1', family: 4 }] }), /Private/); assert.equal(f.calls.length, 1);
 const good = fixture([{ status: 302, headers: { location: '/next' } }, { text: '<p>Read me</p>' }]); assert.equal((await readWebPage('https://example.org', good)).text, 'Read me');
});
test('binary/encoded/oversized/invalid UTF-8 pages and private connected peers are rejected', async () => {
 for (const page of [{ headers: { 'content-type': 'application/pdf' } }, { headers: { 'content-encoding': 'gzip' } }, { headers: { 'content-length': '1048577' } }, { chunks: [Buffer.alloc(1048577)] }, { chunks: [Buffer.from([0xc0, 0xff])] }, { address: '127.0.0.1' }]) {
  const f = fixture([page]); await assert.rejects(readWebPage('https://example.org', f)); assert.ok(f.responses[0].destroyed);
 }
 await assert.rejects(htmlText('<div>'.repeat(300)), /complex/);
});
test('aborting stalled DNS or a stalled body settles promptly and closes the body', async () => {
 const dnsAbort = new AbortController(); const pending = readWebPage('https://example.org', { signal: dnsAbort.signal, lookup: () => new Promise(() => {}) }); dnsAbort.abort(); await assert.rejects(pending);
 const controller = new AbortController(); let response;
 const task = readWebPage('https://example.org', { signal: controller.signal, lookup: publicLookup, requestImpl: (_, options, callback) => {
  response = new Readable({ read() {} }); response.statusCode = 200; response.headers = { 'content-type': 'text/plain' }; callback(response); setImmediate(() => controller.abort()); return new EventEmitter();
 } });
 await assert.rejects(task); assert.ok(response.destroyed);
});
test('a noncooperative late response is destroyed after cancellation', async () => {
 const controller = new AbortController(); let deliver;
 const task = readWebPage('https://example.org', { signal: controller.signal, lookup: publicLookup, requestImpl: (_, options, callback) => { deliver = callback; return new EventEmitter(); } });
 while (!deliver) await new Promise(resolve => setImmediate(resolve));
 controller.abort(); await assert.rejects(task);
 const response = Readable.from([Buffer.from('late response')]); deliver(response); assert.ok(response.destroyed);
});
