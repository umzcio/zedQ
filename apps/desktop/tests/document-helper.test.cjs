const {test, before}=require('node:test');
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const {once}=require('node:events');
const JSZip=require('jszip');
const {renderArtifact}=require('../electron/artifact-renderer.cjs');
const {createDocumentRenderer}=require('../electron/document-helper.cjs');
const input={format:'docx',title:'A / report',content:'# Heading\n\nBody\n\n| A | B |\n| --- | --- |\n| =1+2 | Literal |',typography:{bodySize:12}};
const fixtures={};
before(async()=>{for(const format of ['docx','xlsx','pptx','pdf']){const {name,mime,data}=await renderArtifact({...input,format});fixtures[format]={name,mime,data};}});
const script=`
process.on('SIGTERM',()=>{process.send({signal:'SIGTERM'});if(!process.env.IGNORE_TERM)process.exit(0)});
process.on('message',message=>{
 if(message.raw!==undefined)process.stdout.write(message.raw);
 if(message.response)process.stdout.write(JSON.stringify(message.response));
 if(message.exit!==undefined)process.exit(message.exit);
 if(message.finish)process.stdout.end(()=>process.exit(0));
});
let data='';process.stdin.setEncoding('utf8');process.stdin.on('data',chunk=>data+=chunk);
process.stdin.on('end',()=>process.send({request:JSON.parse(data)}));
`;
function harness(t,options={}){
 const children=[],requests=[],waiters=[];
 const spawnImpl=(file,args,opts)=>{
  assert.equal(file,'/trusted/DocumentHelperLauncher');assert.deepEqual(args,[]);assert.equal(opts.shell,false);
  const child=spawn(process.execPath,['-e',script],{...opts,env:{...process.env,...(options.ignoreTerm?{IGNORE_TERM:'1'}:{})},stdio:['pipe','pipe','pipe','ipc']});
  children.push(child);child.on('message',m=>{if(m.request){requests.push(m.request);waiters.shift()?.({child,request:m.request});}});
  return child;
 };
 t.after(()=>{for(const child of children)if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');});
 assert.equal(typeof createDocumentRenderer,'function','host document transport factory must exist');
 const render=createDocumentRenderer({helperPath:'/trusted/DocumentHelperLauncher',spawnImpl,...options});
 return {render,children,requests,next:()=>new Promise(resolve=>waiters.push(resolve))};
}
const success=(file=fixtures.docx)=>({version:1,ok:true,file,warnings:[]});
const reply=(child,response)=>child.send({response,finish:true});

test('sends only parsed fixed-operation input and validates real documents while preserving the host filename',async t=>{
 const h=harness(t);
 for(const format of ['docx','xlsx','pptx','pdf']){
  const ready=h.next(),pending=h.render({...input,format,helperPath:'/untrusted',code:'do not execute'}),{child,request}=await ready;
  assert.deepEqual(request,{version:1,operation:'render_document',document:{format,title:'A / report',blocks:[{type:'heading',level:1,text:'Heading'},{type:'paragraph',text:'Body'},{type:'table',rows:[['A','B'],['=1+2','Literal']]}],typography:{bodySize:12}}});
  reply(child,success({...fixtures[format],name:`worker.${format}`}));
  const result=await pending;assert.equal(result.name,`A - report.${format}`);assert.equal(result.data,fixtures[format].data);assert.match(result.previewText,/Heading\n\nBody/);assert.match(result.previewText,/=1\+2\tLiteral/);
 }
});

test('invalid source, title, format, typography and pre-abort never launch a process',async t=>{
 const h=harness(t);
 for(const invalid of [{format:'exe'},{title:'x'.repeat(161)},{content:' '},{content:'é'.repeat(52000)},{content:'x\n'.repeat(4001)},{typography:{code:'x'}}])await assert.rejects(h.render({...input,...invalid}));
 const controller=new AbortController();controller.abort();await assert.rejects(h.render(input,{signal:controller.signal}),{name:'AbortError'});assert.equal(h.children.length,0);
});

test('runs one caller at a time and removes an aborted queued request',async t=>{
 const h=harness(t),ready=h.next(),first=h.render(input),{child}=await ready;
 const controller=new AbortController(),second=h.render(input,{signal:controller.signal});const rejected=assert.rejects(second,{name:'AbortError'});
 const third=h.render({...input,title:'Third'});controller.abort();await rejected;
 assert.equal(h.children.length,1);const next=h.next();reply(child,success());await first;
 const job=await next;assert.equal(job.request.document.title,'Third');reply(job.child,success());await third;assert.equal(h.children.length,2);
});

test('in-flight abort terminates the caller',async t=>{
 const h=harness(t),controller=new AbortController(),ready=h.next(),pending=h.render(input,{signal:controller.signal}),{child}=await ready;
 const rejected=assert.rejects(pending,{name:'AbortError'}),signal=once(child,'message'),closed=once(child,'close');controller.abort();assert.deepEqual((await signal)[0],{signal:'SIGTERM'});await rejected;await closed;
});

test('timeout escalates an unresponsive caller to SIGKILL before starting the next queued job',async t=>{
 const h=harness(t,{timeoutMs:300,killGraceMs:25,ignoreTerm:true}),ready=h.next(),pending=h.render(input),failed=assert.rejects(pending,/timed out/i),{child}=await ready;
 const signal=once(child,'message'),closed=once(child,'close'),next=h.next(),second=h.render(input);
 assert.deepEqual((await signal)[0],{signal:'SIGTERM'});assert.equal(h.children.length,1);await failed;assert.equal((await closed)[1],'SIGKILL');
 const job=await next;reply(job.child,success());await second;
});

test('process exits, spawn failures and native/worker error envelopes reject explicitly',async t=>{
 for(const response of [{version:1,ok:false,error:'Worker rejected document'},{exitCode:70,error:'XPC failed',files:[]}]){
  const h=harness(t),ready=h.next(),pending=h.render(input),rejected=assert.rejects(pending,/rejected document|XPC failed/),{child}=await ready;reply(child,response);await rejected;
 }
 const h=harness(t),ready=h.next(),pending=h.render(input),rejected=assert.rejects(pending,/exit.*7/i),{child}=await ready;child.send({exit:7});await rejected;
 const render=createDocumentRenderer({helperPath:'/nonexistent/document-helper'});await assert.rejects(render(input),/document helper is unavailable.*rebuild or reinstall/i);
 const throws=createDocumentRenderer({helperPath:'/trusted/helper',spawnImpl:()=>{throw Error('spawn exploded');}});await assert.rejects(throws(input),/spawn exploded/);
});

test('strict envelopes reject malformed JSON, unknown keys, noncanonical base64 and unsafe/mismatched metadata',async t=>{
 const responses=[
  'not json',JSON.stringify(success())+'\n{}',
  {...success(),extra:true},{...success(),version:2},{...success(),warnings:'warning'},
  {...success(),file:{...fixtures.docx,path:'/tmp/document'}},
  ...['../report.docx','report.pdf','report.bin','report\\name.docx','report\u0000.docx'].map(name=>success({...fixtures.docx,name})),
  success({...fixtures.docx,mime:fixtures.xlsx.mime}),success({...fixtures.docx,data:fixtures.docx.data+'\n'}),
  success({...fixtures.docx,data:''}),success({...fixtures.docx,data:'Zg='}),
 ];
 for(const response of responses){const h=harness(t),ready=h.next(),pending=h.render(input),rejected=assert.rejects(pending),{child}=await ready;child.send(typeof response==='string'?{raw:response,finish:true}:{response,finish:true});await rejected;}
});

test('bounded stdout and binary file limits reject before accepting output',async t=>{
 for(const response of [' '.repeat(6*1024*1024+1),success({...fixtures.docx,data:Buffer.alloc(4*1024*1024+1).toString('base64')})]){
  const h=harness(t),ready=h.next(),pending=h.render(input),rejected=assert.rejects(pending,/limit|large|exceed/i),{child}=await ready;child.send(typeof response==='string'?{raw:response,finish:true}:{response,finish:true});await rejected;
 }
});

test('independently rejects bogus PDF and Office structures and renamed real documents of another format',async t=>{
 const empty=new JSZip();empty.file('harmless.txt','not an Office file');const archive=await empty.generateAsync({type:'base64'});
 const cases=[['pdf',Buffer.from('not a PDF').toString('base64')],['pdf',fixtures.docx.data],['docx',archive],['xlsx',archive],['pptx',archive],['docx',fixtures.xlsx.data],['xlsx',fixtures.pptx.data],['pptx',fixtures.docx.data]];
 for(const [format,data] of cases){const h=harness(t),ready=h.next(),pending=h.render({...input,format}),rejected=assert.rejects(pending,/PDF|Office|format|part/i),{child}=await ready;reply(child,success({...fixtures[format],data}));await rejected;}
});


test('an aborted caller cannot return success, and failures leave the queue usable',async t=>{
 const h=harness(t,{ignoreTerm:true}),controller=new AbortController(),ready=h.next(),pending=h.render(input,{signal:controller.signal}),rejected=assert.rejects(pending,{name:'AbortError'}),{child}=await ready;
 const signal=once(child,'message');controller.abort();await signal;reply(child,success());await rejected;
 const next=h.next(),second=h.render(input),job=await next;reply(job.child,success());assert.equal((await second).name,'A - report.docx');
});

test('valid JSON cannot mask a nonzero process exit',async t=>{
 const h=harness(t),ready=h.next(),pending=h.render(input),rejected=assert.rejects(pending,/exit code 9/),{child}=await ready;
 child.send({response:success(),exit:9});await rejected;
});

test('Office format checks reject missing package relationships, forged main types and malformed main XML',async t=>{
 for(const mutation of [
  zip=>zip.remove('_rels/.rels'),
  zip=>zip.file('[Content_Types].xml','<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>'),
  zip=>zip.file('word/document.xml','<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><'),
  zip=>zip.file('word/document.xml','<!DOCTYPE document [<!ENTITY text "injected">]><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">&text;</w:document>'),
 ]){
  const zip=await JSZip.loadAsync(fixtures.docx.data,{base64:true});mutation(zip);const data=await zip.generateAsync({type:'base64'});
  const h=harness(t),ready=h.next(),pending=h.render(input),rejected=assert.rejects(pending),{child}=await ready;reply(child,success({...fixtures.docx,data}));await rejected;
 }
});

test('rejects excess queued jobs instead of retaining unlimited document requests',async t=>{
 const h=harness(t),ready=h.next(),first=h.render(input),{child}=await ready;
 const queued=Array.from({length:8},()=>{const controller=new AbortController();return {controller,rejected:assert.rejects(h.render(input,{signal:controller.signal}),{name:'AbortError'})};});
 await assert.rejects(h.render(input),/queue|busy/i);assert.equal(h.children.length,1);
 for(const job of queued)job.controller.abort();await Promise.all(queued.map(job=>job.rejected));reply(child,success());await first;
});
