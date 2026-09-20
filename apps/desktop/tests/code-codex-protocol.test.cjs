const test=require('node:test'),assert=require('node:assert/strict'),{CodexProtocol}=require('../electron/code/codex-protocol.cjs')
function setup(){const sent=[],events=[],p=new CodexProtocol({nativeId:'native-123',cwd:'/tmp/project',send:m=>sent.push(m),event:e=>events.push(e)});const receive=m=>p.feed(JSON.stringify(m)+'\n');p.initialize();receive({id:sent.at(-1).id,result:{}});return{p,sent,events,receive}}
test('Codex resumes an exact native ID, hydrates recent history, and coalesces streamed text',()=>{
 const h=setup();assert.equal(h.sent.at(-1).method,'thread/resume');assert.deepEqual(h.sent.at(-1).params,{threadId:'native-123',excludeTurns:true})
 h.receive({id:h.sent.at(-1).id,result:{thread:{id:'native-123',cwd:'/tmp/project',status:{type:'idle'}},model:'fixture'}})
 h.receive({id:h.sent.at(-1).id,result:{data:[{item:{id:'reply',type:'agentMessage',text:'Original reply'}},{item:{id:'prompt',type:'userMessage',content:[{type:'text',text:'Original prompt'}]}}]}})
 assert.deepEqual(h.events.map(e=>e.text),['Original prompt','Original reply']);assert(h.p.verified)
 h.p.message('Follow up');assert.equal(h.sent.at(-1).method,'turn/start');assert.equal(h.sent.at(-1).params.input.length,1)
 h.receive({id:h.sent.at(-1).id,result:{turn:{id:'turn'}}})
 h.receive({method:'item/agentMessage/delta',params:{threadId:'native-123',itemId:'stream',delta:'Hello '}})
 h.receive({method:'item/agentMessage/delta',params:{threadId:'native-123',itemId:'stream',delta:'world'}})
 h.receive({method:'turn/completed',params:{threadId:'native-123',turn:{id:'turn',status:'completed'}}})
 assert.equal(h.events.find(e=>e.eventId==='codex-stream').text,'Hello world');assert.equal(h.p.state,'ready')
})
test('Codex rejects substituted IDs and workspace mismatch before enabling input',()=>{
 for(const thread of [{id:'other',cwd:'/tmp/project'},{id:'native-123',cwd:'/other'}]){const h=setup();assert.throws(()=>h.receive({id:h.sent.at(-1).id,result:{thread}}),{code:'IDENTITY_MISMATCH'});assert.equal(h.p.verified,false)}
})
test('Codex approvals are allow once, and questions use the native question IDs',()=>{
 const h=setup();h.p.initialized=h.p.verified=true
 h.receive({id:21,method:'item/commandExecution/requestApproval',params:{threadId:'native-123',command:'git status'}})
 h.p.respond('21',true);assert.deepEqual(h.sent.at(-1),{id:21,result:{decision:'accept'}})
 h.receive({id:22,method:'item/tool/requestUserInput',params:{threadId:'native-123',questions:[{id:'choice',question:'Pick',options:[{label:'A'}]}]}})
 h.p.respond('22',true,{choice:'A'});assert.deepEqual(h.sent.at(-1).result,{answers:{choice:{answers:['A']}}})
 assert(h.events.filter(e=>e.resolved).length===2)
})

test('new Codex threads accept their first turn without reading nonexistent history',()=>{
 const sent=[],events=[],p=new CodexProtocol({cwd:'/tmp/project',send:m=>sent.push(m),event:e=>events.push(e)})
 p.initialize();p.receive({id:sent.at(-1).id,result:{}})
 assert.equal(sent.at(-1).method,'thread/start')
 p.receive({id:sent.at(-1).id,result:{thread:{id:'fresh-thread',cwd:'/tmp/project',status:{type:'idle'}},model:'fixture'}})
 assert.equal(p.state,'ready');assert(p.verified);assert(!sent.some(m=>['thread/read','thread/items/list'].includes(m.method)))
 p.message('First review');assert.equal(sent.at(-1).method,'turn/start');assert.equal(sent.at(-1).params.threadId,'fresh-thread')
})
