const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'../../..');
function sources(directory){return fs.readdirSync(directory,{withFileTypes:true}).flatMap(entry=>entry.isDirectory()?sources(path.join(directory,entry.name)):/\.(tsx?|css)$/.test(entry.name)?[path.join(directory,entry.name)]:[])}
test('modules access native capabilities through the shared host contract',()=>{
 for(const name of ['hq','notes','tasks','chat','code'])for(const file of sources(path.join(root,'modules',name))){
  const source=fs.readFileSync(file,'utf8');assert.doesNotMatch(source,/window\.zq|apps\/desktop|require\(['"](?:electron|node:)/,file);
 }
});
test('desktop shell does not statically link feature implementations',()=>{
 for(const file of sources(path.join(root,'apps/desktop/src'))){
  const source=fs.readFileSync(file,'utf8');assert.doesNotMatch(source,/from\s+['"][^'"]*(?:modules\/|@zq\/module-(?:chat|notes|tasks|hq|code))/,file);
 }
 for(const name of ['hq','notes','tasks','chat','code'])assert.ok(fs.existsSync(path.join(root,'modules',name,'index.tsx')));
});
