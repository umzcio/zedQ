const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {ChatService}=require('../electron/chat-service.cjs');
const {ChatStore}=require('../electron/chat-store.cjs');
function fixture(t){const directory=fs.mkdtempSync(path.join(os.tmpdir(),'zq-lifecycle-'));let serial=0;const requests=[],notes=[{id:'note',title:'Original',body:'Original reference'}];const provider={listModels:async()=>['test'],streamChat:async args=>{requests.push(args);args.onDelta({content:`Response ${++serial}`})}};const service=new ChatService({directory,provider,getNotes:()=>notes});const connection=service.saveConnection({name:'Fixture',provider:'ollama',baseUrl:'http://example.test:11434'});const chat=service.createConversation({connectionId:connection.id,model:'test'});t.after(()=>{service.shutdown();fs.rmSync(directory,{recursive:true,force:true})});return{service,chat,connection,directory,provider,notes,requests}}
async function finished(f){for(let i=0;i<100;i++){if(!f.service.runs.size)return;await new Promise(r=>setTimeout(r,5))}assert.fail('response did not finish')}
test('edit retains original suffix and references; versions restore following history after restart',async t=>{
 const f=fixture(t);await f.service.sendMessage({conversationId:f.chat.id,text:'Original question',noteIds:['note']});await finished(f);
 await f.service.sendMessage({conversationId:f.chat.id,text:'Follow-up'});await finished(f);
 const original=structuredClone(f.service.conversation(f.chat.id).messages),user=original[0];f.notes[0].body='Changed reference';
 await f.service.reviseMessage({conversationId:f.chat.id,messageId:user.id,text:'Edited question'});await finished(f);
 assert.match(JSON.stringify(f.requests.at(-1).messages),/Original reference/);assert.doesNotMatch(JSON.stringify(f.requests.at(-1).messages),/Changed reference|Follow-up/);
 const edited=f.service.snapshot().conversations[0].messages[0];assert.equal(edited.versions.length,2);assert.equal(edited.content,'Edited question');
 const restored=new ChatService({directory:f.directory,provider:f.provider});restored.selectMessageVersion({conversationId:f.chat.id,messageId:user.id,versionId:user.versionId??user.id});assert.equal(restored.conversation(f.chat.id).messages.length,4);assert.equal(restored.conversation(f.chat.id).messages[0].content,'Original question');restored.shutdown();
});
test('regenerate preserves user attachments, creates model provenance and durable alternate response',async t=>{
 const f=fixture(t);const imported=await f.service.attachments.importFiles([{name:'reference.txt',bytes:Buffer.from('FILE ORIGINAL')}]);await f.service.sendMessage({conversationId:f.chat.id,text:'Read',attachmentIds:imported.items.map(a=>a.id)});await finished(f);
 const response=f.service.conversation(f.chat.id).messages[1];await f.service.reviseMessage({conversationId:f.chat.id,messageId:response.id});await finished(f);
 const c=f.service.snapshot().conversations[0];assert.equal(c.messages.length,2);assert.equal(c.messages[1].versions.length,2);assert.equal(c.messages[1].model,'test');assert.equal(c.messages[1].provider,'ollama');assert.ok(c.messages[1].finishedAt>=c.messages[1].createdAt);assert.match(JSON.stringify(f.requests.at(-1).messages),/FILE ORIGINAL/);assert.equal(c.messages[0].attachments[0].text,undefined);
 const b=f.service.branchConversation({conversationId:c.id,messageId:c.messages[1].id});assert.notEqual(b.id,c.id);assert.equal(b.messages.length,2);assert.equal(f.service.conversation(c.id).messages[1].content,c.messages[1].content);
});
test('pins, archive, trash and drafts persist without changing project membership',t=>{
 const f=fixture(t),p=f.service.saveProject({name:'Project'});f.service.moveConversation({id:f.chat.id,projectId:p.id});f.service.updateProject({id:p.id,pinned:true});f.service.updateConversation({id:f.chat.id,pinned:true,archived:true});f.service.updateConversation({id:f.chat.id,deleted:true});f.service.saveDraft({id:f.chat.id,text:'Unsent',noteIds:['note'],tools:[]});
 const saved=new ChatStore(f.directory).load();assert.equal(saved.projects[0].pinned,true);assert.equal(saved.conversations[0].pinned,true);assert.ok(saved.conversations[0].deletedAt);assert.equal(saved.drafts[f.chat.id].text,'Unsent');f.service.updateConversation({id:f.chat.id,deleted:false,archived:false});assert.equal(f.service.conversation(f.chat.id).projectId,p.id);
});
test('invalid version and active response lifecycle operations leave history unchanged',async t=>{
 const f=fixture(t);await f.service.sendMessage({conversationId:f.chat.id,text:'Question'});await finished(f);const before=structuredClone(f.service.state);assert.throws(()=>f.service.selectMessageVersion({conversationId:f.chat.id,messageId:'missing',versionId:'missing'}));assert.deepEqual(f.service.state,before);
 f.provider.streamChat=()=>new Promise(()=>{});await f.service.sendMessage({conversationId:f.chat.id,text:'Running'});assert.throws(()=>f.service.updateConversation({id:f.chat.id,deleted:true}),/stop/i);await assert.rejects(f.service.reviseMessage({conversationId:f.chat.id,messageId:before.conversations[0].messages[0].id,text:'No'}),/stop|running/i);f.service.stop(f.chat.id);
});
test('source links restore messages inside hidden ancestor paths and search finds them',async t=>{
 const f=fixture(t);await f.service.sendMessage({conversationId:f.chat.id,text:'First'});await finished(f);await f.service.sendMessage({conversationId:f.chat.id,text:'Hidden special follow-up'});await finished(f);const old=structuredClone(f.service.conversation(f.chat.id).messages),last=old[3];await f.service.reviseMessage({conversationId:f.chat.id,messageId:old[0].id,text:'Different beginning'});await finished(f);
 const result=f.service.searchConversations({query:'special follow-up',scope:'active'});assert.equal(result[0].messageId,old[2].id);
 f.service.selectMessageVersion({conversationId:f.chat.id,messageId:last.id,versionId:last.versionId});assert.equal(f.service.conversation(f.chat.id).messages[2].content,'Hidden special follow-up');assert.equal(f.service.conversation(f.chat.id).messages[3].content,last.content);
});
test('new-chat draft transfer is atomic and survives a failed or successful send',async t=>{
 const f=fixture(t),a=(await f.service.attachments.importFiles([{name:'draft.txt',bytes:Buffer.from('draft attachment')}])).items[0];f.service.saveDraft({id:'new:general',text:'Draft',noteIds:[],attachmentIds:[a.id]});const c=f.service.createConversation({connectionId:f.connection.id,model:'test',draftFrom:'new:general'});assert.equal(f.service.state.drafts['new:general'],undefined);assert.equal(f.service.state.drafts[c.id].text,'Draft');await f.service.sendMessage({conversationId:c.id,text:'Draft',attachmentIds:[a.id]});await finished(f);assert.equal(f.service.state.drafts[c.id],undefined);
});
test('regeneration before a later image does not require a vision model',async t=>{
 const f=fixture(t);await f.service.sendMessage({conversationId:f.chat.id,text:'Text only'});await finished(f);const original=f.service.conversation(f.chat.id).messages[1];f.service.change(s=>{s.conversations[0].messages.push({id:'later',role:'user',content:'Image',thinking:'',status:'complete',createdAt:Date.now(),context:[],error:'',attachments:[{id:'image',name:'test.jpg',kind:'image',size:3,mime:'image/jpeg',preview:'data:image/jpeg;base64,YWJj',image:'YWJj',width:1,height:1}]});return null});f.provider.supportsImages=async()=>false;await f.service.reviseMessage({conversationId:f.chat.id,messageId:original.id});await finished(f);assert.equal(f.service.conversation(f.chat.id).messages.length,2);
});
test('project search includes extracted file text and context inspection matches provider references',async t=>{
 const f=fixture(t),p=f.service.saveProject({name:'Context',instructions:'Be concise.'}),a=(await f.service.attachments.importFiles([{name:'reference.txt',bytes:Buffer.from('Secret search word: apricot')}])).items[0];f.service.addProjectFiles({id:p.id,attachmentIds:[a.id]});assert.equal(f.service.searchProjectFiles({id:p.id,query:'apricot'})[0].id,a.id);f.service.moveConversation({id:f.chat.id,projectId:p.id});const info=f.service.inspectContext({conversationId:f.chat.id,text:'Question',noteIds:['note']});assert.ok(info.referenceBytes>30);assert.equal(info.error,'');await f.service.sendMessage({conversationId:f.chat.id,text:'Question',noteIds:['note']});await finished(f);assert.equal(info.conversationBytes,Buffer.byteLength(JSON.stringify(f.requests[0].messages)));
});
