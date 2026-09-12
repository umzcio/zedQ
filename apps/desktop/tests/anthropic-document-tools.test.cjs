const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createProvider,PROVIDERS}=require('@zq/providers');
const {ChatService}=require('../electron/chat-service.cjs');
const {ArtifactService}=require('../electron/artifact-service.cjs');
const {DOCUMENT_TOOLS}=require('../electron/chat-document-tools.cjs');
const baseUrl=PROVIDERS.anthropic.baseUrl;
const document={format:'docx',title:'Breezy Verse',content:'A little toot escaped the chair.\nAnd left a giggle in the air.'};
test('Anthropic loads an automatically discovered skill before creating a real DOCX and persists both activities',async t=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'zq-auto-skill-docx-')),keys=new Map(),bodies=[];let skillId;
 const artifacts=new ArtifactService({directory}),chat=new ChatService({directory,artifacts,credentials:{set:async(id,key)=>keys.set(id,key),get:async id=>keys.get(id),delete:async id=>keys.delete(id)},providerFactory:(provider,options)=>createProvider(provider,{...options,fetchImpl:async(url,request)=>{
  const body=JSON.parse(request.body);bodies.push(body);assert.ok(bodies.length<=3);
  if(bodies.length===1){assert.ok(body.tools.some(t=>t.name==='use_skill'));assert.match(body.system,/Word workflow/);assert.doesNotMatch(body.system,/Use the poem title as a heading/);return new Response([
   {type:'content_block_start',index:0,content_block:{type:'tool_use',id:'skill_call',name:'use_skill',input:{id:skillId}}},
   {type:'content_block_stop',index:0},{type:'message_delta',delta:{stop_reason:'tool_use'}},{type:'message_stop'},
  ].map(event=>'data: '+JSON.stringify(event)+'\n\n').join(''),{headers:{'Content-Type':'text/event-stream'}})}
  const output=JSON.parse(body.messages.at(-1).content[0].content);assert.equal(output.ok,true,output.error);
  if(bodies.length===2){assert.match(output.instructions,/Use the poem title as a heading/);assert.equal(body.messages.at(-1).content[0].tool_use_id,'skill_call')}
  return response(bodies.length===2);
 }})});
 t.after(()=>{chat.shutdown();fs.rmSync(directory,{recursive:true,force:true})});
 skillId=chat.saveSkill({name:'docx',description:'Word workflow',instructions:'Use the poem title as a heading.'}).id;
 const connection=await chat.saveConnection({provider:'anthropic',name:'Fixture',apiKey:'fixture-only'}),conversation=chat.createConversation({connectionId:connection.id,model:'claude-sonnet-5'});
 await chat.sendMessage({conversationId:conversation.id,text:'Create a Word poem'});for(let i=0;i<1000&&chat.runs.size;i++)await new Promise(r=>setTimeout(r,5));assert.equal(chat.runs.size,0);
 const [user,reply]=chat.conversation(conversation.id).messages;assert.equal(reply.status,'complete',reply.error);assert.equal(bodies.length,3);assert.equal(user.skillContext[0].id,skillId);assert.equal(reply.skillUsage[0].source,'automatic');assert.equal(reply.toolActivity[0].kind,'create_document');assert.equal(reply.generatedFiles.length,1);
 const file=chat.generatedFile({conversationId:conversation.id,messageId:reply.id,fileId:reply.generatedFiles[0].id}),zip=await require('jszip').loadAsync(Buffer.from(file.data,'base64'));assert.match(await zip.file('word/document.xml').async('string'),/A little toot escaped the chair/);
});
function response(call=false){
 const block=call?{type:'tool_use',id:'document_call',name:'create_document',input:document}:{type:'text',text:'Your Word document is attached.'};
 return new Response([
  {type:'content_block_start',index:0,content_block:block},
  {type:'content_block_stop',index:0},
  {type:'message_delta',delta:{stop_reason:call?'tool_use':'end_turn'}},
  {type:'message_stop'},
 ].map(event=>'data: '+JSON.stringify(event)+'\n\n').join(''),{headers:{'Content-Type':'text/event-stream'}});
}
test('Sonnet 5 and Opus 5 support document functions while unknown Claude models remain rejected',async()=>{
 const adapter=createProvider('anthropic',{apiKey:'fixture-only',fetchImpl:()=>{throw Error('Capability checks must not send requests')}});
 for(const model of ['claude-sonnet-5','claude-opus-5'])assert.equal(await adapter.supportsLocalTools(baseUrl,model),true,model);
 for(const model of ['future-model','claude-sonnet-6','claude-opus-6','claude-haiku-5','claude-sonnet-5unknown'])assert.equal(await adapter.supportsLocalTools(baseUrl,model),false,model);
});
test('the native Anthropic adapter sends Sonnet 5 document schemas and correlates tool results',async()=>{
 const bodies=[],calls=[],text=[];
 const adapter=createProvider('anthropic',{apiKey:'fixture-only',fetchImpl:async(url,options)=>{
  assert.equal(url,baseUrl+'/messages');bodies.push(JSON.parse(options.body));assert.ok(bodies.length<=2,'Unexpected continuation');return response(bodies.length===1);
 }});
 await adapter.streamChat({baseUrl,model:'claude-sonnet-5',messages:[{role:'user',content:'Create a Word document'}],tools:[],localTools:DOCUMENT_TOOLS,onDelta:delta=>text.push(delta.content),onLocalTool:call=>{calls.push(call);return {ok:true,name:'Breezy Verse.docx'}}});
 assert.deepEqual(bodies[0].tools.map(tool=>tool.name),['create_document','read_document','revise_document']);
 assert.deepEqual(bodies[0].tools[0].input_schema,DOCUMENT_TOOLS[0].parameters);
 assert.deepEqual(calls,[{name:'create_document',arguments:document}]);
 const result=bodies[1].messages.at(-1);assert.equal(result.role,'user');assert.equal(result.content[0].type,'tool_result');assert.equal(result.content[0].tool_use_id,'document_call');assert.equal(JSON.parse(result.content[0].content).ok,true);
 assert.match(text.join(''),/Word document is attached/);
});
test('Sonnet 5 and Opus 5 create real persisted DOCX files through the native adapter without hosted tools or skills',async t=>{
 for(const model of ['claude-sonnet-5','claude-opus-5']){
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'zq-anthropic-docx-')),keys=new Map(),bodies=[];
  const artifacts=new ArtifactService({directory});
  const chat=new ChatService({directory,artifacts,credentials:{set:async(id,key)=>keys.set(id,key),get:async id=>keys.get(id),delete:async id=>keys.delete(id)},providerFactory:(provider,options)=>createProvider(provider,{...options,fetchImpl:async(url,request)=>{
   assert.equal(url,baseUrl+'/messages');const body=JSON.parse(request.body);bodies.push(body);assert.ok(bodies.length<=2,'Unexpected continuation');
   return response(bodies.length===1);
  }})});
  t.after(()=>{chat.shutdown();fs.rmSync(directory,{recursive:true,force:true})});
  const connection=await chat.saveConnection({provider:'anthropic',name:'Isolated fixture',apiKey:'fixture-only'});
  const conversation=chat.createConversation({connectionId:connection.id,model});
  await chat.sendMessage({conversationId:conversation.id,text:'Write a poem about farts and then export to Word doc'});
  for(let i=0;i<1000&&chat.runs.size;i++)await new Promise(resolve=>setTimeout(resolve,5));
  assert.equal(chat.runs.size,0,'Response did not finish');const [user,reply]=chat.conversation(conversation.id).messages;
  assert.equal(reply.status,'complete',reply.error);assert.equal(bodies.length,2);
  assert.match(bodies[0].system,/create_document/);assert.equal(bodies[0].model,model);
  assert.deepEqual(bodies[0].tools.map(tool=>tool.name),['create_document','read_document','revise_document','request_user_input']);
  assert.deepEqual(user.tools,[]);assert.deepEqual(user.skillContext,[]);
  const result=JSON.parse(bodies[1].messages.at(-1).content[0].content);assert.equal(result.ok,true,result.error);assert.equal(result.name,'Breezy Verse.docx');
  assert.equal(reply.generatedFiles.length,1);assert.equal(reply.generatedFiles[0].id,result.fileId);
  assert.equal(reply.toolActivity[0].kind,'create_document');assert.equal(reply.toolActivity[0].status,'complete');
  const restored=new ArtifactService({directory}),target={artifactId:result.artifactId,versionId:result.versionId},saved=restored.version(target),file=restored.file(target);
  assert.equal(restored.list().length,1);assert.equal(saved.content,document.content);assert.equal(saved.source.generatedFileId,result.fileId);
  const zip=await require('jszip').loadAsync(Buffer.from(file.data,'base64'));const xml=await zip.file('word/document.xml').async('string');assert.match(xml,/A little toot escaped the chair/);assert.match(xml,/And left a giggle in the air/);
  assert.equal(new ChatService({directory}).conversation(conversation.id).messages.at(-1).generatedFiles[0].id,result.fileId);
 }
});
