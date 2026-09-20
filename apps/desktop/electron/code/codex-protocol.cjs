// Codex app-server's published JSON-RPC protocol. Native thread IDs and storage
// remain owned by Codex; rendered history is never submitted as a new prompt.
const { fail } = require('./service-storage.cjs')
const { validNativeId } = require('./kimi-protocol.cjs')
class CodexProtocol {
  constructor({nativeId,cwd,send,event}) {
    Object.assign(this,{nativeId,cwd,send,event,buffer:'',serial:0,state:'starting',initialized:false,verified:false})
    this.requests=new Map();this.pending=new Map();this.items=new Map();this.dirty=new Set()
  }
  request(method,params,callback,onError) {const id=++this.serial;this.requests.set(id,{callback,onError});this.send({id,method,params})}
  initialize() {
    const fresh = !this.nativeId
    this.request('initialize',{clientInfo:{name:'zq',title:'zQ',version:'1.6.0'},capabilities:{experimentalApi:true}},()=>{
      this.send({method:'initialized'})
      this.request(this.nativeId?'thread/resume':'thread/start',this.nativeId?{threadId:this.nativeId,excludeTurns:true}:{cwd:this.cwd},r=>{
        if(!validNativeId(r.thread?.id)||(this.nativeId&&this.nativeId!==r.thread.id))fail('IDENTITY_MISMATCH')
        if(r.thread.cwd!==this.cwd)fail('IDENTITY_MISMATCH')
        this.nativeId=r.thread.id;this.model=r.model
        if(r.thread.status?.type==='active')fail('NATIVE_SESSION_IN_USE')
        // A new thread has no persisted rollout until its first turn. History
        // endpoints can reject it even though thread/start succeeded.
        if(fresh){this.initialized=this.verified=true;this.state='ready';return}
        this.request('thread/items/list',{threadId:this.nativeId,limit:200,sortDirection:'desc'},page=>{
          if(page.nextCursor)this.event({kind:'status',text:'Showing recent activity. Earlier history is retained by Codex.'})
          for(const entry of [...page.data].reverse())this.item(entry.item)
          this.flush();this.initialized=this.verified=true;this.state='ready'
        },()=>{
          // Older native versions lack item pagination; ask their own history
          // API instead of reading or reinterpreting rollout files ourselves.
          this.request('thread/read',{threadId:this.nativeId,includeTurns:true},history=>{
            if(history.thread?.id!==this.nativeId)fail('IDENTITY_MISMATCH')
            for(const turn of history.thread.turns||[])for(const item of turn.items||[])this.item(item)
            this.flush();this.initialized=this.verified=true;this.state='ready'
          })
        })
      })
    })
  }
  feed(data) {
    this.buffer+=data;let n
    while((n=this.buffer.indexOf('\n'))>=0){const line=this.buffer.slice(0,n);this.buffer=this.buffer.slice(n+1);if(!line.trim())continue
      if(Buffer.byteLength(line)>16*1024*1024)fail('PROTOCOL_TOO_LARGE')
      let m;try{m=JSON.parse(line)}catch{fail('INVALID_PROTOCOL')};this.receive(m)
    }
    if(Buffer.byteLength(this.buffer)>16*1024*1024)fail('PROTOCOL_TOO_LARGE')
  }
  flush(){clearTimeout(this.timer);this.timer=null;for(const id of this.dirty){const event=this.items.get(id);if(event)this.event({...event})}this.dirty.clear()}
  item(item) {
    if(!item?.id)return
    const event={eventId:'codex-'+item.id,kind:'tool',text:'',toolName:item.type}
    if(item.type==='userMessage'){event.kind='user';event.text=(item.content||[]).map(c=>c.type==='text'?c.text:`[${c.type}]`).join('\n')}
    else if(item.type==='agentMessage'||item.type==='plan'){event.kind='assistant';event.text=item.text||''}
    else if(item.type==='reasoning'){event.kind='thinking';event.text=[...(item.summary||[]),...(item.content||[])].join('\n')}
    else if(item.type==='hookPrompt')return
    else if(item.type==='commandExecution'){event.toolName='Run command';event.text=[item.command,item.aggregatedOutput].filter(Boolean).join('\n')}
    else if(item.type==='fileChange'){event.toolName='Edit files';event.text=(item.changes||[]).map(c=>`${c.path}\n${c.diff||''}`).join('\n')}
    else {event.text=item.text||item.status||item.review||item.type;if(item.arguments)event.input={arguments:item.arguments};if(item.result)event.text=JSON.stringify(item.result)}
    event.text=String(event.text).slice(-32000)
    this.items.set(item.id,event);this.dirty.add(item.id);this.flush()
    while(this.items.size>256)this.items.delete(this.items.keys().next().value)
  }
  receive(m) {
    if(!m||typeof m!=='object')fail('INVALID_PROTOCOL')
    if(!m.method){const r=this.requests.get(m.id);if(!r)return;this.requests.delete(m.id)
      if(m.error){if(r.onError)return r.onError(m.error);this.flush();this.state='error';this.event({kind:'error',text:String(m.error.message||'Codex request failed').slice(0,2000)});if(!this.initialized)fail('CODEX_LOAD_FAILED');return}return r.callback?.(m.result||{})}
    const p=m.params||{}
    if(p.threadId&&this.nativeId&&p.threadId!==this.nativeId)return // subagent notifications belong to their own threads
    if(m.id!==undefined){
      if(['item/commandExecution/requestApproval','item/fileChange/requestApproval','item/tool/requestUserInput'].includes(m.method)){
        const id=String(m.id);if(this.pending.size>=32)fail('PROTOCOL_TOO_LARGE');this.flush();this.pending.set(id,{id:m.id,method:m.method,params:p});this.state='approval'
        this.event({kind:p.questions?'question':'permission',requestId:id,text:p.reason||p.command||'Codex needs your input',toolName:p.command?'Run command':'Review action',input:p.questions?{questions:p.questions}:p});return
      }
      this.send({id:m.id,error:{code:-32601,message:'This native request is not supported in zQ Chat. Use Terminal for this interaction.'}});this.event({kind:'error',text:'This interaction requires the native Terminal interface.'});return
    }
    if(m.method==='item/started'||m.method==='item/completed'){this.item(p.item);return}
    if(m.method==='item/agentMessage/delta'||m.method==='item/reasoning/summaryTextDelta'||m.method==='item/commandExecution/outputDelta'){
      const old=this.items.get(p.itemId)||{eventId:'codex-'+p.itemId,kind:m.method.includes('reasoning')?'thinking':m.method.includes('commandExecution')?'tool':'assistant',text:''}
      this.items.set(p.itemId,{...old,text:(old.text+String(p.delta||'')).slice(-32000)});this.dirty.add(p.itemId);this.timer ||= setTimeout(()=>this.flush(),75);return
    }
    if(m.method==='turn/started'){this.turnId=p.turn.id;this.state='busy'}
    if(m.method==='turn/completed'){
      this.flush();for(const id of this.pending.keys())this.event({kind:'status',requestId:id,resolved:true,text:'Request ended'});this.pending.clear();this.turnId=null;this.state=p.turn.status==='failed'?'error':'ready';this.event({kind:this.state==='error'?'error':'status',text:p.turn.error?.message|| (p.turn.status==='interrupted'?'Interrupted':'Turn complete')})
    }
    if(m.method==='error'&&!p.willRetry){this.state='error';this.event({kind:'error',text:String(p.error?.message||'Codex failed').slice(0,2000)})}
  }
  message(text){if(!this.verified||this.state!=='ready')fail('SESSION_NOT_READY');this.state='busy';this.request('turn/start',{threadId:this.nativeId,input:[{type:'text',text,text_elements:[]}]},r=>{this.turnId=r.turn?.id})}
  respond(id,allow,answers){const request=this.pending.get(id);if(!request)fail('UNKNOWN_PERMISSION');let result
    if(request.method==='item/tool/requestUserInput')result={answers:Object.fromEntries((request.params.questions||[]).map(q=>[q.id,{answers:allow?[String(answers?.[q.id]??answers?.[q.question]??'')]:[]}]))}
    else result={decision:allow?'accept':'decline'} // once only; no policy amendments
    this.send({id:request.id,result});this.pending.delete(id);this.state=this.pending.size?'approval':'busy';this.event({kind:'status',requestId:id,resolved:true,text:allow?'Answered':'Declined'})
  }
  interrupt(){if(this.turnId)this.request('turn/interrupt',{threadId:this.nativeId,turnId:this.turnId},()=>{})}
  close(done){this.flush();if(this.nativeId&&this.initialized)this.request('thread/unsubscribe',{threadId:this.nativeId},done,done);else done()}
}
module.exports={CodexProtocol}
