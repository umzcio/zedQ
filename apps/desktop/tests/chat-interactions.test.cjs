'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
function fixture(){
 const host={state:{conversations:[{id:'chat',messages:[{id:'reply',interactions:[]}]}]},runs:new Map(),change(fn){const next=structuredClone(this.state);const result=fn(next);if(this.failSave)throw Error('disk full');this.state=next;return result},conversation(id,s=this.state){const c=s.conversations.find(c=>c.id===id);if(!c)throw Error('missing');return c},snapshot(){return structuredClone(this.state)},pauseConversationQueue(id,reason){this.paused={id,reason}}};
 const run={assistantId:'reply',controller:new AbortController()};host.runs.set('chat',run);
 const {ChatInteractions}=require('../electron/chat-interactions.cjs');const service=new ChatInteractions(host);return{host,run,service};
}
test('clarification waits for explicit validated answer, survives snapshot and rejects replay',async()=>{
 const {host,run,service}=fixture();let completed=false;
 const pending=service.request('chat',run,{kind:'clarification',question:'Which audience?',options:['Students','Staff']}).then(r=>{completed=true;return r});
 assert.equal(completed,false);const card=host.snapshot().conversations[0].messages[0].interactions[0];assert.equal(card.status,'waiting');
 assert.throws(()=>service.respond({conversationId:'chat',id:card.id,answer:''}),/answer/i);
 service.respond({conversationId:'chat',id:card.id,answer:'Staff'});assert.deepEqual(await pending,{answer:'Staff'});assert.equal(host.conversation('chat').messages[0].interactions[0].status,'answered');
 assert.throws(()=>service.respond({conversationId:'chat',id:card.id,answer:'Students'}),/no longer/i);
});
test('approval gates side effects and chat grant applies only to that named tool',async()=>{
 const {host,run,service}=fixture();host.conversation('chat').approvalMode='ask';let effects=0;
 const result=service.execute('chat',run,{name:'create_document',arguments:{title:'Poem',format:'docx'}},async()=>{effects++;return {ok:true}});
 assert.equal(effects,0);const card=host.conversation('chat').messages[0].interactions[0];assert.equal(card.tool,'create_document');
 service.respond({conversationId:'chat',id:card.id,decision:'chat'});assert.deepEqual(await result,{ok:true});assert.equal(effects,1);
 await service.execute('chat',run,{name:'create_document',arguments:{}},async()=>{effects++;return {ok:true}});assert.equal(effects,2);
 const denied=service.execute('chat',run,{name:'revise_document',arguments:{}},async()=>{effects++;return{ok:true}});const second=host.conversation('chat').messages[0].interactions.at(-1);service.respond({conversationId:'chat',id:second.id,decision:'deny'});assert.match((await denied).error,/denied/i);assert.equal(effects,2);assert.equal(host.conversation('chat').queue.paused,true);
});
test('auto permits requested document work, reads never ask; invalid clarification cannot run',async()=>{
 const {host,run,service}=fixture();let effects=0;await service.execute('chat',run,{name:'create_document',arguments:{}},async()=>{effects++;return{ok:true}});host.conversation('chat').approvalMode='ask';await service.execute('chat',run,{name:'read_document',arguments:{}},async()=>{effects++;return{}});assert.equal(effects,2);assert.equal(host.conversation('chat').messages[0].interactions.length,0);
 await assert.rejects(service.execute('chat',run,{name:'request_user_input',arguments:{question:'',options:[]}},async()=>{}),/question/i);
});
test('save failure leaves decision pending and abort cancels without effects',async()=>{
 const {host,run,service}=fixture();host.conversation('chat').approvalMode='ask';let effects=0;
 const pending=service.execute('chat',run,{name:'create_document',arguments:{}},async()=>{effects++});const card=host.conversation('chat').messages[0].interactions[0];host.failSave=true;
 assert.throws(()=>service.respond({conversationId:'chat',id:card.id,decision:'once'}),/disk full/);assert.equal(host.conversation('chat').messages[0].interactions[0].status,'waiting');host.failSave=false;
 service.cancelRun('chat');await assert.rejects(pending,/stopped|cancelled/i);assert.equal(effects,0);assert.equal(host.conversation('chat').messages[0].interactions[0].status,'cancelled');
});
test('stale run cannot resolve, setting policy during run is rejected',async()=>{
 const {host,run,service}=fixture();assert.throws(()=>service.setMode({conversationId:'chat',mode:'ask'}),/stop|running/i);
 const pending=service.request('chat',run,{kind:'clarification',question:'Which format?'});const card=host.conversation('chat').messages[0].interactions[0];host.runs.delete('chat');assert.throws(()=>service.respond({conversationId:'chat',id:card.id,answer:'docx'}),/no longer/i);service.cancelRun('chat');await assert.rejects(pending);
 host.runs.clear();service.setMode({conversationId:'chat',mode:'ask'});assert.equal(host.conversation('chat').approvalMode,'ask');
});
