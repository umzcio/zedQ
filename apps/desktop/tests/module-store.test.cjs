const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { ModuleStore, downloadPackage } = require('../electron/module-store.cjs');

const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
function signed(manifest, code = 'export default {}', extra = {}) {
  const body = { format: 1, manifest, code, css: '', keyId: 'release', ...extra };
  return { ...body, signature: crypto.sign(null, Buffer.from(JSON.stringify(body)), privateKey).toString('base64') };
}
const bundles = ['HQ', 'Notes', 'Tasks', 'Chat'].map(view => signed({
  id: `zq.${view.toLowerCase()}`, version: '1.0.0', apiVersion: 1, title: view,
  view, icon: view.toLowerCase(), capabilities: [`${view.toLowerCase()}:read`],
}));
function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'zq-modules-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const options = { directory, bundles, trustedKeys: { release: publicKey.export({ type: 'spki', format: 'pem' }) }, apiVersion: 1 };
  return { directory, options, boot: () => new ModuleStore(options) };
}
function update(version, changes = {}) { return signed({ ...bundles[3].manifest, version, ...changes }, `export default '${version}'`); }
function chat(store) { return store.list().find(row => row.id === 'zq.chat'); }

test('provider Chat module requires the native provider capability in the target shell', t => {
  const {directory,options}=fixture(t);
  const manifest=JSON.parse(fs.readFileSync(path.join(__dirname,'../../../modules/chat/manifest.json'),'utf8'));
  assert.ok(manifest.capabilities.includes('providers.v1'));
  const oldChat=signed({...manifest,version:'1.0.0',capabilities:manifest.capabilities.filter(value=>value!=='providers.v1')});
  const oldShell=new ModuleStore({...options,directory,bundles:[...bundles.slice(0,3),oldChat]});
  assert.throws(()=>oldShell.install(signed(manifest)),/capabilities/);
  assert.equal(chat(oldShell).pendingVersion,null);
});

test('installFile stages a verified local package and rejects tampering without replacing it', t => {
  const { boot, directory } = fixture(t);
  const store = boot(), file = path.join(directory, 'update.zqmodule');
  fs.writeFileSync(file, JSON.stringify(update('1.1.0')));
  assert.equal(store.installFile(file).pendingVersion, '1.1.0');
  assert.equal(chat(store).version, '1.0.0');
  fs.writeFileSync(file, JSON.stringify({ ...update('1.2.0'), code: 'tampered' }));
  assert.throws(() => store.installFile(file), /signature/i);
  assert.equal(chat(store).pendingVersion, '1.1.0');
});

test('installFile rejects oversized files, symlinks, directories and non-path input', t => {
  const { boot, directory } = fixture(t);
  const store = boot(), file = path.join(directory, 'update.zqmodule');
  fs.writeFileSync(file, JSON.stringify(update('1.1.0')));
  const link = path.join(directory, 'link.zqmodule'); fs.symlinkSync(file, link);
  assert.throws(() => store.installFile(link));
  assert.throws(() => store.installFile(directory), /invalid/i);
  assert.throws(() => store.installFile(0), /path/i);
  fs.truncateSync(file, 16 * 1024 * 1024 + 1);
  assert.throws(() => store.installFile(file), /oversized/i);
  assert.equal(chat(store).pendingVersion, null);
});

test('installFile bounds reads when a file grows after its initial size check', t => {
  const { boot, directory } = fixture(t);
  const store = boot(), file = path.join(directory, 'update.zqmodule');
  fs.writeFileSync(file, JSON.stringify(update('1.1.0')));
  const fstat = fs.fstatSync, read = fs.readSync;
  let bytesRead = 0;
  fs.fstatSync = fd => {
    const stat = fstat(fd);
    fs.truncateSync(file, 32 * 1024 * 1024);
    return stat;
  };
  fs.readSync = (...args) => { const count = read(...args); bytesRead += count; return count; };
  try { assert.throws(() => store.installFile(file), /oversized/i); }
  finally { fs.fstatSync = fstat; fs.readSync = read; }
  assert.equal(bytesRead, 16 * 1024 * 1024 + 1);
  assert.equal(chat(store).pendingVersion, null);
});

test('installFile rejects a FIFO without waiting for a writer', { skip: process.platform === 'win32' }, t => {
  const { directory, options } = fixture(t);
  const fifo = path.join(directory, 'update.pipe');
  execFileSync('mkfifo', [fifo]);
  const script = `const {ModuleStore} = require(process.argv[1]); const store = new ModuleStore(JSON.parse(process.argv[2]));
    try { store.installFile(process.argv[3]); process.exit(2); } catch(error) { if (!/invalid/i.test(error.message)) throw error; process.stdout.write('rejected'); }`;
  const output = execFileSync(process.execPath, ['-e', script, require.resolve('../electron/module-store.cjs'), JSON.stringify(options), fifo], { timeout: 2000, encoding: 'utf8' });
  assert.equal(output, 'rejected');
});

test('stages independently and activates only on a new store launch', t => {
  const { boot } = fixture(t);
  const first = boot();
  assert.equal(first.getRuntime().length, 4);
  assert.equal(first.install(update('1.1.0')).pendingVersion, '1.1.0');
  assert.equal(chat(first).version, '1.0.0');
  assert.equal(first.getRuntime()[3].code, 'export default {}');
  const second = boot();
  assert.deepEqual(chat(second), { id: 'zq.chat', title: 'Chat', version: '1.1.0', bundledVersion: '1.0.0', pendingVersion: null, previousVersion: '1.0.0', source: 'installed' });
  assert.equal(second.getRuntime()[3].code, "export default '1.1.0'");
  assert.equal(second.list()[1].source, 'bundled');
  const runtime = second.getRuntime(); runtime[3].manifest.version = '99.0.0';
  assert.equal(chat(second).version, '1.1.0');
});

test('rejects signature, identity, API, capability and exact-schema violations without changing staged data', t => {
  const store = fixture(t).boot();
  store.install(update('1.1.0'));
  const invalid = [
    { ...update('1.2.0'), code: 'tampered' }, { ...update('1.2.0'), signature: 'bad' },
    signed({ ...bundles[3].manifest, version: '1.2.0' }, 'code', { keyId: 'unknown' }),
    update('1.2.0', { apiVersion: 2 }), update('1.2.0', { id: '../chat' }),
    update('1.2.0', { view: 'Notes' }), update('1.2.0', { icon: 'unknown' }),
    update('1.2.0', { capabilities: ['chat:read', 'native:write'] }),
    update('1.2.0', { capabilities: ['chat:read', 'chat:read'] }),
    update('01.2.0'), update('1.2'), update('1.2.0', { extra: true }),
    { ...update('1.2.0'), extra: true }, { ...update('1.2.0'), css: undefined },
    signed({ ...bundles[3].manifest, version: '1.2.0' }, 'x'.repeat(16 * 1024 * 1024)),
  ];
  for (const artifact of invalid) assert.throws(() => store.install(artifact));
  assert.equal(chat(store).pendingVersion, '1.1.0');
  assert.equal(chat(store).version, '1.0.0');
});

test('compares semantic versions against both running and staged versions', t => {
  const store = fixture(t).boot();
  store.install(update('1.2.0-beta.2'));
  assert.throws(() => store.install(update('1.2.0-beta.1')), /newer/i);
  store.install(update('1.2.0-beta.10'));
  store.install(update('1.2.0'));
  assert.throws(() => store.install(update('1.2.0+build.2')), /newer/i);
  store.install(update('1.10.0'));
  assert.throws(() => store.install(update('1.9.0')), /newer/i);
});

test('rollback stages the prior verified version and preserves currently running code', t => {
  const { boot } = fixture(t);
  boot().install(update('1.1.0'));
  const first = boot(); first.install(update('1.2.0'));
  const second = boot();
  assert.equal(chat(second).previousVersion, '1.1.0');
  assert.equal(second.rollback('zq.chat').pendingVersion, '1.1.0');
  assert.equal(chat(second).version, '1.2.0');
  assert.equal(chat(boot()).version, '1.1.0');
  assert.throws(() => second.rollback('../chat'));
});

test('rollback to bundled works after the first update', t => {
  const { boot } = fixture(t); boot().install(update('1.1.0'));
  const current = boot();
  assert.equal(current.rollback('zq.chat').pendingVersion, '1.0.0');
  assert.equal(chat(boot()).source, 'bundled');
});

test('renderer failure immediately recovers previous, then bundled, and ignores stale failure reports', t => {
  const { boot } = fixture(t); boot().install(update('1.1.0'));
  boot().install(update('1.2.0'));
  const store = boot();
  const fallback = store.recover('zq.chat', '1.2.0');
  assert.equal(fallback.manifest.version, '1.1.0');
  assert.match(fallback.error, /1\.2\.0/);
  assert.equal(store.recover('zq.chat', '1.2.0').manifest.version, '1.1.0');
  assert.equal(store.recover('zq.chat', '1.1.0').manifest.version, '1.0.0');
  assert.equal(chat(boot()).version, '1.0.0');
});

test('corrupt pending artifact keeps running verified version and reports the failure', t => {
  const { boot, directory } = fixture(t); boot().install(update('1.1.0'));
  boot().install(update('1.2.0'));
  const artifacts = fs.readdirSync(path.join(directory, 'artifacts'));
  for (const file of artifacts) {
    const full = path.join(directory, 'artifacts', file);
    if (JSON.parse(fs.readFileSync(full, 'utf8')).manifest.version === '1.2.0') fs.writeFileSync(full, '{broken');
  }
  const store = boot();
  assert.equal(chat(store).version, '1.1.0');
  assert.match(chat(store).error, /corrupt|invalid|failed/i);
});

test('missing active artifact recovers previous and malformed records fall back to bundled', t => {
  const { boot, directory } = fixture(t); boot().install(update('1.1.0'));
  boot().install(update('1.2.0')); boot();
  for (const file of fs.readdirSync(path.join(directory, 'artifacts'))) {
    const full = path.join(directory, 'artifacts', file);
    if (JSON.parse(fs.readFileSync(full, 'utf8')).manifest.version === '1.2.0') fs.unlinkSync(full);
  }
  assert.equal(chat(boot()).version, '1.1.0');
  fs.writeFileSync(path.join(directory, 'zq.chat.json'), '{broken');
  const fallback = boot();
  assert.equal(chat(fallback).source, 'bundled');
  assert.match(chat(fallback).error, /corrupt|invalid|failed/i);
});

test('missing active and previous packages still leave bundled startup and renderer recovery available', t => {
  const { boot, directory } = fixture(t);
  boot().install(update('1.1.0')); boot().install(update('1.2.0'));
  const running = boot();
  for (const file of fs.readdirSync(path.join(directory, 'artifacts'))) fs.unlinkSync(path.join(directory, 'artifacts', file));
  const restarted = boot();
  assert.equal(chat(restarted).source, 'bundled');
  assert.match(chat(restarted).error, /failed/i);
  const recovered = running.recover('zq.chat', '1.2.0');
  assert.equal(recovered.source, 'bundled');
  assert.equal(recovered.manifest.version, '1.0.0');
  assert.match(recovered.error, /1\.2\.0/);
});

test('orphaned interrupted write files never activate and files use private permissions', t => {
  const { boot, directory } = fixture(t);
  const store = boot(); store.install(update('1.1.0'));
  fs.writeFileSync(path.join(directory, 'zq.chat.json.tmp-interrupted'), JSON.stringify({ pending: '../escape' }));
  assert.equal(chat(boot()).version, '1.1.0');
  assert.equal(fs.statSync(path.join(directory, 'zq.chat.json')).mode & 0o777, 0o600);
});

test('failed atomic record publication leaves the old pending version and running code intact', t => {
  const { boot, directory } = fixture(t);
  const store = boot(); store.install(update('1.1.0'));
  const rename = fs.renameSync;
  fs.renameSync = (from, to) => {
    if (to === path.join(directory, 'zq.chat.json')) throw new Error('Injected interrupted publication');
    return rename(from, to);
  };
  try { assert.throws(() => store.install(update('1.2.0')), /interrupted/); }
  finally { fs.renameSync = rename; }
  assert.equal(chat(store).version, '1.0.0');
  assert.equal(chat(store).pendingVersion, '1.1.0');
  assert.equal(chat(boot()).version, '1.1.0');
});

test('invalid path references and symlinked artifacts cannot escape private storage', t => {
  const { boot, directory } = fixture(t);
  boot().install(update('1.1.0'));
  const recordPath = path.join(directory, 'zq.chat.json');
  const state = JSON.parse(fs.readFileSync(recordPath, 'utf8'));
  const artifactPath = path.join(directory, 'artifacts', `${state.pending}.json`);
  const outside = path.join(directory, 'outside.json');
  fs.renameSync(artifactPath, outside); fs.symlinkSync(outside, artifactPath);
  const fallback = boot();
  assert.equal(chat(fallback).source, 'bundled');
  assert.match(chat(fallback).error, /failed/i);
  fs.writeFileSync(recordPath, JSON.stringify({ format: 1, active: '../outside', previous: null }));
  assert.equal(chat(boot()).source, 'bundled');
  assert.deepEqual(JSON.parse(fs.readFileSync(outside, 'utf8')), update('1.1.0'));
});

test('requires the complete verified bundled identity set', t => {
  const { options } = fixture(t);
  assert.throws(() => new ModuleStore({ ...options, bundles: bundles.slice(1) }));
  assert.throws(() => new ModuleStore({ ...options, bundles: [...bundles.slice(0, 3), { ...bundles[3], code: 'tampered' }] }));
  assert.throws(() => new ModuleStore({ ...options, apiVersion: 2 }));
});

test('downloads JSON through bounded HTTPS redirects', async () => {
  const artifact = update('1.1.0');
  const received = await downloadPackage('https://modules.example/chat', { fetch: async url =>
    url.pathname === '/chat'
      ? new Response(null, { status: 302, headers: { location: '/release' } })
      : new Response(JSON.stringify(artifact)),
  });
  assert.deepEqual(received, artifact);
});

test('rejects insecure URLs, insecure redirects, redirect loops and HTTP errors', async () => {
  await assert.rejects(() => downloadPackage('http://modules.example/chat'), /HTTPS/i);
  await assert.rejects(() => downloadPackage('file:///tmp/chat'), /HTTPS/i);
  await assert.rejects(() => downloadPackage('https://user:password@modules.example/chat'), /credentials/i);
  await assert.rejects(() => downloadPackage('https://modules.example/chat', { fetch: async () => new Response(null, { status: 302, headers: { location: 'http://modules.example/chat' } }) }), /HTTPS/i);
  await assert.rejects(() => downloadPackage('https://modules.example/chat', { fetch: async () => new Response(null, { status: 302, headers: { location: '/chat' } }) }), /redirect/i);
  await assert.rejects(() => downloadPackage('https://modules.example/chat', { fetch: async () => new Response('no', { status: 404 }) }), /404/);
});

test('rejects both advertised and streamed oversized downloads plus invalid JSON', async () => {
  await assert.rejects(() => downloadPackage('https://modules.example/chat', { fetch: async () => new Response('', { headers: { 'content-length': String(16 * 1024 * 1024 + 1) } }) }), /16 MiB/i);
  await assert.rejects(() => downloadPackage('https://modules.example/chat', { fetch: async () => new Response(new ReadableStream({ start(controller) {
    controller.enqueue(new Uint8Array(16 * 1024 * 1024)); controller.enqueue(new Uint8Array(1)); controller.close();
  } })) }), /16 MiB/i);
  await assert.rejects(() => downloadPackage('https://modules.example/chat', { fetch: async () => new Response('{broken') }), /JSON/i);
});

test('times out the complete download including a stalled body', async () => {
  await assert.rejects(() => downloadPackage('https://modules.example/chat', { timeoutMs: 10, fetch: async () => new Response(new ReadableStream({ start() {} })) }), /timed out/i);
});


test('Code is a signed fifth module and cannot be installed into a shell without its native capability', t => {
  const {options}=fixture(t);
  const code=signed({id:'zq.code',version:'1.0.0',apiVersion:1,title:'Code',view:'Code',icon:'code',capabilities:['code.v1']});
  const old=new ModuleStore(options);
  assert.throws(()=>old.install(code), /identity|capabilities/);
  const store=new ModuleStore({...options,bundles:[...bundles,code]});
  assert.equal(store.list().find(row=>row.id==='zq.code').version,'1.0.0');
  const next=signed({...code.manifest,version:'1.0.1'});
  assert.equal(store.install(next).pendingVersion,'1.0.1');
  assert.throws(()=>new ModuleStore({...options,bundles:[...bundles.slice(0,3),code]}),/required/);
});
