// The public SDK reconstructs Claude's native conversation chain. Read-only;
// no agent launch, transcript rewriting, or prompt reconstruction happens here.
const path=require('node:path'),{execFile}=require('node:child_process'),{promisify}=require('node:util')
const exec=promisify(execFile)
async function readClaudeHistory(nodePath,operation,input={}) {
  const {stdout}=await exec(nodePath,[__filename,operation,JSON.stringify(input)],{env:{...process.env,ELECTRON_RUN_AS_NODE:'1'},timeout:20000,maxBuffer:4*1024*1024})
  return JSON.parse(stdout)
}
async function main(){
  const sdk=await import('@anthropic-ai/claude-agent-sdk'),[operation,serialized]=process.argv.slice(2),input=JSON.parse(serialized||'{}')
  if(operation==='list'){
    const rows=await sdk.listSessions({limit:201})
    return {truncated:rows.length>200,sessions:rows.slice(0,200).filter(r=>r.cwd&&path.isAbsolute(r.cwd)).map(r=>({nativeId:r.sessionId,cwd:r.cwd,title:String(r.customTitle||r.summary||'Claude session').slice(0,200),updatedAt:r.lastModified}))}
  }
  if(operation==='read'){
    const info=await sdk.getSessionInfo(input.nativeId,{dir:input.cwd})
    if(!info||info.cwd!==input.cwd)throw Error('NATIVE_SESSION_NOT_FOUND')
    const messages=await sdk.getSessionMessages(input.nativeId,{dir:input.cwd})
    // Bound the UI replay, preserving the original native transcript in place.
    const events=[]
    for(const m of messages.slice(-256)){
      const blocks=typeof m.message?.content==='string'?[{type:'text',text:m.message.content}]:m.message?.content||[]
      for(let i=0;i<blocks.length;i++){
        const b=blocks[i],id=`claude-${m.uuid}-${i}`
        if(b.type==='text')events.push({kind:m.type,text:String(b.text).slice(0,32000),eventId:id})
        else if(b.type==='thinking')events.push({kind:'thinking',text:String(b.thinking).slice(0,32000),eventId:id})
        else if(b.type==='tool_use')events.push({kind:'tool',toolName:b.name,text:'Tool call',input:b.input,eventId:id})
        else if(b.type==='tool_result')events.push({kind:'tool',text:(typeof b.content==='string'?b.content:JSON.stringify(b.content)||'').slice(0,32000),eventId:id})
      }
    }
    let bytes=0;const retained=[];for(const event of events.reverse()){const size=Buffer.byteLength(JSON.stringify(event));if(retained.length>=240||bytes+size>200000)break;bytes+=size;retained.push(event)}
    return {events:retained.reverse(),truncated:messages.length>256||retained.length<events.length}
  }
  throw Error('UNKNOWN_METHOD')
}
if(require.main===module)main().then(r=>process.stdout.write(JSON.stringify(r))).catch(()=>process.exit(1))
module.exports={readClaudeHistory}
