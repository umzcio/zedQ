const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const http = require('node:http');
const os = require('node:os');
let runtime;
try { runtime = require('../electron/runtime.cjs'); } catch (error) {
  if (error.code !== 'MODULE_NOT_FOUND') throw error;
}

// A PTY boundary double keeps these tests runnable with Node after the native
// addon has been rebuilt for Electron. runtime-check.cjs exercises the real PTY.
function fixture(t) {
  let receive, exit, spawned;
  const writes = [];
  let killed = false;
  const terminal = {
    pid: 321, write: (data) => writes.push(data),
    kill: () => { killed = true; exit?.({ exitCode: 0 }); },
    onData: (callback) => { receive = callback; return { dispose() {} }; },
    onExit: (callback) => { exit = callback; return { dispose() {} }; },
  };
  assert.ok(runtime?.TerminalSessions, 'TerminalSessions is implemented');
  const sessions = new runtime.TerminalSessions({ spawn: (...args) => { spawned = args; return terminal; } });
  t.after(() => sessions.closeAll());
  return { sessions, emit: (data) => receive(data), exit: () => exit({ exitCode: 0 }), writes,
    get killed() { return killed; }, get spawned() { return spawned; } };
}

test('detaching preserves terminal output and permits input on the same session', (t) => {
  const f = fixture(t);
  const session = f.sessions.start();
  assert.equal(session.pid, 321);
  const live = [];
  const first = f.sessions.attach(session.id, (data) => live.push(data));
  f.emit('before\r\n'); first.dispose(); f.emit('while detached\r\n');
  assert.deepEqual(live, ['before\r\n']);
  const second = f.sessions.attach(session.id, (data) => live.push(data));
  assert.equal(second.output, 'before\r\nwhile detached\r\n');
  f.sessions.write(session.id, 'pwd\r');
  assert.deepEqual(f.writes, ['pwd\r']);
  assert.equal(f.killed, false);
  f.emit('after\r\n'); assert.equal(live.at(-1), 'after\r\n');
  second.dispose();
});

test('GUI shell starts in the home directory with common executable paths', (t) => {
  const f = fixture(t); f.sessions.start();
  const [shell, args, options] = f.spawned;
  assert.equal(shell, '/bin/zsh'); assert.deepEqual(args, ['-l']);
  assert.equal(options.cwd, os.homedir()); assert.equal(options.name, 'xterm-256color');
  for (const directory of ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin']) {
    assert.ok(options.env.PATH.split(':').includes(directory));
  }
});

test('detached output remains bounded and retains the newest text', (t) => {
  const f = fixture(t); const { id } = f.sessions.start();
  f.emit('oldest\n');
  for (let i = 0; i < 32; i++) f.emit('x'.repeat(64 * 1024));
  f.emit('\nnewest 你好');
  const attachment = f.sessions.attach(id, () => {});
  assert.ok(attachment.output.length <= 256 * 1024);
  assert.ok(attachment.output.endsWith('\nnewest 你好'));
  assert.ok(!attachment.output.includes('oldest'));
});

test('stop kills the PTY and revokes the session; unknown sessions reject operations', (t) => {
  const f = fixture(t); const { id } = f.sessions.start();
  f.sessions.stop(id); assert.equal(f.killed, true);
  for (const action of [() => f.sessions.attach(id, () => {}), () => f.sessions.write(id, 'hi'), () => f.sessions.stop(id)]) {
    assert.throws(action, { code: 'UNKNOWN_TERMINAL' });
  }
  f.sessions.closeAll();
});

test('natural process exit revokes input and releases its session', (t) => {
  const f = fixture(t); const { id } = f.sessions.start(); f.exit();
  assert.throws(() => f.sessions.write(id, 'hi'), { code: 'UNKNOWN_TERMINAL' });
});

test('invalid input and a failing listener cannot break other attachments', (t) => {
  const f = fixture(t); const { id } = f.sessions.start();
  assert.throws(() => f.sessions.attach(id, null), TypeError);
  assert.throws(() => f.sessions.write(id, {}), TypeError);
  f.sessions.attach(id, () => { throw new Error('closed renderer'); });
  let received;
  f.sessions.attach(id, (data) => { received = data; });
  assert.doesNotThrow(() => f.emit('still live'));
  assert.equal(received, 'still live');
});

function mockResponse(t, { body, status = 200, error }) {
  t.mock.method(http, 'request', (url, options, callback) => {
    assert.equal(String(url), 'http://127.0.0.1:11434/api/tags');
    assert.equal(options.method, 'GET');
    const request = new EventEmitter();
    request.destroy = () => {};
    request.end = () => queueMicrotask(() => {
      if (error) { request.emit('error', Object.assign(new Error('private details'), { code: error })); return; }
      const response = new EventEmitter(); response.statusCode = status;
      response.destroy = () => {}; callback(response);
      response.emit('data', Buffer.from(body)); response.emit('end');
    });
    return request;
  });
}

test('Ollama probe lists installed names from only the fixed loopback endpoint', async (t) => {
  assert.ok(runtime?.probeOllama, 'probeOllama is implemented');
  mockResponse(t, { body: JSON.stringify({ models: [{ name: 'tiny:latest' }, { name: 'tiny:latest' }, { name: 'local:small' }] }) });
  assert.deepEqual(await runtime.probeOllama(), { available: true, models: ['tiny:latest', 'local:small'] });
});

test('Ollama running without installed models is distinct from an unavailable service', async (t) => {
  mockResponse(t, { body: '{"models":[]}' });
  assert.deepEqual(await runtime.probeOllama(), { available: true, models: [] });
});

test('Ollama applies a total deadline even when a connection never produces a response', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  t.mock.method(http, 'request', () => {
    const request = new EventEmitter(); request.end = () => {}; request.destroy = () => {};
    return request;
  });
  const pending = runtime.probeOllama();
  t.mock.timers.tick(2501);
  const result = await pending;
  assert.equal(result.available, false); assert.deepEqual(result.models, []);
  assert.match(result.error, /timed out/);
});

for (const [name, response] of [
  ['connection refusal', { error: 'ECONNREFUSED' }],
  ['redirects', { status: 302, body: '' }],
  ['malformed JSON', { body: 'nope' }],
  ['invalid schema', { body: '{"models":{}}' }],
  ['oversized responses', { body: ' '.repeat(1024 * 1024 + 1) }],
]) test(`Ollama probe reports ${name} as unavailable without exposing response content`, async (t) => {
  assert.ok(runtime?.probeOllama, 'probeOllama is implemented');
  mockResponse(t, response); const result = await runtime.probeOllama();
  assert.equal(result.available, false); assert.deepEqual(result.models, []);
  assert.equal(typeof result.error, 'string'); assert.ok(!result.error.includes('private details'));
});

test('Ollama probe uses the explicitly selected remote endpoint without falling back', async (t) => {
 let target;
 t.mock.method(http, 'request', (url, options, callback) => {
  target=String(url);
  const request=new EventEmitter(); request.destroy=()=>{};
  request.end=()=>queueMicrotask(()=>{const response=new EventEmitter();response.statusCode=200;response.destroy=()=>{};callback(response);response.emit('data',Buffer.from('{"models":[{"name":"remote-model"}]}'));response.emit('end')});
  return request;
 });
 const result=await runtime.probeOllama('http://model-server.example:11434/');
 assert.equal(target,'http://model-server.example:11434/api/tags');
 assert.deepEqual(result,{available:true,models:['remote-model']});
});
test('Ollama rejects non-HTTP endpoints and embedded credentials before connecting', async t=>{
 t.mock.method(http,'request',()=>{throw new Error('must not connect')});
 for(const endpoint of ['file:///tmp/model','http://user:password@localhost:11434/']){
  const result=await runtime.probeOllama(endpoint);
  assert.equal(result.available,false);assert.match(result.error,/endpoint/);
 }
});
