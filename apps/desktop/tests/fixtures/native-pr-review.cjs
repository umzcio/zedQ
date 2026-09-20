const assert=require('node:assert/strict'),path=require('node:path')
const {GitHubBoard}=require('../../electron/github/board.cjs')
// Called only from opt-in native tests configured against a loopback model.
module.exports=async function({service,root,agent,profileId,expected}){
 const project=await service.invoke('createProject',{name:'PR review fixture',cwd:root})
 const board=new GitHubBoard({directory:path.join(root,'pr-board'),code:(m,i)=>service.invoke(m,i),client:{login:async()=>'fixture',pulls:async()=>({rows:[{number:1,title:'Native review fixture',headRefOid:'abc123',state:'OPEN',author:{login:'fixture'},reviewRequests:[]}],truncated:false})}})
 await board.configure({repositories:['fixture/repo']});await board.refresh()
 let state=await board.assign({id:'fixture/repo#1',agent,profileId,projectId:project.id})
 for(let n=0;n<300&&state.cards[0].runs[0].state!=='complete';n++){
  assert(!['failed','uncertain'].includes(state.cards[0].runs[0].state),JSON.stringify(state.cards[0].runs))
  await new Promise(r=>setTimeout(r,100));state=await board.snapshot()
 }
 const run=state.cards[0].runs[0];assert.equal(run.state,'complete',JSON.stringify(run));assert(run.report.includes(expected));assert.equal(state.cards[0].stage,'Needs your input')
 const s=(await service.invoke('snapshot')).sessions.find(s=>s.id===run.sessionId);assert(s.nativeIdVerified);assert.equal(s.adapter,agent);assert.equal(s.title,'Review fixture/repo #1')
 const events=(await service.invoke('events',{id:s.id,after:0})).events;assert(events.some(e=>e.kind==='user'&&e.text.includes('zQ review ')))
 await service.invoke('stopSession',{id:s.id,expectedRevision:s.revision})
 console.log(`PASS: fresh native ${agent} PR review, completed report, saved native ID and history`)
 return s
}
