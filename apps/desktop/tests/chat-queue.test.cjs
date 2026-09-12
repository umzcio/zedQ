'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {ChatService}=require('../electron/chat-service.cjs');
const {methods,consumeQueuedItem,pauseQueuesOnRestart}=require('../electron/chat-queue.cjs');
const {validQueue,validQueuedMessage,publicQueue}=require('../electron/chat-queue-schema.cjs');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
async function settle(predicate){for(let i=0;i<1000;i++){if(predicate())return;await tick()}assert.fail('Queue did not settle')}
async function fixture(t,options={}){
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'zq-chat-queue-')),requests=[],pending=[];let notes=[{id:'note',title:'Original note',body:'Original note text'}];
 const provider={streamChat:async request=>{requests.push(request);await new Promise((resolve,reject)=>{pending.push({resolve:()=>{request.onDelta({content:'Reply '+requests.length});resolve()},reject});request.signal.addEventListener('abort',()=>resolve(),{once:true})})}};
 const chat=new ChatService({directory,provider,getNotes:()=>notes,...options});t.after(()=>{chat.shutdown();fs.rmSync(directory,{recursive:true,force:true})});
 const connection=await chat.saveConnection({provider:'ollama',name:'Queue fixture',baseUrl:'http://localhost:11434'}),conversation=chat.createConversation({connectionId:connection.id,model:'fixture'});
 return{chat,conversation,connection,directory,requests,pending,changeNotes:value=>notes=value};
}

test('queue schema bounds snapshots and public results hide private attachment bodies',()=>{
 const file={id:'f',name:'ref.txt',kind:'text',mime:'text/plain',size:4,text:'body',preview:''},item={id:'q',text:'Queued text',createdAt:1,connectionId:'connection',connectionName:'Fixture',connectionUpdatedAt:0,model:'fixture',tools:[],context:[],attachments:[file],skillContext:[],projectContext:null};
 assert.equal(validQueuedMessage(item),true);assert.equal(validQueue(undefined),true);assert.equal(validQueue({items:[item],paused:false,error:''}),true);assert.equal(validQueue({items:[item,item],paused:false,error:''}),false);assert.equal(validQueuedMessage({...item,text:'x'.repeat(64001)}),false);assert.equal(validQueuedMessage({...item,tools:['web_search','web_search']}),false);assert.equal(publicQueue({items:[item],paused:false,error:''}).items[0].attachments[0].text,undefined);assert.equal(item.attachments[0].text,'body');
});

test('enqueue freezes context and removes the draft atomically while the current response keeps running',async t=>{
 const f=await fixture(t),{chat,conversation:c}=f;await chat.sendMessage({conversationId:c.id,text:'First'});await settle(()=>f.requests.length===1);
 const skill=chat.saveSkill({name:'Original skill',instructions:'Original instructions'}),project=chat.saveProject({name:'Project',instructions:'Original project'});chat.moveConversation({id:c.id,projectId:project.id});const imported=await chat.attachments.importFiles([{name:'ref.txt',bytes:Buffer.from('Original file')}]);chat.saveDraft({id:c.id,text:'Queued',noteIds:['note'],attachmentIds:imported.items.map(file=>file.id),skillIds:[skill.id]});
 chat.enqueueMessage({conversationId:c.id,text:'Queued',noteIds:['note'],attachmentIds:imported.items.map(file=>file.id),skillIds:[skill.id]});assert.equal(chat.state.drafts[c.id],undefined);assert.equal(f.requests.length,1);const queued=structuredClone(chat.conversation(c.id).queue.items[0]);
 f.changeNotes([{id:'note',title:'Changed note',body:'Changed note text'}]);chat.saveSkill({id:skill.id,instructions:'Changed instructions'});chat.deleteSkill(skill.id);chat.saveProject({id:project.id,instructions:'Changed project'});chat.deleteProject(project.id);assert.equal(queued.context[0].body,'Original note text');assert.equal(queued.attachments[0].text,'Original file');assert.equal(chat.conversation(c.id).queue.items[0].skillContext[0].instructions,'Original instructions');assert.equal(chat.snapshot().conversations[0].queue.items[0].attachments[0].text,undefined);
 f.pending[0].resolve();await settle(()=>f.requests.length===2);assert.match(f.requests[1].messages[0].content,/Original instructions|Original project/);assert.doesNotMatch(f.requests[1].messages[0].content,/Changed/);assert.match(f.requests[1].messages.at(-1).content,/Original note text/);assert.equal(f.requests[1].messages.some(message=>message.content==='Reply 1'),true);assert.equal(chat.conversation(c.id).queue.items.length,0);f.pending[1].resolve();await settle(()=>!chat.runs.size);
});

test('queue edits, moves and removes items without changing captured context; capacity is atomic',async t=>{
 const {chat,conversation:c}=await fixture(t);chat.setQueuePaused({conversationId:c.id,paused:true});for(let i=0;i<20;i++)chat.enqueueMessage({conversationId:c.id,text:'Item '+i});const original=structuredClone(chat.conversation(c.id).queue);assert.throws(()=>chat.enqueueMessage({conversationId:c.id,text:'Overflow'}),/20/);assert.deepEqual(chat.conversation(c.id).queue,original);
 const first=original.items[0].id,second=original.items[1].id;chat.updateQueuedMessage({conversationId:c.id,id:first,text:'Edited'});chat.updateQueuedMessage({conversationId:c.id,id:second,move:'up'});assert.equal(chat.conversation(c.id).queue.items[0].id,second);assert.equal(chat.conversation(c.id).queue.items[1].text,'Edited');chat.updateQueuedMessage({conversationId:c.id,id:first,remove:true});assert.equal(chat.conversation(c.id).queue.items.length,19);assert.throws(()=>chat.updateQueuedMessage({conversationId:c.id,id:second,text:'x'.repeat(64001)}));
});

test('stop, provider error, and restart pause remaining queue until explicit resume',async t=>{
 const f=await fixture(t),{chat,conversation:c}=f;chat.enqueueMessage({conversationId:c.id,text:'One'});chat.enqueueMessage({conversationId:c.id,text:'Two'});await settle(()=>f.requests.length===1);chat.stop(c.id);await tick();assert.equal(f.requests.length,1);assert.equal(chat.conversation(c.id).queue.paused,true);assert.equal(chat.conversation(c.id).queue.items.length,1);
 chat.setQueuePaused({conversationId:c.id,paused:false});await settle(()=>f.requests.length===2);chat.enqueueMessage({conversationId:c.id,text:'Three'});f.pending[1].reject(Error('Provider unavailable'));await settle(()=>!chat.runs.size);assert.equal(chat.conversation(c.id).queue.paused,true);assert.equal(chat.conversation(c.id).queue.items.length,1);
 chat.change(state=>{state.conversations[0].queue.paused=false});const restarted=new ChatService({directory:f.directory,provider:{streamChat:()=>assert.fail('Restart must not send')}});assert.equal(restarted.conversation(c.id).queue.paused,true);assert.equal(restarted.conversation(c.id).queue.items.length,1);restarted.shutdown();
});

test('dequeue is atomic with history insertion and duplicate pumps cannot resend an admitted item',async t=>{
 const f=await fixture(t),{chat,conversation:c}=f;chat.setQueuePaused({conversationId:c.id,paused:true});chat.enqueueMessage({conversationId:c.id,text:'Once'});const saved=chat.store.save.bind(chat.store);let fail=true;chat.store.save=state=>{if(fail&&state.conversations[0].messages.length)throw Error('Disk full');return saved(state)};chat.setQueuePaused({conversationId:c.id,paused:false});await chat.drainQueues();assert.equal(chat.conversation(c.id).messages.length,0);assert.equal(chat.conversation(c.id).queue.items.length,1);assert.equal(chat.conversation(c.id).queue.paused,true);assert.equal(f.requests.length,0);
 fail=false;chat.setQueuePaused({conversationId:c.id,paused:false});await Promise.all([chat.drainQueues(),chat.drainQueues(),chat.drainQueues()]);await settle(()=>f.requests.length===1);assert.equal(chat.conversation(c.id).queue.items.length,0);assert.equal(chat.conversation(c.id).messages.filter(message=>message.role==='user').length,1);f.pending[0].resolve();await settle(()=>!chat.runs.size);
});

test('changed connections retain queued items with an actionable paused error',async t=>{
 const f=await fixture(t),{chat,conversation:c}=f;chat.setQueuePaused({conversationId:c.id,paused:true});chat.enqueueMessage({conversationId:c.id,text:'Pinned choice'});await chat.saveConnection({...f.connection,name:'Changed connection',baseUrl:'http://localhost:11435'});chat.setQueuePaused({conversationId:c.id,paused:false});await chat.drainQueues();assert.equal(chat.conversation(c.id).queue.paused,true);assert.match(chat.conversation(c.id).queue.error,/connection|changed/i);assert.equal(chat.conversation(c.id).queue.items.length,1);assert.equal(f.requests.length,0);
});

test('queue consumption rejects paused or stale heads and restart pausing is idempotent',()=>{
 const item={id:'q',text:'One'},conversation={queue:{items:[item],paused:true,error:''}};assert.throws(()=>consumeQueuedItem(conversation,item),error=>error.code==='QUEUE_CHANGED');conversation.queue.paused=false;assert.throws(()=>consumeQueuedItem(conversation,{...item,text:'Old'}),error=>error.code==='QUEUE_CHANGED');const state={conversations:[conversation]};assert.equal(pauseQueuesOnRestart(state),true);assert.equal(pauseQueuesOnRestart(state),false);conversation.queue.paused=false;consumeQueuedItem(conversation,structuredClone(item));assert.equal(conversation.queue.items.length,0);
});

test('a dispatch request arriving as the previous pump finishes is not lost',async()=>{
 let started=0;const conversation={id:'c',messages:[],queue:{items:[{id:'q',text:'Queued'}],paused:false,error:''}},host={epoch:0,state:{conversations:[]},runs:new Map(),drainQueues:methods.drainQueues,async sendQueuedMessage(id,item){started++;consumeQueuedItem(conversation,item);this.runs.set(id,{})}};
 const original=host.drainQueues();queueMicrotask(()=>{host.state.conversations.push(conversation);void host.drainQueues()});await original;await tick();assert.equal(started,1);
});

test('queues share three global run slots and start waiting chats after a successful response',async t=>{
 const f=await fixture(t),conversations=[f.conversation];for(let i=0;i<3;i++)conversations.push(f.chat.createConversation({connectionId:f.connection.id,model:'fixture'}));for(const conversation of conversations)f.chat.enqueueMessage({conversationId:conversation.id,text:'For '+conversation.id});
 await settle(()=>f.requests.length===3);assert.equal(f.chat.runs.size,3);assert.equal(f.chat.state.conversations.reduce((sum,c)=>sum+(c.queue?.items.length??0),0),1);f.pending[0].resolve();await settle(()=>f.requests.length===4);assert.equal(f.chat.runs.size,3);for(const entry of f.pending.slice(1))entry.resolve();await settle(()=>!f.chat.runs.size);
});

test('edits during provider preparation invalidate the old head and send the current text once',async t=>{
 const f=await fixture(t),{chat,conversation:c}=f;chat.setQueuePaused({conversationId:c.id,paused:true});chat.enqueueMessage({conversationId:c.id,text:'Old text'});const id=chat.conversation(c.id).queue.items[0].id,adapter=chat.connections.adapter.bind(chat.connections);let release,held=false;
 chat.connections.adapter=async connection=>{if(!held){held=true;await new Promise(resolve=>release=resolve)}return adapter(connection)};
 chat.setQueuePaused({conversationId:c.id,paused:false});await settle(()=>!!release);chat.updateQueuedMessage({conversationId:c.id,id,text:'Current text'});release();await chat.drainQueues();await settle(()=>f.requests.length===1);assert.equal(f.requests[0].messages.at(-1).content,'Current text');assert.equal(chat.conversation(c.id).messages.filter(message=>message.role==='user').length,1);f.pending[0].resolve();await settle(()=>!chat.runs.size);
});

test('a direct send cannot bypass an already queued item during provider preparation',async t=>{
 const f=await fixture(t),{chat,conversation:c}=f,adapter=chat.connections.adapter.bind(chat.connections);let release,held=false;chat.connections.adapter=async connection=>{if(!held){held=true;await new Promise(resolve=>release=resolve)}return adapter(connection)};
 chat.enqueueMessage({conversationId:c.id,text:'Queued'});await settle(()=>!!release);await assert.rejects(chat.sendMessage({conversationId:c.id,text:'Direct'}),/queue/i);release();await chat.drainQueues();await settle(()=>f.requests.length===1);assert.equal(f.requests[0].messages.at(-1).content,'Queued');assert.equal(chat.conversation(c.id).messages.filter(message=>message.role==='user').length,1);f.pending[0].resolve();await settle(()=>!chat.runs.size);
});

test('closing never fills a newly freed global run slot from another chat queue',async t=>{
 const f=await fixture(t),conversations=[f.conversation];for(let i=0;i<3;i++)conversations.push(f.chat.createConversation({connectionId:f.connection.id,model:'fixture'}));for(const conversation of conversations)f.chat.enqueueMessage({conversationId:conversation.id,text:'For '+conversation.id});await settle(()=>f.requests.length===3);
 f.chat.shutdown();await tick();await tick();assert.equal(f.requests.length,3);assert.equal(f.chat.runs.size,0);assert.equal(f.chat.state.conversations.reduce((sum,c)=>sum+(c.queue?.items.length??0),0),1);
});

test('branching copies completed history without duplicating queued work',async t=>{
 const f=await fixture(t),{chat,conversation:c}=f;await chat.sendMessage({conversationId:c.id,text:'Original'});await settle(()=>f.requests.length===1);f.pending[0].resolve();await settle(()=>!chat.runs.size);chat.setQueuePaused({conversationId:c.id,paused:true});chat.enqueueMessage({conversationId:c.id,text:'Only for original'});const branch=chat.branchConversation({conversationId:c.id,messageId:chat.conversation(c.id).messages[0].id});assert.equal(branch.queue?.items.length??0,0);assert.equal(chat.conversation(c.id).queue.items.length,1);assert.equal(branch.messages[0].content,'Original');
});
