const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'../../..');
test('self-hosted provider fallbacks target only this machine',()=>{
 const {normalizeConnection}=require('@zq/providers');
 for(const provider of ['ollama','vllm'])for(const baseUrl of [undefined,'']){
  const url=new URL(normalizeConnection({provider,baseUrl}).baseUrl);
  assert.equal(url.hostname,'127.0.0.1');assert.equal(url.port,provider==='ollama'?'11434':'8000');
 }
});
test('production source contains no hard-coded Tailnet URLs',()=>{
 const offending=[];
 function scan(directory){for(const entry of fs.readdirSync(directory,{withFileTypes:true})){const file=path.join(directory,entry.name);if(entry.isDirectory())scan(file);else if(/\.(?:[cm]?js|tsx?|json)$/.test(entry.name)&&/https?:\/\/[^\s'"<>]*\.ts\.net\b/i.test(fs.readFileSync(file,'utf8')))offending.push(path.relative(root,file))}}
 for(const directory of ['modules','packages','apps/desktop/src','apps/desktop/electron'])scan(path.join(root,directory));
 assert.deepEqual(offending,[],'Private network endpoints must be entered by the user, never shipped as constants');
});
