'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID,createHash}=require('node:crypto');
const {createWorkspaceSession}=require('../electron/mcp/google-workspace.cjs');
const bytes=Buffer.from('%PDF-1.7\nA saved document\n'),file={id:randomUUID(),name:'Report.pdf',mime:'application/pdf',number:2,size:bytes.length,data:bytes.toString('base64')};
const args={artifactId:randomUUID(),versionId:file.id,folderId:'folder1'};
const folder={id:'folder1',name:'Reports',mimeType:'application/vnd.google-apps.folder',version:'1',trashed:false,shared:true,capabilities:{canAddChildren:true}};
async function fixture(t,{destination=folder,upload,write=true}={}){
 const calls=[];let active=structuredClone(destination);
 const session=await createWorkspaceSession({catalogId:'google-drive',driveWriteAccess:()=>write,getToken:async()=> 'fixture-token',fetchImpl:async(raw,init)=>{
  const url=new URL(raw);calls.push({url,init});assert.equal(init.redirect,'error');assert.equal(new Headers(init.headers).get('authorization'),'Bearer fixture-token');
  if(init.method==='POST')return upload?upload(url,init):Response.json({id:'newFile1',name:file.name,mimeType:file.mime,size:String(file.size),md5Checksum:createHash('md5').update(bytes).digest('hex'),parents:['folder1']});
  if(url.pathname.endsWith('/generateIds'))return Response.json({ids:['newFile1']});
  if(url.pathname.endsWith('/about'))return Response.json({user:{emailAddress:'me@example.test'}});
  return Response.json(active);
 }});t.after(()=>session.close());return {...session,calls,setFolder:value=>{active=value},prepare:(a=args,f=file)=>session.prepareDriveUpload(a,f),call:a=>session.client.callTool({name:'upload_file',arguments:a})};
}
test('Drive uploads only the reviewed original bytes and destination, then returns a confirmed file link',async t=>{
 const f=await fixture(t),tools=(await f.client.listTools()).tools;assert.ok(tools.find(t=>t.name==='upload_file'));assert.equal((await f.call(args)).isError,true);assert.equal(f.calls.length,0);
 const review=await f.prepare();assert.match(review.detail,/Report.pdf/);assert.match(review.detail,/Version: 2/);assert.match(review.detail,/Reports/);assert.match(review.detail,/me@example.test/);assert.match(review.detail,/inherited/i);assert.equal(review.approvalAction,'upload_file');assert.ok(f.calls.every(c=>c.init.method==='GET'));
 const result=await f.call(review.arguments);assert.equal(result.isError,undefined,JSON.stringify(result));const post=f.calls.find(c=>c.init.method==='POST');assert.equal(post.url.pathname,'/upload/drive/v3/files');assert.equal(post.url.searchParams.get('uploadType'),'multipart');assert.equal(post.url.searchParams.get('supportsAllDrives'),'true');const body=Buffer.from(post.init.body);assert.ok(body.includes(bytes));assert.ok(body.includes(Buffer.from('"parents":["folder1"]')));assert.ok(body.includes(Buffer.from('"id":"newFile1"')));assert.match(new Headers(post.init.headers).get('content-type'),/^multipart\/related; boundary=/);assert.equal(result.content[1].uri,'https://drive.google.com/file/d/newFile1/view');
 assert.equal((await f.call(review.arguments)).isError,true);assert.equal(f.calls.filter(c=>c.init.method==='POST').length,1);
});
test('Drive rejects replaced arguments and changed destinations before uploading',async t=>{
 const f=await fixture(t),review=await f.prepare();assert.equal((await f.call({...review.arguments,folderId:'another'})).isError,true);assert.equal(f.calls.filter(c=>c.init.method==='POST').length,0);
 const next=await f.prepare();f.setFolder({...folder,version:'2',shared:false});const result=await f.call(next.arguments);assert.equal(result.isError,true);assert.match(result.content[0].text,/changed after review/);assert.equal(f.calls.filter(c=>c.init.method==='POST').length,0);
});
test('Drive rejects missing write permission, nonfolders, trash, unavailable bytes, and oversized uploads',async t=>{
 for(const opts of [{write:false},{destination:{...folder,trashed:true}},{destination:{...folder,mimeType:'text/plain'}},{destination:{...folder,capabilities:{canAddChildren:false}}}]){const f=await fixture(t,opts);await assert.rejects(f.prepare());assert.ok(f.calls.every(c=>c.init.method==='GET'))}
 const f=await fixture(t);for(const invalid of [{...file,id:randomUUID()},{...file,data:'invalid'},{...file,size:1},{...file,name:'../Report.pdf'},{...file,data:Buffer.alloc(5*1024*1024+1).toString('base64'),size:5*1024*1024+1}])await assert.rejects(f.prepare(args,invalid));assert.equal(f.calls.length,0);
});
test('Drive snapshots reviewed bytes, never retries uncertain writes, and does not confirm incomplete responses',async t=>{
 const f=await fixture(t,{upload:()=>{throw Error('connection dropped')}}),review=await f.prepare();const result=await f.call(review.arguments);assert.equal(result.isError,true);assert.match(result.content[0].text,/Check Google Drive.*Do not retry/);assert.equal(f.calls.filter(c=>c.init.method==='POST').length,1);
 const incomplete=await fixture(t,{upload:()=>Response.json({id:'newFile1'})}),r=await incomplete.prepare();assert.equal((await incomplete.call(r.arguments)).isError,true);
 const good=await fixture(t),copy={...file},prepared=await good.prepare(args,copy);copy.data=Buffer.from('swapped').toString('base64');assert.equal((await good.call(prepared.arguments)).isError,undefined);assert.ok(Buffer.from(good.calls.find(c=>c.init.method==='POST').init.body).includes(bytes));
});

test('Drive resolves My Drive to its actual folder ID and rejects cancelled requests before POST',async t=>{
 const f=await fixture(t),review=await f.prepare({artifactId:args.artifactId,versionId:args.versionId});assert.equal(review.arguments.folderId,'root');assert.equal(f.calls[0].url.pathname,'/drive/v3/files/root');assert.match(review.detail,/folders\/folder1/);
 const controller=new AbortController();controller.abort();await assert.rejects(f.client.callTool({name:'upload_file',arguments:review.arguments},{signal:controller.signal}));assert.equal(f.calls.filter(c=>c.init.method==='POST').length,0);
});

test('discarding a review releases its file bytes and invalidates approval',async t=>{
 const f=await fixture(t);for(let i=0;i<8;i++){const review=await f.prepare();assert.equal(typeof review.discard,'function');review.discard();assert.equal((await f.call(review.arguments)).isError,true)}assert.equal(f.calls.filter(c=>c.init.method==='POST').length,0);
});
