'use strict';
const {randomUUID}=require('node:crypto');
const isText=(v,max)=>typeof v==='string'&&v.trim().length>0&&!v.includes('\0')&&Buffer.byteLength(v)<=max;
const QUESTION_TOOL={name:'request_user_input',description:'Pause this request and ask the user a concise clarifying question when missing information would materially change the result. Optional choices supplement a free-text answer. Do not ask for routine confirmations or use this to approve tool actions.',parameters:{type:'object',properties:{question:{type:'string'},options:{type:'array',items:{type:'string'},maxItems:4}},required:['question'],additionalProperties:false}};
const INTERACTION_INSTRUCTIONS=' When missing information would materially change the result, use request_user_input to ask one concise question and wait for its answer. Otherwise make a reasonable assumption and proceed. Do not ask permission for routine work the user already requested. The app independently enforces tool permissions; you cannot grant or bypass them. A denied tool must not be retried or replaced with another method to perform the same action.';
function validInteractions(value){return value===undefined||Array.isArray(value)&&value.length<=20&&new Set(value.map(x=>x?.id)).size===value.length&&value.every(x=>x&&isText(x.id,256)&&['clarification','approval'].includes(x.kind)&&isText(x.question,1500)&&['waiting','answered','denied','cancelled'].includes(x.status)&&Number.isFinite(x.createdAt)&&x.createdAt>=0&&(x.options===undefined||Array.isArray(x.options)&&x.options.length<=4&&x.options.every(o=>isText(o,200)))&&(x.answer===undefined||isText(x.answer,8000))&&(x.tool===undefined||isText(x.tool,128))&&(x.detail===undefined||isText(x.detail,2000)));}
function cancelStoredInteractions(state){let changed=false;for(const c of state.conversations)for(const m of c.messages)for(const i of m.interactions??[])if(i.status==='waiting'){i.status='cancelled';changed=true}return changed;}
class ChatInteractions{
 constructor(host){this.host=host;this.pending=new Map();this.grants=new Map();}
 waitState(run){if(!run.userWait){let elapsed=0,start=null;const listeners=new Set();run.userWait={elapsedMs:()=>elapsed+(start===null?0:Date.now()-start),isWaiting:()=>start!==null,subscribe:fn=>{listeners.add(fn);return()=>listeners.delete(fn)},set:waiting=>{if(waiting&&start===null)start=Date.now();else if(!waiting&&start!==null){elapsed+=Date.now()-start;start=null}for(const fn of listeners)fn()}}}return run.userWait;}
 assertRun(id,run){if(this.host.runs.get(id)!==run||run.controller.signal.aborted)throw Error('This request was stopped.');}
 request(conversationId,run,data){
  this.assertRun(conversationId,run);
  const card={...data,id:randomUUID(),status:'waiting',createdAt:Date.now()};
  if(!validInteractions([card]))throw Error('Provide a valid question and up to four short choices.');
  let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no});
  this.host.change(s=>{const m=this.host.conversation(conversationId,s).messages.find(m=>m.id===run.assistantId);if(!m)throw Error('Response no longer exists.');m.interactions??=[];if(m.interactions.length>=20)throw Error('This response has reached its question limit.');m.interactions.push(card);return null});
  const abort=()=>this.cancelRun(conversationId);this.pending.set(card.id,{conversationId,run,card,resolve,reject,abort});run.controller.signal.addEventListener('abort',abort,{once:true});this.waitState(run).set(true);
  return promise;
 }
 respond({conversationId,id,answer,decision}={}){
  const entry=this.pending.get(id);if(!entry||entry.conversationId!==conversationId||this.host.runs.get(conversationId)!==entry.run||entry.run.controller.signal.aborted)throw Error('This question is no longer waiting for an answer.');
  const approval=entry.card.kind==='approval';
  if(approval&&!['once','chat','deny'].includes(decision)||!approval&&!isText(answer,8000))throw Error(approval?'Choose Allow once, Allow for this chat, or Deny.':'Enter an answer up to 8 KB.');
  if(approval&&answer!==undefined||!approval&&decision!==undefined)throw Error('Choose the matching response type.');
  this.host.change(s=>{const c=this.host.conversation(conversationId,s),card=c.messages.find(m=>m.id===entry.run.assistantId)?.interactions?.find(i=>i.id===id);if(!card||card.status!=='waiting')throw Error('This question is no longer waiting.');card.status=decision==='deny'?'denied':'answered';card.answer=approval?(decision==='deny'?'Denied':decision==='chat'?'Allowed for this chat':'Allowed once'):answer.trim();if(decision==='deny'){c.queue??={items:[],paused:false,error:''};c.queue.paused=true;c.queue.error='Queue paused because a tool action was denied.'}return null});
  if(decision==='chat'){const grants=this.grants.get(conversationId)??new Set();grants.add(entry.card.tool);this.grants.set(conversationId,grants)}
  if(decision==='deny')entry.run.actionsDenied=true;
  this.pending.delete(id);entry.run.controller.signal.removeEventListener('abort',entry.abort);this.waitState(entry.run).set(false);entry.resolve(approval?{allowed:decision!=='deny'}:{answer:answer.trim()});if(decision==='deny')this.host.finish?.(conversationId,'stopped');return this.host.snapshot();
 }
 cancelRun(conversationId){for(const [id,entry]of this.pending)if(entry.conversationId===conversationId){this.pending.delete(id);entry.run.controller.signal.removeEventListener('abort',entry.abort);this.waitState(entry.run).set(false);const c=this.host.state.conversations.find(c=>c.id===conversationId),card=c?.messages.find(m=>m.id===entry.run.assistantId)?.interactions?.find(i=>i.id===id);if(card?.status==='waiting')card.status='cancelled';entry.reject(Error('The request was stopped; this question was cancelled.'));}}
 setMode({conversationId,mode}={}){if(!['auto','ask'].includes(mode))throw Error('Choose a valid approval mode.');if(this.host.runs.has(conversationId))throw Error('Stop the running response before changing approvals.');this.host.change(s=>{this.host.conversation(conversationId,s).approvalMode=mode;return null});this.grants.delete(conversationId);return this.host.snapshot();}
 async approve(conversationId,run,tool,detail,{required=false,question}={}){this.assertRun(conversationId,run);if(!required&&this.host.conversation(conversationId).approvalMode!=='ask'||this.grants.get(conversationId)?.has(tool))return true;const result=await this.request(conversationId,run,{kind:'approval',tool,question:question??`Allow ${tool.replace(/^hosted:/,'').replaceAll('_',' ')}?`,...(detail?{detail:detail.slice(0,2000)}:{})});this.assertRun(conversationId,run);return result.allowed;}
 async execute(conversationId,run,call,execute){
  this.assertRun(conversationId,run);
  if(call.name==='request_user_input'){
   const args=call.arguments;if(!args||Object.keys(args).some(k=>!['question','options'].includes(k))||!isText(args.question,1500)||args.options!==undefined&&(!Array.isArray(args.options)||args.options.length>4||!args.options.every(o=>isText(o,200))))throw Error('Provide a valid question and up to four short choices.');
   return this.request(conversationId,run,{kind:'clarification',question:args.question.trim(),...(args.options?{options:args.options}:{})});
  }
  if(call.name!=='read_document'){
   if(run.actionsDenied)return {error:'The user denied tool actions for this request. Do not retry or use another tool.'};
   const args=call.arguments??{},detail=Object.entries(args).filter(([key])=>['title','format','artifactId','baseVersionId','typography'].includes(key)).map(([k,v])=>`${k}: ${typeof v==='string'?v:JSON.stringify(v)}`).join('\n');
   if(!await this.approve(conversationId,run,call.name,detail||'Create or update a document in this chat.'))return {error:'The user denied this action. Do not retry it or perform it through another tool.'};
  }
  this.assertRun(conversationId,run);return execute(call);
 }
}
module.exports={ChatInteractions,QUESTION_TOOL,INTERACTION_INSTRUCTIONS,validInteractions,cancelStoredInteractions};
