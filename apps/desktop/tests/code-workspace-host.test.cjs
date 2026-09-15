const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path')
const {CodeHost}=require('../electron/code/code-host.cjs')
const {prepareRoot}=require('../electron/code/service-storage.cjs')
function setup(t){const root=fs.mkdtempSync('/tmp/zq-wh-');t.after(()=>fs.rmSync(root,{recursive:true,force:true}));let kills=0;const host=new CodeHost({paths:prepareRoot(root),seedFile:'/nonexistent',tmux:{inspect:async()=>null,stop:async()=>kills++}});return {root,host,kills:()=>kills}}
test('workspace bridge always resolves selected project relative paths',async t=>{
 const {root,host}=setup(t),owner={};fs.writeFileSync(path.join(root,'a'),'one')
 const p=await host.dispatch(owner,'createProject',{name:'Work',cwd:root})
 const file=await host.dispatch(owner,'readFile',{projectId:p.id,path:'a'});assert.equal(file.text,'one')
 await host.dispatch(owner,'writeFile',{projectId:p.id,path:'a',text:'two',fingerprint:file.fingerprint})
 assert.equal(fs.readFileSync(path.join(root,'a'),'utf8'),'two')
 await assert.rejects(host.dispatch(owner,'readFile',{projectId:p.id,path:'/etc/passwd'}),{code:'INVALID_PATH'})
})
test('external tmux requires idle exact identity; detach never stops it; no native resume',async t=>{
 const {root,host,kills}=setup(t),owner={};const p=await host.dispatch(owner,'createProject',{name:'Work',cwd:root})
 let info={target:'$2',name:'work',attached:true,ownership:'external',identity:'123:456'},writes=[]
 host.external={discover:async()=>[info],inspect:async()=>info,write:async(...args)=>writes.push(args)}
 await assert.rejects(host.dispatch(owner,'attachExternalTerminal',{projectId:p.id,target:'$2'}),{code:'EXTERNAL_TERMINAL_IN_USE'})
 info.attached=false
 const s=await host.dispatch(owner,'attachExternalTerminal',{projectId:p.id,target:'$2'})
 assert.equal(s.nativeIdVerified,false);assert.equal(s.nativeId,'');assert.equal(s.ownership,'external')
 await host.dispatch(owner,'attachTerminal',{id:s.id,cols:80,rows:24})
 await host.dispatch(owner,'writeTerminal',{id:s.id,data:'hello'});assert.deepEqual(writes,[['$2','hello']])
 await host.dispatch(owner,'detachTerminal',{id:s.id})
 await assert.rejects(host.dispatch({},'claimSession',{id:s.id}),{code:'LEASE_HELD'})
 info.attached=true
 await assert.rejects(host.dispatch(owner,'attachTerminal',{id:s.id,cols:80,rows:24}),{code:'EXTERNAL_TERMINAL_IN_USE'})
 info.attached=false
 await host.dispatch(owner,'attachTerminal',{id:s.id,cols:80,rows:24})
 await assert.rejects(host.dispatch(owner,'switchSession',{id:s.id,expectedRevision:0,mode:'chat'}),{code:'EXTERNAL_SESSION_OWNERSHIP'})
 await host.dispatch(owner,'releaseSession',{id:s.id});assert.equal(kills(),0)
 await host.dispatch(owner,'claimSession',{id:s.id});info={...info,identity:'999:789'}
 await assert.rejects(host.dispatch(owner,'attachTerminal',{id:s.id,cols:80,rows:24}),{code:'SESSION_IDENTITY_CHANGED'})
 assert.equal(kills(),0)
})
test('desktop external Stop only detaches and releases lease; remote hosts work without local tmux',async t=>{
 const {CodeService}=require('../electron/code/code-service.cjs'),root=fs.mkdtempSync('/tmp/zq-cs-')
 const service=new CodeService({directory:root,tmuxPath:null,pty:{}})
 t.after(()=>{service.close();fs.rmSync(root,{recursive:true,force:true})})
 const host=service.remotes.create({name:'Remote',sshAlias:'fixture'})
 service.remotes.clients.set(host.id,{close(){},request:async()=>({version:1,seq:1,projects:[],profiles:[],sessions:[],hosts:[],runtime:{}})})
 assert.equal((await service.snapshot()).hosts.find(h=>h.id===host.id).available,true)
 assert.equal((await service.snapshot()).runtime.tmux,true)
 const external={id:'external',ownership:'external',state:'ready'},calls=[]
 service.snapshot=async()=>({sessions:[external]});service.request=async(...args)=>{calls.push(args);return {ok:true}}
 let killed=0;service.terminals.set('external',{kill(){killed++}})
 assert.equal(await service.invoke('stopSession',{id:'external',expectedRevision:0}),external)
 assert.equal(killed,1);assert.deepEqual(calls,[['releaseSession',{id:'external'}]])
})
test('terminal attachment generations cancel late attach and stale detach without releasing lease',async t=>{
 const {CodeService}=require('../electron/code/code-service.cjs'),{randomUUID}=require('node:crypto')
 const root=fs.mkdtempSync('/tmp/zq-gen-'),spawned=[],pending=[]
 const service=new CodeService({directory:root,tmuxPath:'/opt/homebrew/bin/tmux',pty:{spawn(){const p={kill(){p.killed=true},onData(){},onExit(){},resize(){}};spawned.push(p);return p}}})
 t.after(()=>{service.close();fs.rmSync(root,{recursive:true,force:true})});clearInterval(service.timer)
 service.snapshot=async()=>({sessions:[{id:'s',hostId:'local'}]})
 service.request=async(method)=>{if(method==='detachTerminal')return {ok:true};assert.equal(method,'attachTerminal');await new Promise(resolve=>pending.push(resolve));return {ok:true}}
 const oldToken=randomUUID(),newToken=randomUUID()
 const oldAttach=service.invoke('attachTerminal',{id:'s',cols:80,rows:24,attachmentId:oldToken})
 const oldRejected=assert.rejects(oldAttach,{code:'ATTACHMENT_SUPERSEDED'})
 const newer=service.invoke('attachTerminal',{id:'s',cols:80,rows:24,attachmentId:newToken})
 pending[1]();assert.equal((await newer).attachmentId,newToken)
 pending[0]();await oldRejected;assert.equal(spawned.length,1)
 await service.invoke('detachTerminal',{id:'s',attachmentId:oldToken});assert.ok(!spawned[0].killed)
 await assert.rejects(service.invoke('writeTerminal',{id:'s',data:'stale',attachmentId:oldToken}),{code:'ATTACHMENT_SUPERSEDED'})
 await service.invoke('detachTerminal',{id:'s',attachmentId:newToken});assert.equal(spawned[0].killed,true)
})
test('successful recovery clears persisted stale recovery and error in both result and snapshot',async t=>{
 const {root,host}=setup(t),{randomUUID}=require('node:crypto'),owner={}
 const project=host.catalog.createProject({name:'Work',cwd:root})
 const profile=host.catalog.createProfile({name:'Claude',launcherFile:path.join(root,'profile.zsh'),functionName:'claude'})
 const row={id:randomUUID(),projectId:project.id,hostId:'local',cwd:root,profileId:profile.id,nativeId:randomUUID(),nativeIdVerified:true,mode:'terminal',adapter:'claude',state:'recoverable',revision:2,pid:123,error:'TARGET_NOT_READY',recovery:{targetProfileId:profile.id,targetMode:'terminal',code:'TARGET_NOT_READY'}}
 host.catalog.value.sessions.push(row);host.catalog.save()
 host.tmux.inspect=async()=>({pid:row.pid})
 host.preflight=async()=>{}
 host.stop=async()=>{row.pid=null}
 host.start=async()=>{row.pid=456;return {id:row.id}}
 host.ready=async()=>({nativeId:row.nativeId})
 await host.dispatch(owner,'claimSession',{id:row.id})
 const result=await host.dispatch(owner,'resumeSession',{id:row.id,expectedRevision:2})
 assert.equal(result.state,'ready');assert.equal(result.pid,456);assert.equal(result.error,null);assert.equal(result.recovery,undefined)
 const snapshot=await host.dispatch(owner,'snapshot')
 assert.equal(snapshot.sessions[0].error,null);assert.equal(snapshot.sessions[0].recovery,undefined)
 const saved=JSON.parse(fs.readFileSync(path.join(root,'code.json'))).sessions[0]
 assert.equal(saved.error,null);assert.equal(saved.recovery,undefined)
})
