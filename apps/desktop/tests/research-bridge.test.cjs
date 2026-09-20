'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { EventEmitter } = require('node:events');

test('research preload methods use typed native channels and subscriptions clean up without stopping jobs', async () => {
 let bridge; const calls = [], ipcRenderer = new EventEmitter();
 ipcRenderer.invoke = async (...args) => { calls.push(args); return { ok: true, value: null }; };
 const electron = { ipcRenderer, contextBridge: { exposeInMainWorld: (_name, value) => { bridge = value; } } };
 const code = fs.readFileSync(path.join(__dirname, '../electron/preload.cjs'), 'utf8');
 vm.runInNewContext(code, { require: name => { assert.equal(name, 'electron'); return electron; }, process: { platform: 'darwin' } });
 for (const method of ['availability', 'catalog', 'create', 'list', 'get', 'acceptPlan', 'stop', 'finish', 'resume', 'retryStorage']) {
  await bridge.research[method]('payload'); assert.equal(calls.at(-1)[0], `research:${method}`);
 }
 const changes = [], unsubscribe = bridge.research.subscribe(change => changes.push(change));
 ipcRenderer.emit('research:changed', {}, { job: { id: 'job' }, error: null }); assert.equal(changes.length, 1);
 const requests = calls.length; unsubscribe(); ipcRenderer.emit('research:changed', {}, { job: { id: 'job' } });
 assert.equal(changes.length, 1); assert.equal(ipcRenderer.listenerCount('research:changed'), 0); assert.equal(calls.length, requests);
});
