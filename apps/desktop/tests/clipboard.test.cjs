const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createClipboardService}=require('../electron/clipboard.cjs');
const {allowVoicePermission}=require('../electron/voice-permissions.cjs');
test('native copy preserves Unicode, newlines and Markdown while browser clipboard permission stays denied',()=>{
 let stored='previous';const service=createClipboardService({writeText:value=>{stored=value}});
 assert.equal(allowVoicePermission({permission:'clipboard-sanitized-write'}),false);
 for(const text of ['Montana — hello 👋\nSecond line','## Heading\n\n**bold** and `code`','']){assert.equal(service.writeText(text),null);assert.equal(stored,text)}
 assert.deepEqual(Object.keys(service),['writeText']);
});
test('invalid clipboard writes preserve the previous clipboard',()=>{
 let stored='previous';const service=createClipboardService({writeText:value=>{stored=value}});
 for(const text of [null,{},12,'bad\0text','\ud800','x'.repeat(4*1024*1024+1)])assert.throws(()=>service.writeText(text));
 assert.equal(stored,'previous');
});
test('native clipboard failures propagate so UI never reports a successful copy',()=>{
 const service=createClipboardService({writeText(){throw Error('Clipboard unavailable')}});
 assert.throws(()=>service.writeText('hello'),/Clipboard unavailable/);
});
test('preload exposes only a write operation and returns native acknowledgement',async()=>{
 const vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');let bridge;const calls=[];
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../electron/preload.cjs'),'utf8'),{process:{platform:'darwin'},require:()=>({contextBridge:{exposeInMainWorld:(name,value)=>{bridge=value}},ipcRenderer:{invoke:async(...args)=>{calls.push(args);return {ok:true,value:null}}}})});
 const value=await bridge.clipboard.writeText('Hello — 👋');assert.equal(value.ok,true);assert.deepEqual(calls,[['clipboard:writeText','Hello — 👋']]);assert.deepEqual(Object.keys(bridge.clipboard),['writeText']);
});
