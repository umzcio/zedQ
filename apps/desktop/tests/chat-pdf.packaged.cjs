// Run against a built app with an isolated profile and a synthetic connector.
// No live provider, Google account, or user documents are accessed.
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {_electron}=require('playwright-core');
(async()=>{
 const executablePath=process.argv[2];assert.ok(executablePath,'Pass the built zQ executable path');
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'zq-pdf-packaged-'));let app;
 try{
  app=await _electron.launch({executablePath:path.resolve(executablePath),env:{...process.env,ZQ_DATA_DIR:directory}});
  const page=await app.firstWindow(),errors=[];page.on('pageerror',error=>errors.push(error.message));await page.getByRole('button',{name:'Chat module',exact:true}).waitFor();
  const versions=await page.evaluate(()=>window.zq.modules.list());assert.ok(versions.ok);assert.ok(versions.value.some(row=>row.id==='zq.chat'&&row.version==='1.18.14'));
  const result=await app.evaluate(async({app})=>{
   const require=process.getBuiltinModule('module').createRequire(app.getAppPath()+'/package.json');
   const path=require('node:path'),assert=require('node:assert/strict'),root=app.getAppPath();
   const {ChatService}=require(path.join(root,'electron/chat-service.cjs')),{ArtifactService}=require(path.join(root,'electron/artifact-service.cjs'));
   const directory=path.join(app.getPath('userData'),'pdf-fixture'),artifacts=new ArtifactService({directory});
   const generated=await artifacts.create({format:'pdf',title:'Test registration',content:'Vehicle: 2015 Test Wagon. VIN: TEST1234567890123'}),file=artifacts.file({artifactId:generated.id,versionId:generated.versions[0].id});
   const row={id:'fixture-drive',name:'Fixture Drive',status:'connected',revision:1,tools:[{name:'read_file',description:'Read fixture PDF',inputSchema:{type:'object',properties:{},additionalProperties:false},enabled:true,readOnly:true}]};
   let downloads=0,round=0,documentId;
   const connectors={list:()=>[structuredClone(row)],callTool:async()=>{downloads++;return {content:[{type:'resource',resource:{uri:'file:///registration.pdf',mimeType:'application/pdf',blob:file.data}}]}}};
   const provider={supportsLocalTools:async()=>true,streamChat:async request=>{
    if(++round===1){const tool=request.localTools.find(tool=>tool.name.startsWith('mcp_'));const result=await request.onLocalTool({name:tool.name,arguments:{}});assert.match(JSON.stringify(result),/TEST1234567890123/);request.onDelta({content:'Found the registration PDF and its VIN.'});throw Error('Fixture response limit');}
    assert.match(request.messages.find(message=>message.role==='assistant').content,/incomplete.*Found the registration/s);
    const read=await request.onLocalTool({name:'read_document',arguments:{artifactId:documentId}});assert.match(read.content,/TEST1234567890123/);assert.equal(read.editable,false);request.onDelta({content:'The saved PDF identifies the test vehicle.'});
   }};
   const chat=new ChatService({directory,artifacts,connectors,provider});
   const wait=async()=>{for(let i=0;i<1000;i++){if(!chat.runs.size)return;await new Promise(resolve=>setTimeout(resolve,10))}throw Error('Fixture timed out')};
   try{
    const connection=chat.saveConnection({provider:'ollama',name:'Fixture',baseUrl:'http://127.0.0.1:11434'}),c=chat.createConversation({connectionId:connection.id,model:'fixture'});
    await chat.sendMessage({conversationId:c.id,text:'Read the test vehicle registration',connectorIds:[row.id]});
    for(let i=0;i<500;i++){const approval=chat.conversation(c.id).messages.at(-1)?.interactions?.find(item=>item.status==='waiting');if(approval){chat.respondToInteraction({conversationId:c.id,id:approval.id,decision:'chat'});break;}await new Promise(resolve=>setTimeout(resolve,10));}
    await wait();const partial=chat.conversation(c.id).messages.at(-1);assert.equal(partial.status,'error');assert.match(partial.content,/Found the registration/);assert.equal(partial.generatedFiles.length,1);
    documentId=artifacts.list().find(item=>item.versions.some(version=>version.source?.generatedFileId===partial.generatedFiles[0].id)).id;
    await chat.sendMessage({conversationId:c.id,text:'Continue from the partial results'});await wait();const final=chat.conversation(c.id).messages.at(-1);assert.equal(final.status,'complete',final.error);assert.equal(downloads,1);
    return {downloads,rounds:round,readable:true,continued:true};
   }finally{chat.shutdown()}
  });
  assert.deepEqual(result,{downloads:1,rounds:2,readable:true,continued:true});assert.deepEqual(errors,[]);console.log('PASS packaged PDF: connector text extraction, original file attachment, partial-result continuation, and local reread with no second download.');
 }finally{await app?.close();fs.rmSync(directory,{recursive:true,force:true})}
})().catch(error=>{console.error(error);process.exitCode=1});
