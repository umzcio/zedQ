const test = require('node:test'), assert = require('node:assert/strict')
const {KimiProtocol} = require('../electron/code/kimi-protocol.cjs')
function setup() {
  const sent = [], events = []
  const protocol = new KimiProtocol({nativeId:'session_test', cwd:'/tmp/project', send:m=>sent.push(m), event:e=>events.push(e)})
  const receive = m => protocol.feed(JSON.stringify({jsonrpc:'2.0', ...m})+'\n')
  protocol.initialize()
  receive({id:sent.at(-1).id,result:{agentCapabilities:{loadSession:true}}})
  const loadId = sent.at(-1).id
  const update = update => receive({method:'session/update',params:{sessionId:'session_test',update}})
  return {protocol,sent,events,receive,update,loadId}
}
test('ACP replays native history before readiness, coalesces tokens, and preserves exact resume identity',()=>{
  const h=setup()
  assert.equal(h.sent.at(-1).method,'session/load')
  assert.equal(h.sent.at(-1).params.sessionId,'session_test')
  h.update({sessionUpdate:'user_message_chunk',content:{type:'text',text:'Original prompt'}})
  h.update({sessionUpdate:'user_message_chunk',content:{type:'text',text:'<system-reminder>internal context</system-reminder>'}})
  h.update({sessionUpdate:'agent_message_chunk',content:{type:'text',text:'Original reply'}})
  assert.equal(h.protocol.verified,false)
  h.receive({id:h.loadId,result:{}})
  assert.deepEqual(h.events.map(e=>e.text),['Original prompt','Original reply'])
  h.protocol.message('Next turn')
  h.update({sessionUpdate:'agent_message_chunk',content:{type:'text',text:'Hello '}})
  h.update({sessionUpdate:'agent_message_chunk',content:{type:'text',text:'world'}})
  h.receive({id:h.sent.at(-1).id,result:{stopReason:'end_turn'}})
  assert.equal(h.events.filter(e=>e.kind==='assistant').at(-1).text,'Hello world')
  assert.equal(h.protocol.state,'ready')
  assert.throws(()=>h.receive({method:'session/update',params:{sessionId:'different',update:{}}}),{code:'IDENTITY_MISMATCH'})
})
test('permission choices round trip opaque IDs; no automatic always-allow and no lost cancellation',()=>{
  const h=setup();h.receive({id:h.loadId,result:{}})
  h.protocol.message('Do work')
  const promptId=h.sent.at(-1).id
  h.receive({id:'question-1',method:'session/request_permission',params:{sessionId:'session_test',toolCall:{title:'Choose a branch'},options:[{optionId:'q0_opt_0',kind:'allow_once',name:'Main'},{optionId:'q0_opt_1',kind:'allow_once',name:'Feature'}]}})
  h.protocol.respond('question-1',true,{optionId:'q0_opt_1'})
  assert.equal(h.sent.at(-1).result.outcome.optionId,'q0_opt_1')
  h.receive({id:'approval-1',method:'session/request_permission',params:{sessionId:'session_test',options:[{optionId:'always',kind:'allow_always',name:'Always'}]}})
  assert.throws(()=>h.protocol.respond('approval-1',true),{code:'KIMI_PERMISSION_UNSUPPORTED'})
  h.protocol.interrupt();assert.equal(h.sent.at(-1).method,'session/cancel')
  h.receive({id:promptId,result:{stopReason:'cancelled'}})
  assert.equal(h.protocol.pending.size,0)
  assert(h.events.some(e=>e.requestId==='approval-1'&&e.resolved))
})
test('load failures never acknowledge a new or substituted conversation',()=>{
  const h=setup()
  assert.throws(()=>h.receive({id:h.loadId,error:{code:-32602,message:'Unknown session'}}),{code:'KIMI_LOAD_FAILED'})
  assert.equal(h.protocol.verified,false)
  assert.equal(h.sent.filter(m=>m.method==='session/new').length,0)
})
test('a vanished UI runner cannot report a surviving native process stopped', async t=>{
  const fs=require('node:fs'),path=require('node:path'),{spawn}=require('node:child_process')
  const {KimiSessions}=require('../electron/code/kimi-sessions.cjs'),{atomic}=require('../electron/code/code-catalog.cjs')
  const root=fs.mkdtempSync('/tmp/zq-kimi-ownership-')
  const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{detached:true,stdio:'ignore'})
  t.after(()=>{try{process.kill(-child.pid,'SIGTERM')}catch{};fs.rmSync(root,{recursive:true,force:true})})
  await new Promise(r=>child.once('spawn',r))
  const s={id:'fixture',state:'ready',adapter:'kimi',mode:'chat'}
  atomic(path.join(root,s.id+'.ownership.json'),{state:'running',pid:child.pid})
  const host={paths:{root},tmux:{inspect:async()=>null},name:id=>id,catalog:{save(){}}}
  const adapter=new KimiSessions(host)
  await adapter.status(s)
  assert.equal(s.state,'error');assert.equal(s.error,'PROCESS_OWNERSHIP_UNKNOWN')
  await assert.rejects(adapter.start(s,'chat'),{code:'PROCESS_OWNERSHIP_UNKNOWN'})
})
test('opening a listed native session reuses discovery but explicit refresh stays fresh', async t=>{
  const fs=require('node:fs'),path=require('node:path')
  const {KimiSessions}=require('../electron/code/kimi-sessions.cjs')
  const root=fs.mkdtempSync('/tmp/zq-kimi-discovery-'), file=path.join(root,'kimi'), count=path.join(root,'calls')
  const old=process.env.ZQ_KIMI_BINARY
  t.after(()=>{if(old===undefined)delete process.env.ZQ_KIMI_BINARY;else process.env.ZQ_KIMI_BINARY=old;fs.rmSync(root,{recursive:true,force:true})})
  fs.writeFileSync(file,`#!${process.execPath}\nrequire('node:fs').appendFileSync(${JSON.stringify(count)},'x');console.log(JSON.stringify([{id:'native_fixture',workDir:${JSON.stringify(root)},title:'Fixture'}]));`,{mode:0o700})
  process.env.ZQ_KIMI_BINARY=file
  const host={catalog:{value:{sessions:[],projects:[]},save(){}},leases:new Map()}
  const adapter=new KimiSessions(host)
  adapter.start=async s=>{s.state='ready'}
  await Promise.all([adapter.list(),adapter.list()])
  assert.equal(fs.readFileSync(count,'utf8'),'x')
  const session=await adapter.open('fixture-owner',{nativeId:'native_fixture'})
  assert.equal(session.nativeId,'native_fixture')
  assert.equal(fs.readFileSync(count,'utf8'),'x')
  await adapter.list()
  assert.equal(fs.readFileSync(count,'utf8'),'xx')
})
