const test = require('node:test');
const assert = require('node:assert/strict');
const {spawn, spawnSync} = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const enabled = process.platform === 'darwin' && process.env.ZQ_TEST_DOCUMENT_HELPER === '1';
const app = path.resolve(__dirname, '../native/bin/DocumentHelper.app');
const client = path.join(app, 'Contents/MacOS/DocumentHelperLauncher');
const request = format => ({version:1,operation:'render_document',document:{format,title:'Native contract',blocks:[{type:'heading',level:1,text:'Native contract'},{type:'paragraph',text:'Created on this Mac.'}],typography:{}}});
function execute(input, executable=client) {
 const result=spawnSync(executable,[],{input:typeof input==='string'?input:JSON.stringify(input),encoding:'utf8',timeout:35000,maxBuffer:6*1024*1024});
 assert.equal(result.error,undefined,String(result.error)); assert.equal(result.status,0,result.stderr);
 return JSON.parse(result.stdout);
}
test('native endpoint rejects generic code, unknown operations and oversized requests', {skip:!enabled},()=>{
 for(const input of [{code:'print(1)',files:[]},{...request('docx'),operation:'run_python'},{...request('docx'),extra:true},{...request('docx'),version:true},'x'.repeat(1024*1024+1)]) {
  const result=execute(input); assert.notEqual(result.ok,true); assert.ok(result.error); assert.equal(result.file,undefined);
 }
});
test('signed XPC renderer creates all four real document formats', {skip:!enabled},()=>{
 for(const format of ['docx','xlsx','pptx','pdf']) {
  const result=execute(request(format)); assert.equal(result.ok,true,JSON.stringify(result));
  const bytes=Buffer.from(result.file.data,'base64'); assert.ok(bytes.length>100);
  assert.equal(bytes.subarray(0,format==='pdf'?5:2).toString(),format==='pdf'?'%PDF-':'PK');
 }
});
test('embedded service and inherited executables have only the intended sandbox entitlements', {skip:!enabled},()=>{
 const service=path.join(app,'Contents/XPCServices/DocumentHelperService.xpc');
 for(const [file,inherit] of [[service,false],[path.join(service,'Contents/MacOS/DocumentHelperWorker'),true],[path.join(service,'Contents/MacOS/DocumentHelperSupervisor'),true],[path.join(service,'Contents/Resources/python/bin/python3.12'),true]]) {
  const signed=spawnSync('/usr/bin/codesign',['--verify','--strict',file],{encoding:'utf8'}); assert.equal(signed.status,0,signed.stderr);
  const result=spawnSync('/usr/bin/codesign',['-d','--entitlements',':-',file],{encoding:'utf8'});
  const parsed=spawnSync('/usr/bin/plutil',['-convert','json','-o','-','-'],{input:result.stdout,encoding:'utf8'});
  assert.equal(parsed.status,0,parsed.stderr); assert.deepEqual(JSON.parse(parsed.stdout),{'com.apple.security.app-sandbox':true,...(inherit?{'com.apple.security.inherit':true}:{})});
 }
});
test('XPC refuses a caller signed with a different identity', {skip:!enabled,timeout:15000},()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'zq-document-identity-'));
 try {
  const copy=path.join(directory,'DocumentHelper.app');fs.cpSync(app,copy,{recursive:true});
  const caller=path.join(copy,'Contents/MacOS/DocumentHelperCaller');
  for(const args of [['--force','--sign','-','--identifier','dev.zq.UntrustedCaller',caller],['--force','--sign','-',copy]]) {
   const signed=spawnSync('/usr/bin/codesign',args,{encoding:'utf8'});assert.equal(signed.status,0,signed.stderr);
  }
  const result=spawnSync(path.join(copy,'Contents/MacOS/DocumentHelperLauncher'),[],{input:JSON.stringify(request('docx')),encoding:'utf8',timeout:10000});
  assert.equal(result.error,undefined,String(result.error));assert.notEqual(result.status,0);assert.equal(result.stdout,'');
 } finally {fs.rmSync(directory,{recursive:true,force:true});}
});
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(fn,ms=5000) {const end=performance.now()+ms;do{const value=fn();if(value)return value;await delay(10);}while(performance.now()<end);return null;}
const alive=pid=>{try{process.kill(pid,0);return true;}catch(e){if(e.code==='ESRCH')return false;throw e;}};
test('a queued document succeeds immediately after cancelling the active native render',{skip:!enabled,timeout:15000},async()=>{
 const {createDocumentRenderer}=require('../electron/document-helper.cjs');
 const render=createDocumentRenderer({helperPath:client});const controller=new AbortController();
 const first=render({format:'docx',title:'Cancelled',content:'| A | B |\n| --- | --- |\n'+Array.from({length:1800},()=> '| test | row |').join('\n')},{signal:controller.signal});
 const stopped=assert.rejects(first,{name:'AbortError'});
 const second=render({format:'docx',title:'Next document',content:'This queued document must complete.'});
 // Observe the real worker before cancellation, so native admission is held.
 const started=await until(()=>spawnSync('/bin/ps',['-axo','command='],{encoding:'utf8'}).stdout.split('\n').some(line=>line.startsWith(path.join(app,'Contents/XPCServices/DocumentHelperService.xpc/Contents/Resources/python/bin/python'))));
 controller.abort();await stopped;assert.ok(started,'native render never started');
 const completed=await second;assert.equal(completed.name,'Next document.docx');assert.ok(Buffer.from(completed.data,'base64').length>100);
});
for(const interruption of ['caller','service']) test(`native ${interruption} interruption reaps the worker and recovers admission`,{skip:!enabled,timeout:15000},async t=>{
 const proc=spawn(client,[],{stdio:['pipe','pipe','pipe']}); let stdout='',stderr='';
 proc.stdout.on('data',b=>stdout+=b);proc.stderr.on('data',b=>stderr+=b);proc.stdin.on('error',()=>{});
 const exited=new Promise(resolve=>{proc.once('exit',(code,signal)=>resolve({code,signal}));proc.once('error',error=>resolve({code:1,error}));});
 const input=request('docx'); input.document.blocks=[{type:'table',rows:Array.from({length:1900},()=>['Test','Data','Row'])}];
 proc.stdin.end(JSON.stringify(input));let worker;
 t.after(async()=>{if(worker&&alive(worker.pid)){process.kill(worker.pid,'SIGCONT');process.kill(worker.pid,'SIGKILL');}if(proc.exitCode===null&&proc.signalCode===null)proc.kill('SIGKILL');await exited;});
 worker=await until(()=>{
  const rows=spawnSync('/bin/ps',['-axo','pid=,ppid=,command='],{encoding:'utf8'}).stdout.split('\n').map(line=>line.trim().match(/^(\d+)\s+(\d+)\s+(.+)$/)).filter(Boolean);
  const row=rows.find(r=>r[3].includes(path.join(app,'Contents/XPCServices/DocumentHelperService.xpc/Contents/Resources/python/bin/python')));
  if(!row)return null;const supervisor=rows.find(r=>r[1]===row[2]);const service=rows.find(r=>r[1]===supervisor?.[2]);
  if(!service?.[3].includes('DocumentHelperService.xpc/Contents/MacOS/DocumentHelperService'))return null;
  return {pid:Number(row[1]),service:Number(service[1])};
 });
 assert.ok(worker,`worker not observed: ${stderr} ${stdout.slice(0,200)}`);
 process.kill(worker.pid,'SIGSTOP');
 process.kill(interruption==='caller'?proc.pid:worker.service,interruption==='caller'?'SIGTERM':'SIGKILL');
 const result=await exited;assert.notEqual(result.code,0,'interrupted render returned a document');
 assert.ok(await until(()=>!alive(worker.pid)),'interrupted worker survived');
 const recovered=execute(request('docx'));assert.equal(recovered.ok,true,JSON.stringify(recovered));
});
