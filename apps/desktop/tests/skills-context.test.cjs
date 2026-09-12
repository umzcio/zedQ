const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {ChatService}=require('../electron/chat-service.cjs');
const wait=async chat=>{for(let i=0;i<500&&chat.runs.size;i++)await new Promise(r=>setTimeout(r,5));assert.equal(chat.runs.size,0)};
async function fixture(t){const directory=fs.mkdtempSync(path.join(os.tmpdir(),'zq-skills-context-')),requests=[];const chat=new ChatService({directory,provider:{streamChat:async a=>{requests.push(a);a.onDelta({content:'Done'})}}});t.after(()=>{chat.shutdown();fs.rmSync(directory,{recursive:true,force:true})});const conn=await chat.saveConnection({provider:'ollama',name:'Fixture',baseUrl:'http://localhost:11434'});return{directory,chat,requests,make:projectId=>chat.createConversation({connectionId:conn.id,model:'fixture',projectId}),send:async(id,skillIds)=>{await chat.sendMessage({conversationId:id,text:'Hello',...(skillIds!==undefined?{skillIds}:{})});await wait(chat)}}}
test('skills inherit project selection, allow chat override and persist exact sent context across restart',async t=>{
 const f=await fixture(t);assert.equal(typeof f.chat.saveSkill,'function');const a=f.chat.saveSkill({name:'Writer',instructions:'Use short sentences.'}),b=f.chat.saveSkill({name:'Analyst',instructions:'Show assumptions.'});
 const p=f.chat.saveProject({name:'Project'});f.chat.updateProject({id:p.id,skillIds:[a.id]});const c=f.make(p.id);
 await f.send(c.id);assert.match(f.requests.at(-1).messages[0].content,/Use short sentences/);assert.equal(f.chat.conversation(c.id).messages[0].skillContext[0].id,a.id);
 await f.send(c.id,[b.id]);assert.match(f.requests.at(-1).messages[0].content,/Show assumptions/);assert.doesNotMatch(f.requests.at(-1).messages[0].content,/Use short sentences/);
 await f.send(c.id,[]);assert.doesNotMatch(f.requests.at(-1).messages[0].content,/Show assumptions|Use short sentences/);
 const again=new ChatService({directory:f.directory});assert.deepEqual(again.conversation(c.id).skillIds,[]);assert.equal(again.state.skills.length,2);again.shutdown();
});
test('retry uses original skills after library edits/deletion; branches keep original snapshots',async t=>{
 const f=await fixture(t);const a=f.chat.saveSkill({name:'Writer',instructions:'Original instructions.'}),c=f.make(null);await f.send(c.id,[a.id]);
 const user=f.chat.conversation(c.id).messages[0],assistant=f.chat.conversation(c.id).messages[1];f.chat.saveSkill({id:a.id,instructions:'Changed instructions.'});f.chat.deleteSkill(a.id);
 await f.chat.reviseMessage({conversationId:c.id,messageId:assistant.id});await wait(f.chat);assert.match(f.requests.at(-1).messages[0].content,/Original instructions/);assert.doesNotMatch(f.requests.at(-1).messages[0].content,/Changed instructions/);
 const branch=f.chat.branchConversation({conversationId:c.id,messageId:user.id});assert.equal(branch.messages[0].skillContext[0].instructions,'Original instructions.');
});
test('skill reference text is quoted, inspector counts it, and oversized selection never mutates chat',async t=>{
 const f=await fixture(t),a=f.chat.saveSkill({name:'Writer',instructions:'Use references.'}),c=f.make(null);
 const imported=await f.chat.attachments.importFiles([{name:'guide.txt',bytes:Buffer.from('Reference material: exact phrase.')}]);f.chat.addSkillFiles({id:a.id,attachmentIds:imported.items.map(a=>a.id)});
 const info=f.chat.inspectContext({conversationId:c.id,text:'Hello',skillIds:[a.id]});assert.ok(info.referenceBytes>30);await f.send(c.id,[a.id]);const request=f.requests.at(-1);assert.match(request.messages.at(-1).content,/exact phrase/);assert.doesNotMatch(request.messages[0].content,/exact phrase/);
 const ids=[];for(let i=0;i<8;i++)ids.push(f.chat.saveSkill({name:'Large'+i,instructions:'X'.repeat(16000)}).id);const before=f.chat.conversation(c.id).messages.length;assert.match(f.chat.inspectContext({conversationId:c.id,text:'Hello',skillIds:ids}).error,/100 KB/);await assert.rejects(f.send(c.id,ids),/100 KB/);assert.equal(f.chat.conversation(c.id).messages.length,before);
 await assert.rejects(f.send(c.id,['missing']),/skill/i);
});
test('new draft skill choice persists into created conversation; undefined fields keep old stores valid',async t=>{
 const f=await fixture(t),a=f.chat.saveSkill({name:'Writer',instructions:'Be concise.'});f.chat.saveDraft({id:'new:general',text:'Draft',skillIds:[a.id]});const c=f.chat.createConversation({draftFrom:'new:general'});assert.deepEqual(f.chat.state.drafts[c.id].skillIds,[a.id]);assert.deepEqual(f.chat.conversation(c.id).skillIds,[a.id]);
 const loaded=new ChatService({directory:f.directory});assert.deepEqual(loaded.state.drafts[c.id].skillIds,[a.id]);loaded.shutdown();
});
