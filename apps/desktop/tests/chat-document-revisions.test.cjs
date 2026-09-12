const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {ChatService}=require('../electron/chat-service.cjs'),{ArtifactService}=require('../electron/artifact-service.cjs');
const wait=async chat=>{for(let i=0;i<600;i++){if(!chat.runs.size)return;await new Promise(r=>setTimeout(r,5))}assert.fail('Chat did not finish')};
async function fixture(t){
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'zq-revisions-'));let handle;
 const artifacts=new ArtifactService({directory}),chat=new ChatService({directory,artifacts,provider:{supportsLocalTools:async()=>true,streamChat:async a=>{await handle(a);a.onDelta({content:'Done.'})}}});
 const connection=await chat.saveConnection({provider:'ollama',name:'Fixture',baseUrl:'http://localhost:11434'}),c=chat.createConversation({connectionId:connection.id,model:'fixture'});
 t.after(()=>{chat.shutdown();fs.rmSync(directory,{recursive:true,force:true})});
 return {directory,chat,artifacts,id:c.id,last:()=>chat.conversation(c.id).messages.at(-1),send:async(fn,extra={})=>{handle=fn;await chat.sendMessage({conversationId:c.id,text:'Revise the document',...extra});await wait(chat)}};
}
const create={name:'create_document',arguments:{format:'docx',title:'Plan',content:'# Overview\nKeep this paragraph.\n\n# Actions\n- First action'}};
test('font-only tool revisions keep content and earlier versions; later edits preserve the selected fonts',async t=>{
 const f=await fixture(t);let first,second,third;
 await f.send(async request=>{assert.ok(request.localTools.find(t=>t.name==='create_document').parameters.properties.typography.properties.fontFamily.enum.includes('Bradley Hand'));first=await request.onLocalTool(create)});
 const original=f.artifacts.file({artifactId:first.artifactId,versionId:first.versionId}).data;
 await f.send(async request=>{const read=await request.onLocalTool({name:'read_document',arguments:{artifactId:first.artifactId}});second=await request.onLocalTool({name:'revise_document',arguments:{artifactId:first.artifactId,baseVersionId:read.versionId,typography:{fontFamily:'Bradley Hand',titleFontFamily:'Georgia',bodySize:14}}})});
 assert.equal(second.ok,true,second.error);const saved=f.artifacts.version({artifactId:first.artifactId,versionId:second.versionId});assert.equal(saved.content,create.arguments.content);assert.deepEqual(saved.typography,{fontFamily:'Bradley Hand',titleFontFamily:'Georgia',bodySize:14});assert.equal(f.artifacts.file({artifactId:first.artifactId,versionId:first.versionId}).data,original);
 await f.send(async request=>{const read=await request.onLocalTool({name:'read_document',arguments:{artifactId:first.artifactId}});assert.equal(read.typography.fontFamily,'Bradley Hand');third=await request.onLocalTool({name:'revise_document',arguments:{artifactId:first.artifactId,baseVersionId:read.versionId,content:read.content+'\nOne last thought.',typography:{headingSize:18}}})});
 assert.equal(third.ok,true,third.error);const restored=new ArtifactService({directory:f.directory}),version=restored.version({artifactId:first.artifactId,versionId:third.versionId});assert.equal(version.typography.fontFamily,'Bradley Hand');assert.equal(version.typography.titleFontFamily,'Georgia');assert.equal(version.typography.headingSize,18);assert.match(version.content,/One last thought/);
 const zip=await require('jszip').loadAsync(Buffer.from(restored.file({artifactId:first.artifactId,versionId:third.versionId}).data,'base64'));assert.match(await zip.file('word/styles.xml').async('string'),/w:ascii="Bradley Hand"/);
});
test('chat revisions read saved content, attach a new version, and preserve originals across restart',async t=>{
 const f=await fixture(t);let first,second,duplicate,read;
 await f.send(async a=>{first=await a.onLocalTool(create)});
 const original=f.artifacts.file({artifactId:first.artifactId,versionId:first.versionId}).data;
 await f.send(async a=>{
  assert.ok(a.localTools.some(t=>t.name==='revise_document'));
  assert.ok(a.messages[0].content.includes(first.artifactId));
  read=await a.onLocalTool({name:'read_document',arguments:{artifactId:first.artifactId}});
  const call={name:'revise_document',arguments:{artifactId:first.artifactId,baseVersionId:read.versionId,content:read.content+'\n- Second action',typography:{headingSize:14}}};
  second=await a.onLocalTool(call);duplicate=await a.onLocalTool(call);
 });
 assert.equal(read.content,create.arguments.content);assert.equal(second.ok,true,second.error);assert.equal(second.artifactId,first.artifactId);assert.equal(second.versionNumber,2);assert.equal(duplicate.fileId,second.fileId);
 assert.equal(f.last().generatedFiles.length,1);assert.equal(f.artifacts.list().length,1);
 const restored=new ArtifactService({directory:f.directory}),a=restored.list()[0];assert.equal(a.versions.length,2);assert.equal(restored.file({artifactId:a.id,versionId:first.versionId}).data,original);
 const v=restored.version({artifactId:a.id,versionId:second.versionId});assert.match(v.content,/Keep this paragraph/);assert.match(v.content,/Second action/);assert.equal(v.typography.headingSize,14);assert.equal(v.source.generatedFileId,f.last().generatedFiles[0].id);
 // A later content-only change must retain the previous typography.
 await f.send(async a=>{const base=await a.onLocalTool({name:'read_document',arguments:{artifactId:first.artifactId}});second=await a.onLocalTool({name:'revise_document',arguments:{artifactId:first.artifactId,baseVersionId:base.versionId,content:base.content+'\nFinal note.'}})});
 assert.equal(f.artifacts.version({artifactId:first.artifactId,versionId:second.versionId}).typography.headingSize,14);
});
test('a tool cannot read unrelated library documents or revise without reading its base',async t=>{
 const f=await fixture(t),privateDoc=await f.artifacts.create({...create.arguments,title:'Unrelated',content:'PRIVATE CONTENT'});let first,read,revise;
 await f.send(async a=>{first=await a.onLocalTool(create)});
 await f.send(async a=>{assert.ok(!a.messages[0].content.includes(privateDoc.id));read=await a.onLocalTool({name:'read_document',arguments:{artifactId:privateDoc.id}});revise=await a.onLocalTool({name:'revise_document',arguments:{artifactId:first.artifactId,baseVersionId:first.versionId,content:'Replacement'}})});
 assert.match(read.error,/available|chat/i);assert.match(revise.error,/read_document/);assert.equal(f.artifacts.list().find(a=>a.id===first.artifactId).versions.length,1);assert.equal(f.last().generatedFiles,undefined);
});
test('explicitly selected document and older version are supplied to chat without overwriting history',async t=>{
 const f=await fixture(t),a=await f.artifacts.create(create.arguments),base=a.versions[0].id;
 await f.artifacts.create({...create.arguments,artifactId:a.id,expectedLatestVersionId:base,content:'Newer content'});let result;
 await f.send(async request=>{assert.ok(request.messages[0].content.includes(base));const read=await request.onLocalTool({name:'read_document',arguments:{artifactId:a.id}});assert.equal(read.content,create.arguments.content);result=await request.onLocalTool({name:'revise_document',arguments:{artifactId:a.id,baseVersionId:read.versionId,content:read.content+'\nAlternative ending.'}})}, {artifactContext:{artifactId:a.id,versionId:base}});
 assert.equal(result.ok,true,result.error);assert.equal(f.artifacts.list()[0].versions.length,3);assert.match(f.artifacts.version({artifactId:a.id,versionId:result.versionId}).content,/Alternative ending/);
});
test('a concurrent edit during rendering prevents a stale revision and leaves no file card',async t=>{
 const f=await fixture(t);let first,result;
 await f.send(async a=>{first=await a.onLocalTool(create)});
 await f.send(async a=>{const read=await a.onLocalTool({name:'read_document',arguments:{artifactId:first.artifactId}});const render=f.artifacts.render;f.artifacts.render=async input=>{const file=await render(input);f.artifacts.render=render;await f.artifacts.create({...create.arguments,artifactId:first.artifactId,expectedLatestVersionId:first.versionId,content:'Concurrent edit'});return file};result=await a.onLocalTool({name:'revise_document',arguments:{artifactId:first.artifactId,baseVersionId:read.versionId,content:'Stale change'}})});
 assert.match(result.error,/changed/);assert.equal(f.artifacts.list()[0].versions.length,2);assert.equal(f.last().generatedFiles,undefined);assert.equal(f.last().toolActivity.at(-1).status,'error');
});
test('stopping a revision during rendering preserves the previous version',async t=>{
 const f=await fixture(t);let first,release,started=false;
 await f.send(async a=>{first=await a.onLocalTool(create)});const render=f.artifacts.render;
 f.artifacts.render=async input=>{const output=await render(input);started=true;return new Promise(r=>release=()=>r(output))};
 const pending=f.send(async a=>{const read=await a.onLocalTool({name:'read_document',arguments:{artifactId:first.artifactId}});await a.onLocalTool({name:'revise_document',arguments:{artifactId:first.artifactId,baseVersionId:read.versionId,content:'Discarded'}})});
 for(let i=0;i<500&&!started;i++)await new Promise(r=>setTimeout(r,5));assert.equal(started,true);f.chat.stop(f.id);release();await pending;await new Promise(r=>setTimeout(r,10));assert.equal(f.artifacts.list()[0].versions.length,1);assert.equal(f.last().generatedFiles,undefined);
});

test('typography-only revisions preserve all content in each supported format',async t=>{
 const f=await fixture(t);
 for(const format of ['pdf','docx','xlsx','pptx']){
  let first,result;await f.send(async a=>{first=await a.onLocalTool({...create,arguments:{...create.arguments,format}})});
  await f.send(async a=>{await a.onLocalTool({name:'read_document',arguments:{artifactId:first.artifactId}});result=await a.onLocalTool({name:'revise_document',arguments:{artifactId:first.artifactId,baseVersionId:first.versionId,typography:{headingSize:14}}})});
  assert.equal(result.ok,true,result.error);const saved=f.artifacts.version({artifactId:first.artifactId,versionId:result.versionId});assert.equal(saved.content,create.arguments.content);assert.equal(saved.format,format);assert.equal(saved.typography.headingSize,14);assert.equal(saved.number,2);
 }
});

test('invalid revisions and source-less imports return errors without extra versions',async t=>{
 const f=await fixture(t);let first;await f.send(async a=>{first=await a.onLocalTool(create)});
 const results=[];
 await f.send(async a=>{await a.onLocalTool({name:'read_document',arguments:{artifactId:first.artifactId}});for(const bad of [{content:null},{title:null},{format:'pdf'}])results.push(await a.onLocalTool({name:'revise_document',arguments:{artifactId:first.artifactId,baseVersionId:first.versionId,...bad}}))});
 assert.ok(results.every(r=>r.error));assert.equal(f.artifacts.list()[0].versions.length,1);
 const imported=f.artifacts.importFile(f.artifacts.file({artifactId:first.artifactId,versionId:first.versionId}));let result;
 await f.send(async a=>{result=await a.onLocalTool({name:'read_document',arguments:{artifactId:imported.id}})},{artifactContext:{artifactId:imported.id,versionId:imported.versions[0].id}});
 assert.match(result.error,/editable source/);assert.equal(f.last().generatedFiles,undefined);
});

test('two sequential revisions in one response read their own latest saved version',async t=>{
 const f=await fixture(t);let first,last;
 await f.send(async a=>{first=await a.onLocalTool(create)});
 await f.send(async a=>{for(const sentence of ['First revision.','Second revision.']){const read=await a.onLocalTool({name:'read_document',arguments:{artifactId:first.artifactId}});last=await a.onLocalTool({name:'revise_document',arguments:{artifactId:first.artifactId,baseVersionId:read.versionId,content:read.content+'\n'+sentence}})}});
 assert.equal(last.ok,true,last.error);assert.equal(f.artifacts.list()[0].versions.length,3);const saved=f.artifacts.version({artifactId:first.artifactId,versionId:last.versionId});assert.match(saved.content,/First revision/);assert.match(saved.content,/Second revision/);
});
