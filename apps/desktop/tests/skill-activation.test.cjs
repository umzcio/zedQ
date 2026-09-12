const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {ChatService}=require('../electron/chat-service.cjs');
const wait=async chat=>{for(let i=0;i<500&&chat.runs.size;i++)await new Promise(r=>setTimeout(r,5));assert.equal(chat.runs.size,0)};
async function fixture(t,{local=true}={}){
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'zq-skill-activation-')),requests=[];let handle=async()=>{};
 const chat=new ChatService({directory,provider:{supportsLocalTools:async()=>local,streamChat:async request=>{requests.push(request);await handle(request);request.onDelta({content:'Done'})}}});
 t.after(()=>{chat.shutdown();fs.rmSync(directory,{recursive:true,force:true})});
 const connection=await chat.saveConnection({provider:'ollama',name:'Fixture',baseUrl:'http://localhost:11434'});
 const docx=chat.saveSkill({name:'docx',description:'Create or edit Word documents.',instructions:'Use Word styles. SECRET_FULL_INSTRUCTIONS'});
 const other=chat.saveSkill({name:'Review',description:'Review source code.',instructions:'UNRELATED_INSTRUCTIONS'});
 const make=projectId=>chat.createConversation({connectionId:connection.id,model:'fixture',projectId});
 return {chat,directory,docx,other,requests,make,handle:fn=>handle=fn,send:async(c,skillIds)=>{await chat.sendMessage({conversationId:c.id,text:'Create a Word document',...(skillIds!==undefined?{skillIds}:{})});await wait(chat);assert.equal(chat.conversation(c.id).messages.at(-1).status,'complete',chat.conversation(c.id).messages.at(-1).error)}};
}
test('automatic selection advertises metadata only, loads real instructions and references, and persists truthful activity',async t=>{
 const f=await fixture(t),c=f.make(null);const files=await f.chat.attachments.importFiles([{name:'guide.txt',bytes:Buffer.from('REFERENCE_TEXT')}]);f.chat.addSkillFiles({id:f.docx.id,attachmentIds:files.items.map(file=>file.id)});
 let output;
 f.handle(async r=>{assert.ok(r.localTools.some(tool=>tool.name==='use_skill'));assert.match(r.messages[0].content,/Create or edit Word documents/);assert.doesNotMatch(r.messages[0].content,/SECRET_FULL_INSTRUCTIONS|UNRELATED_INSTRUCTIONS/);output=await r.onLocalTool({name:'use_skill',arguments:{id:f.docx.id}});assert.equal(output.ok,true);assert.match(output.instructions,/SECRET_FULL_INSTRUCTIONS/);assert.equal(output.references[0].text,'REFERENCE_TEXT');await r.onLocalTool({name:'use_skill',arguments:{id:f.docx.id}})});
 await f.send(c);const [user,reply]=f.chat.conversation(c.id).messages;assert.deepEqual(user.skillContext.map(s=>s.id),[f.docx.id]);assert.equal(reply.skillUsage.length,1);assert.equal(reply.skillUsage[0].source,'automatic');assert.deepEqual(reply.skillUsage[0].referenceNames,['guide.txt']);assert.equal(f.chat.conversation(c.id).skillIds,undefined);
 const again=new ChatService({directory:f.directory});assert.equal(again.conversation(c.id).messages[0].skillContext[0].instructions,f.docx.instructions);assert.deepEqual(again.conversation(c.id).messages[1].skillUsage,reply.skillUsage);again.shutdown();
});
test('explicit selection, No skills and configured project selections suppress automatic discovery',async t=>{
 const f=await fixture(t);for(const choice of [[f.other.id],[]]){const c=f.make(null);f.handle(async r=>assert.ok(!r.localTools.some(t=>t.name==='use_skill')));await f.send(c,choice);assert.deepEqual(f.chat.conversation(c.id).messages[1].skillUsage?.map(s=>s.id)??[],choice)}
 for(const choice of [[f.docx.id],[]]){const p=f.chat.saveProject({name:'Project'});f.chat.updateProject({id:p.id,skillIds:choice});const c=f.make(p.id);await f.send(c);assert.deepEqual(f.chat.conversation(c.id).messages[1].skillUsage?.map(s=>s.id)??[],choice)}
});
test('unconfigured projects use automatic discovery; unsupported models still receive explicit skills',async t=>{
 const f=await fixture(t),p=f.chat.saveProject({name:'Unconfigured'});let found=false;f.handle(async r=>{found=r.localTools.some(t=>t.name==='use_skill')});await f.send(f.make(p.id));assert.equal(found,true);
 const g=await fixture(t,{local:false}),c=g.make(null);await g.send(c,[g.docx.id]);assert.equal(g.chat.conversation(c.id).messages[1].skillUsage[0].source,'selected');assert.match(g.requests[0].messages[0].content,/SECRET_FULL_INSTRUCTIONS/);
});
test('unknown IDs, changed skills, excessive context and failed writes never report a successful load',async t=>{
 const f=await fixture(t),c=f.make(null);let results=[];
 f.handle(async r=>{
  results.push(await r.onLocalTool({name:'use_skill',arguments:{id:'unknown'}}));
  f.chat.saveSkill({id:f.docx.id,instructions:'Changed after request started'});results.push(await r.onLocalTool({name:'use_skill',arguments:{id:f.docx.id}}));
  const save=f.chat.store.save;f.chat.store.save=()=>{throw Error('Disk unavailable')};try{results.push(await r.onLocalTool({name:'use_skill',arguments:{id:f.other.id}}))}finally{f.chat.store.save=save}
 });await f.send(c);assert.equal(results.length,3);assert.ok(results.every(r=>r.error));assert.deepEqual(f.chat.conversation(c.id).messages[0].skillContext,[]);assert.equal(f.chat.conversation(c.id).messages[1].skillUsage?.length??0,0);
 const large=f.chat.saveSkill({name:'Large',instructions:'x'.repeat(100001)});f.handle(async r=>{const result=await r.onLocalTool({name:'use_skill',arguments:{id:large.id}});assert.match(result.error,/100 KB/)});await f.send(f.make(null));
});
test('retry uses loaded snapshot after deletion and cannot select newly installed skills',async t=>{
 const f=await fixture(t),c=f.make(null);f.handle(async r=>{await r.onLocalTool({name:'use_skill',arguments:{id:f.docx.id}})});await f.send(c);const reply=f.chat.conversation(c.id).messages[1];f.chat.deleteSkill(f.docx.id);const added=f.chat.saveSkill({name:'New after original',instructions:'NEW_UNAVAILABLE'});
 f.handle(async r=>{assert.match(r.messages[0].content,/SECRET_FULL_INSTRUCTIONS/);assert.doesNotMatch(r.messages[0].content,/New after original|NEW_UNAVAILABLE/)});await f.chat.reviseMessage({conversationId:c.id,messageId:reply.id});await wait(f.chat);assert.equal(f.chat.conversation(c.id).messages[1].status,'complete');assert.equal(f.chat.conversation(c.id).messages[1].skillUsage[0].source,'automatic');assert.ok(!f.requests.at(-1).messages[0].content.includes(added.id));
});
test('queue freezes discovery scope and detects edits instead of loading changed instructions',async t=>{
 const f=await fixture(t),c=f.make(null);f.chat.setQueuePaused({conversationId:c.id,paused:true});f.chat.enqueueMessage({conversationId:c.id,text:'Create Word'});f.chat.saveSkill({id:f.docx.id,instructions:'CHANGED_AFTER_QUEUE'});const added=f.chat.saveSkill({name:'New queue skill',instructions:'NEW'});let result;
 f.handle(async r=>{assert.ok(!r.messages[0].content.includes(added.id));result=await r.onLocalTool({name:'use_skill',arguments:{id:f.docx.id}})});f.chat.setQueuePaused({conversationId:c.id,paused:false});await f.chat.drainQueues();await wait(f.chat);assert.match(result.error,/changed|available/i);assert.deepEqual(f.chat.conversation(c.id).messages[0].skillContext,[]);
});
test('valid long reference names load through both automatic and explicit selection',async t=>{
 const f=await fixture(t),name='guide-'.repeat(50)+'.txt',files=await f.chat.attachments.importFiles([{name,bytes:Buffer.from('Guide')}]);f.chat.addSkillFiles({id:f.docx.id,attachmentIds:files.items.map(file=>file.id)});
 f.handle(async r=>{assert.equal((await r.onLocalTool({name:'use_skill',arguments:{id:f.docx.id}})).ok,true)});const c=f.make(null);await f.send(c);assert.deepEqual(f.chat.conversation(c.id).messages[1].skillUsage[0].referenceNames,[name]);
 f.handle(async()=>{});await f.send(f.make(null),[f.docx.id]);
});
test('skill reads do not ask for write approval and stopped runs cannot load another skill',async t=>{
 const f=await fixture(t),c=f.make(null);f.chat.setApprovalMode({conversationId:c.id,mode:'ask'});
 f.handle(async r=>{assert.equal((await r.onLocalTool({name:'use_skill',arguments:{id:f.docx.id}})).ok,true);assert.equal(f.chat.conversation(c.id).messages[1].interactions,undefined);f.chat.stop(c.id);assert.throws(()=>r.onLocalTool({name:'use_skill',arguments:{id:f.other.id}}),/stopped/)});
 await f.chat.sendMessage({conversationId:c.id,text:'Create Word'});await wait(f.chat);assert.equal(f.chat.conversation(c.id).messages[1].status,'stopped');assert.deepEqual(f.chat.conversation(c.id).messages[1].skillUsage.map(s=>s.id),[f.docx.id]);
});
test('automatic loading shares the ten-skill cap and validates malformed arguments',async t=>{
 const f=await fixture(t),c=f.make(null),ids=[f.docx.id,f.other.id];for(let i=0;i<9;i++)ids.push(f.chat.saveSkill({name:'Skill '+i,instructions:'Short instructions.'}).id);
 f.handle(async r=>{for(const id of ids.slice(0,10))assert.equal((await r.onLocalTool({name:'use_skill',arguments:{id}})).ok,true);assert.match((await r.onLocalTool({name:'use_skill',arguments:{id:ids[10]}})).error,/ten skills/);assert.ok((await r.onLocalTool({name:'use_skill',arguments:{id:f.docx.id,extra:'no'}})).error)});
 await f.send(c);assert.equal(f.chat.conversation(c.id).messages[0].skillContext.length,10);assert.equal(f.chat.conversation(c.id).messages[1].skillUsage.length,10);
});
