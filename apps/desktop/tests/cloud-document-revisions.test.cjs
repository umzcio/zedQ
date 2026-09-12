const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createProvider}=require('@zq/providers');
const {ChatService}=require('../electron/chat-service.cjs'),{ArtifactService}=require('../electron/artifact-service.cjs');
const event=p=>'data: '+(typeof p==='string'?p:JSON.stringify(p))+'\n\n';
function response(provider,name,args,id='call1'){
 let events;
 if(['openai','xai'].includes(provider))events=[{type:'response.completed',response:{status:'completed',output:name?[{id:'fc_'+id,type:'function_call',call_id:id,name,arguments:JSON.stringify(args),status:'completed'}]:[{type:'message',id:'answer',content:[{type:'output_text',text:'Saved the document.',annotations:[]}]}]}}];
 else if(provider==='anthropic'){const block=name?{type:'tool_use',id,name,input:args}:{type:'text',text:'Saved the document.'};events=[{type:'content_block_start',index:0,content_block:block},{type:'content_block_stop',index:0},{type:'message_delta',delta:{stop_reason:name?'tool_use':'end_turn'}},{type:'message_stop'}]}
 else if(provider==='google')events=[{candidates:[{index:0,content:{role:'model',parts:[name?{functionCall:{id,name,args},thoughtSignature:'fixture-signature'}:{text:'Saved the document.'}]},finishReason:'STOP'}]}];
 else events=[{choices:[{index:0,delta:name?{tool_calls:[{index:0,id,type:'function',function:{name,arguments:JSON.stringify(args)}}]}:{content:'Saved the document.'},finish_reason:name?'tool_calls':'stop'}]},'[DONE]'];
 return new Response(events.map(event).join(''));
}
function result(provider,payload){if(['openai','xai'].includes(provider))return JSON.parse(payload.input.at(-1).output);if(provider==='anthropic')return JSON.parse(payload.messages.at(-1).content[0].content);if(provider==='google')return payload.contents.at(-1).parts[0].functionResponse.response;return JSON.parse(payload.messages.at(-1).content)}
const models={openai:'gpt-4.1',anthropic:'claude-sonnet-4-6',google:'gemini-3.8-flash',xai:'grok-4.6',openrouter:'fixture/chat'};
for(const [provider,format] of [['openai','docx'],['anthropic','pdf'],['google','xlsx'],['xai','pptx'],['openrouter','docx']])test(`${provider} native wire creates and revises a persisted ${format} through ChatService`,async t=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'zq-cloud-documents-')),keys=new Map(),artifacts=new ArtifactService({directory});
 let phase=0,turn=0,first;
 const chat=new ChatService({directory,artifacts,credentials:{set:async(id,k)=>keys.set(id,k),get:async id=>keys.get(id),delete:async id=>keys.delete(id)},providerFactory:(kind,options)=>createProvider(kind,{...options,fetchImpl:async(url,o)=>{
  if(url.endsWith('/key'))return new Response('{"data":{}}');
  if(url.endsWith('/models'))return new Response(JSON.stringify({data:[{id:models[provider],architecture:{input_modalities:['text'],output_modalities:['text']},supported_parameters:['tools']}]}));
  const payload=JSON.parse(o.body);
  if(phase===0){if(turn++===0)return response(provider,'create_document',{format,title:'Plan',content:'# Overview\nOriginal paragraph.'});first=result(provider,payload);assert.equal(first.ok,true);return response(provider)}
  if(turn++===0)return response(provider,'read_document',{artifactId:first.artifactId},'read');
  if(turn===2){const read=result(provider,payload);assert.equal(read.versionId,first.versionId);assert.match(read.content,/Original paragraph/);return response(provider,'revise_document',{artifactId:first.artifactId,baseVersionId:read.versionId,content:read.content+'\n\n# Summary\nAdded summary.',typography:{headingSize:14}},'revise')}
  const revision=result(provider,payload);assert.equal(revision.ok,true,revision.error);assert.equal(revision.versionNumber,2);return response(provider);
 }})});
 t.after(()=>{chat.shutdown();fs.rmSync(directory,{recursive:true,force:true})});
 const connection=await chat.saveConnection({provider,name:'Isolated fixture',apiKey:'fixture-secret'}),c=chat.createConversation({connectionId:connection.id,model:models[provider]});
 const send=async text=>{await chat.sendMessage({conversationId:c.id,text});for(let i=0;i<1000&&chat.runs.size;i++)await new Promise(r=>setTimeout(r,5));assert.equal(chat.runs.size,0);const reply=chat.conversation(c.id).messages.at(-1);assert.equal(reply.status,'complete',reply.error);assert.equal(reply.generatedFiles.length,1);return reply};
 await send('Create a document');const original=artifacts.file({artifactId:first.artifactId,versionId:first.versionId}).data;
 phase=1;turn=0;const reply=await send('Add a summary and set the headings to 14 points.');
 assert.equal(artifacts.list().length,1);assert.equal(artifacts.list()[0].versions.length,2);assert.equal(artifacts.file({artifactId:first.artifactId,versionId:first.versionId}).data,original);
 const restored=new ArtifactService({directory}),latest=restored.list()[0].versions.at(-1),version=restored.version({artifactId:first.artifactId,versionId:latest.id});assert.match(version.content,/Added summary/);assert.equal(version.typography.headingSize,14);assert.equal(version.source.generatedFileId,reply.generatedFiles[0].id);
});
test('stopping a cloud revision while native rendering is pending prevents late version commits',async t=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'zq-cloud-cancel-')),artifacts=new ArtifactService({directory}),keys=new Map();
 const original=await artifacts.create({format:'docx',title:'Plan',content:'Keep me.'}),version=original.versions[0].id;
 let turn=0,started=false,release;const render=artifacts.render;
 artifacts.render=async input=>{const file=await render(input);started=true;return new Promise(r=>release=()=>r(file))};
 const chat=new ChatService({directory,artifacts,credentials:{set:async(id,k)=>keys.set(id,k),get:async id=>keys.get(id),delete:async id=>keys.delete(id)},providerFactory:()=>createProvider('openai',{apiKey:'fixture-secret',fetchImpl:async()=>++turn===1?response('openai','read_document',{artifactId:original.id},'read'):response('openai','revise_document',{artifactId:original.id,baseVersionId:version,content:'Discard this.'},'revise')})});
 t.after(()=>{release?.();chat.shutdown();fs.rmSync(directory,{recursive:true,force:true})});
 const connection=await chat.saveConnection({provider:'openai',name:'Isolated fixture',apiKey:'fixture-secret'}),c=chat.createConversation({connectionId:connection.id,model:'gpt-4.1'});
 await chat.sendMessage({conversationId:c.id,text:'Revise this document',artifactContext:{artifactId:original.id,versionId:version}});
 for(let i=0;i<600&&!started;i++)await new Promise(r=>setTimeout(r,5));assert.ok(started);chat.stop(c.id);release();await new Promise(r=>setTimeout(r,15));
 assert.equal(artifacts.list()[0].versions.length,1);assert.equal(chat.conversation(c.id).messages.at(-1).status,'stopped');assert.equal(chat.conversation(c.id).messages.at(-1).generatedFiles,undefined);assert.equal(turn,2);
});
