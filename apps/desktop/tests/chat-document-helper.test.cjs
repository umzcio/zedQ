'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {ChatService}=require('../electron/chat-service.cjs');
const {ArtifactService}=require('../electron/artifact-service.cjs');
const {validateDocumentFile}=require('../electron/artifact-document-validation.cjs');
const enabled=process.platform==='darwin'&&process.env.ZQ_TEST_DOCUMENT_HELPER==='1';
const helperPath=path.resolve(__dirname,'../native/bin/DocumentHelper.app/Contents/MacOS/DocumentHelperLauncher');
async function until(check){const end=Date.now()+35000;while(Date.now()<end){if(check())return;await new Promise(resolve=>setTimeout(resolve,10))}assert.fail('Document helper Chat operation did not finish');}
async function fixture(t){
 const {createDocumentRenderer}=require('../electron/document-helper.cjs');
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'zq-chat-document-helper-'));
 const render=createDocumentRenderer({helperPath});
 let handler,started=0,finished=0;
 const artifacts=new ArtifactService({directory,render:async(input,options)=>{started++;try{return await render(input,options)}finally{finished++}}});
 const chat=new ChatService({directory,artifacts,provider:{supportsLocalTools:async()=>true,streamChat:async request=>{await handler(request);request.onDelta({content:'The document operation finished.'})}}});
 t.after(()=>{chat.shutdown();fs.rmSync(directory,{recursive:true,force:true})});
 const connection=await chat.saveConnection({provider:'ollama',name:'Isolated native document fixture',baseUrl:'http://localhost:11434'});
 const c=chat.createConversation({connectionId:connection.id,model:'fixture'});
 return {chat,artifacts,directory,id:c.id,last:()=>chat.conversation(c.id).messages.at(-1),started:()=>started,finished:()=>finished,send:async(fn,text='Create or revise the document')=>{handler=fn;await chat.sendMessage({conversationId:c.id,text})},wait:()=>until(()=>!chat.runs.size)};
}
for(const format of ['docx','xlsx','pptx','pdf'])test(`Chat uses the signed document helper to create and revise ${format} while keeping saved versions`,{skip:!enabled,timeout:90000},async t=>{
 const f=await fixture(t);let first,second,loaded;
 const skill=f.chat.saveSkill({name:'Document fixture',description:'Create a structured document.',instructions:'Use short headings and preserve the reference table.'});
 const content='# Overview\nA first line.\nA second line.\n\n| Item | Count |\n| --- | --- |\n| Apples | 3 |';
 await f.send(async request=>{
  loaded=await request.onLocalTool({name:'use_skill',arguments:{id:skill.id}});
  first=await request.onLocalTool({name:'create_document',arguments:{format,title:'Native document',content,typography:{fontFamily:'Arial',bodySize:12}}});
 });await f.wait();
 assert.equal(first?.ok,true,first?.error||f.last().error);
 assert.match(loaded.guidance,/fixed document tools/);
 assert.equal(f.last().skillUsage[0].id,skill.id);
 const original=f.artifacts.file({artifactId:first.artifactId,versionId:first.versionId});
 assert.equal((await validateDocumentFile(original)).format,format);
 assert.equal(f.last().generatedFiles[0].id,first.fileId);
 await f.send(async request=>{
  const base=await request.onLocalTool({name:'read_document',arguments:{artifactId:first.artifactId}});
  second=await request.onLocalTool({name:'revise_document',arguments:{artifactId:first.artifactId,baseVersionId:base.versionId,content:base.content+'\n\n# Next steps\nReview the document.',typography:{bodySize:13}}});
 });await f.wait();
 assert.equal(second?.ok,true,second?.error||f.last().error);
 assert.equal(second.artifactId,first.artifactId);assert.equal(second.versionNumber,2);
 const restored=new ArtifactService({directory:f.directory});
 assert.equal(restored.list().length,1);assert.equal(restored.list()[0].versions.length,2);
 assert.equal(restored.file({artifactId:first.artifactId,versionId:first.versionId}).data,original.data);
 const revised=restored.version({artifactId:first.artifactId,versionId:second.versionId});
 assert.match(revised.content,/Next steps/);assert.equal(revised.typography.fontFamily,'Arial');assert.equal(revised.typography.bodySize,13);
 assert.equal((await validateDocumentFile(restored.file({artifactId:first.artifactId,versionId:second.versionId}))).format,format);
 assert.equal(f.started(),2);assert.equal(f.finished(),2);
});
test('cancelling a native Chat document job leaves no artifact version or download card', {skip:!enabled,timeout:45000},async t=>{
 const f=await fixture(t);let settled=false;
 await f.send(async request=>{try{await request.onLocalTool({name:'create_document',arguments:{format:'pdf',title:'Cancelled native document',content:'# Cancellation fixture\n'+('A bounded paragraph for the document helper.\n\n'.repeat(1500))}})}finally{settled=true}});
 await until(()=>f.started()===1||!f.chat.runs.size);
 assert.equal(f.started(),1,f.last().error);
 f.chat.stop(f.id);await until(()=>settled&&f.finished()===1);
 assert.equal(f.last().status,'stopped');assert.equal(f.last().generatedFiles,undefined);
 assert.deepEqual(f.artifacts.list(),[]);assert.deepEqual(fs.readdirSync(f.artifacts.files),[]);
 assert.deepEqual(new ArtifactService({directory:f.directory}).list(),[]);
});
