'use strict';
const {selectedConnectors}=require('./chat-connectors.cjs');
const {randomUUID}=require('node:crypto');
const {selectedTools}=require('./chat-tools.cjs');
const {validateHostedTools}=require('@zq/providers');
const {resolveSkills}=require('./skill-context.cjs');
const {discoveryCatalog}=require('./skill-activation.cjs');
const {validQueuedMessage,queueContextBytes}=require('./chat-queue-schema.cjs');
const text=(value,max)=>typeof value==='string'&&Buffer.byteLength(value)<=max&&!value.includes('\0')&&value.isWellFormed();
const pumps=new WeakMap();
const errorText=error=>Buffer.from(String(error?.message||error||'The queued message could not be sent.')).toString('utf8').replace(/\0/g,'').slice(0,1000);
const waiting=conversation=>conversation.messages.some(message=>message.interactions?.some(interaction=>interaction.status==='waiting'));
const eligible=(host,conversation)=>conversation&&conversation.queue?.items.length&&!conversation.queue.paused&&!conversation.deletedAt&&!conversation.archivedAt&&!host.runs.has(conversation.id)&&!host.researchBusy?.(conversation.id)&&!waiting(conversation);
function consumeQueuedItem(conversation,expected){
 const queue=conversation.queue;
 if(!queue||queue.paused||!queue.items.length||JSON.stringify(queue.items[0])!==JSON.stringify(expected))throw Object.assign(Error('The queued message changed before it could start.'),{code:'QUEUE_CHANGED'});
 queue.items.shift();queue.error='';
}
function pauseQueuesOnRestart(state){let changed=false;for(const conversation of state.conversations??[])if(conversation.queue?.items.length&&!conversation.queue.paused){conversation.queue.paused=true;conversation.queue.error||='Queue paused after reopening zQ. Resume when ready.';changed=true}return changed}
function queueAttachments(conversation){return(conversation.queue?.items??[]).flatMap(item=>[...item.attachments,...(item.projectContext?.files??[]),...item.skillContext.flatMap(skill=>skill.files)])}
function validatePrompt(host,conversation,item){
 if(!validQueuedMessage(item))throw Error('Queued messages need up to 64 KB of text, at most ten files and notes, and 100 KB of selected context.');
 host.prompt([...conversation.messages,{role:'user',content:item.text.trim()||'Please review the attached material.',context:item.context,attachments:item.attachments,skillContext:item.skillContext,skillCatalog:item.skillCatalog}],item.projectContext,item.tools);
}
const methods={
 enqueueMessage(input={}){
  if(this.shuttingDown)throw Error('The app is closing. Reopen it before queueing messages.');
  const {conversationId,text:content,noteIds=[],attachmentIds=[],tools:requestedTools=[],skillIds,artifactContext,connectorIds}=input;
  if(!text(content,64000)||!Array.isArray(noteIds)||noteIds.length>10||!noteIds.every(id=>text(id,256)&&id))throw Error('Enter a message up to 64 KB and select at most ten notes.');
  const conversation=this.conversation(conversationId);if(conversation.deletedAt||conversation.archivedAt)throw Error('Restore this chat before queueing messages.');
  const connection=this.state.connections.find(connection=>connection.id===conversation.connectionId);if(!connection||!text(conversation.model,512)||!conversation.model.trim())throw Error('Choose a connection and model first.');this.connections.assertAvailable(connection.id);
  const tools=selectedTools(requestedTools);validateHostedTools(connection.provider,conversation.model,tools);
  const attachments=this.attachments.resolve(attachmentIds),notes=this.getNotes(),context=[...new Set(noteIds)].map(id=>{const note=notes.find(note=>note.id===id);if(!note)throw Error('An attached note no longer exists.');return{id:note.id,title:note.title,body:note.body}}),project=conversation.projectId?this.project(conversation.projectId):null;
  const item={connectorIds:selectedConnectors(this.connectors,connectorIds===undefined?conversation.connectorIds:connectorIds,project),id:randomUUID(),text:content,createdAt:Date.now(),connectionId:connection.id,connectionName:connection.name,connectionUpdatedAt:connection.updatedAt??0,model:conversation.model,tools,context,attachments,skillCatalog:discoveryCatalog(this.state,skillIds===undefined?conversation.skillIds:skillIds,project),skillContext:resolveSkills(this.state,skillIds===undefined?conversation.skillIds:skillIds,project),projectContext:structuredClone(project),...(artifactContext!==undefined?{artifactContext:structuredClone(artifactContext)}:{})};
  validatePrompt(this,conversation,item);
  this.change(state=>{const target=this.conversation(conversationId,state);target.queue??={items:[],paused:false,error:''};if(target.queue.items.length>=20)throw Error('Queue up to 20 messages per chat.');target.queue.items.push(item);if(skillIds!==undefined)target.skillIds=structuredClone(skillIds);if(connectorIds!==undefined)target.connectorIds=structuredClone(connectorIds);if(state.drafts)delete state.drafts[conversationId];target.updatedAt=Date.now();return null});
  for(const attachment of attachments)this.attachments.discard(attachment.id);void this.drainQueues();return this.snapshot();
 },
 updateQueuedMessage({conversationId,id,text:content,move,remove}={}){
  if(remove!==undefined&&typeof remove!=='boolean'||move!==undefined&&!['up','down'].includes(move)||[content!==undefined,move!==undefined,remove===true].filter(Boolean).length!==1)throw Error('Choose one queue action.');
  this.change(state=>{const conversation=this.conversation(conversationId,state),queue=conversation.queue,index=queue?.items.findIndex(item=>item.id===id)??-1;if(index<0)throw Error('Queued message not found.');
   if(remove)queue.items.splice(index,1);else if(content!==undefined){const next={...queue.items[index],text:content};validatePrompt(this,conversation,next);queue.items[index]=next}else{const target=move==='up'?index-1:index+1;if(target>=0&&target<queue.items.length)[queue.items[index],queue.items[target]]=[queue.items[target],queue.items[index]]}
   conversation.updatedAt=Date.now();return null;
  });void this.drainQueues();return this.snapshot();
 },
 setQueuePaused({conversationId,paused}={}){
  if(typeof paused!=='boolean')throw Error('Choose whether to pause this queue.');
  this.change(state=>{const conversation=this.conversation(conversationId,state);if(!paused&&(conversation.archivedAt||conversation.deletedAt))throw Error('Restore this chat before resuming its queue.');conversation.queue??={items:[],paused:true,error:''};conversation.queue.paused=paused;if(!paused)conversation.queue.error='';return null});if(!paused)void this.drainQueues();return this.snapshot();
 },
 // Used inside the host's finish/decision persistence boundary.
 pauseConversationQueue(conversationId,error=''){
  const queue=this.state.conversations.find(conversation=>conversation.id===conversationId)?.queue;if(!queue)return false;
  const message=error?errorText(error):'',changed=!queue.paused||queue.error!==message;queue.paused=true;queue.error=message;return changed;
 },
 drainQueues(){
  if(this.shuttingDown)return Promise.resolve();
  let pump=pumps.get(this);if(!pump){pump={running:null,requested:false};pumps.set(this,pump)}pump.requested=true;if(pump.running)return pump.running;
  const epoch=this.epoch;
  const run=Promise.resolve().then(async()=>{
   do{
    pump.requested=false;
    for(const snapshot of [...this.state.conversations]){
     if(epoch!==this.epoch||this.shuttingDown)return;if(this.runs.size>=3)break;
     const conversation=this.state.conversations.find(current=>current.id===snapshot.id);if(!eligible(this,conversation))continue;
     const item=structuredClone(conversation.queue.items[0]);
     try{await this.sendQueuedMessage(conversation.id,item)}catch(error){
      if(epoch!==this.epoch||this.shuttingDown)return;
      if(error?.code==='QUEUE_CHANGED'){if(eligible(this,this.state.conversations.find(current=>current.id===conversation.id)))pump.requested=true;continue}
      if(this.runs.size>=3||this.runs.has(conversation.id))continue;
      if(!this.state.conversations.some(current=>current.id===conversation.id))continue;
      try{this.change(state=>{const target=this.conversation(conversation.id,state);if(target.queue){target.queue.paused=true;target.queue.error=errorText(error)}return null})}
      catch(storageError){this.pauseConversationQueue(conversation.id,storageError);this.publish()}
     }
    }
   }while(pump.requested&&epoch===this.epoch&&!this.shuttingDown);
  });const complete=run.finally(()=>{if(pump.running===complete){pump.running=null;if(pump.requested&&epoch===this.epoch&&!this.shuttingDown)return this.drainQueues()}});pump.running=complete;return complete;
 }
};
module.exports={methods,consumeQueuedItem,pauseQueuesOnRestart,queueAttachments,queueContextBytes};
