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

test('background snapshot and event polls coalesce during a slow handoff instead of filling the request queue',async t=>{
 const {CodeService}=require('../electron/code/code-service.cjs'),root=fs.mkdtempSync('/tmp/zq-polls-');
 const service=new CodeService({directory:root,tmuxPath:null,pty:{}});
 t.after(()=>{service.close();fs.rmSync(root,{recursive:true,force:true})});
 let calls=0,release;
 service.performLocalRequest=async()=>{calls++;await new Promise(r=>release=r);return {seq:1}};
 const polls=Array.from({length:40},()=>service.localRequest('snapshot'));
 assert.equal(calls,1);release();await Promise.all(polls);
 const next=service.localRequest('snapshot');assert.equal(calls,2);release();await next;
});

test('an old empty Chat remains recoverable after a failed target replaced its receipt path',t=>{
 const {root,host}=setup(t),id='empty';
 const put=(name,value)=>fs.writeFileSync(path.join(root,name),JSON.stringify(value),{mode:0o600});
 put(id+'.controller.json',{receipt:path.join(root,'missing.receipt.json')});
 put(id+'.events.json',{seq:2,events:[{kind:'profile',text:'Profile active in Chat'},{kind:'status',text:'Agent stopped'}]});
 assert.equal(host.emptyConversation({id,mode:'chat'}),true);
 put(id+'.events.json',{seq:2,events:[{kind:'user',text:'Existing conversation'},{kind:'status',text:'Agent stopped'}]});
 assert.equal(host.emptyConversation({id,mode:'chat'}),false);
 put(id+'.events.json',{seq:300,events:[{kind:'status',text:'Agent stopped'}]});
 assert.equal(host.emptyConversation({id,mode:'chat'}),false);
});

test('native folder trust is surfaced before a terminal handoff can silently time out', async t=>{
 const {root,host}=setup(t);
 host.tmux.inspect=async()=>({pid:123});
 host.tmux.capture=async()=> 'Quick safety check: Is this a project you created or one you trust?\nYes, I trust this folder';
 await assert.rejects(host.ready({id:'trust',mode:'terminal',receipt:path.join(root,'not-yet-written'),expected:'native',cwd:root}),{code:'PROJECT_TRUST_REQUIRED'});
});

test('control actions reclaim a lost lease once, without replaying ambiguous errors or stealing another owner',async t=>{
 const {CodeService}=require('../electron/code/code-service.cjs'),root=fs.mkdtempSync('/tmp/zq-lease-');
 const service=new CodeService({directory:root,tmuxPath:null,pty:{}});
 t.after(()=>{service.close();fs.rmSync(root,{recursive:true,force:true})});
 for(const method of ['stopSession','resumeSession','switchSession','sendMessage','interruptSession','respondPermission','attachTerminal']) {
  const calls=[]; let owned=false;
  service.requestOnce=async(name,input)=>{calls.push([name,input]);if(name==='claimSession'){owned=true;return {ok:true}}if(!owned)throw Object.assign(new Error('LEASE_REQUIRED'),{code:'LEASE_REQUIRED'});return {ok:true}};
  const input={id:'session',expectedRevision:3};assert.deepEqual(await service.request(method,input),{ok:true});
  assert.deepEqual(calls,[[method,input],['claimSession',{id:'session'}],[method,input]]);
 }
 for(const code of ['SERVICE_DISCONNECTED','SERVICE_REQUEST_TIMEOUT','STALE_REVISION','LEASE_HELD']) {
  let calls=0;service.requestOnce=async()=>{calls++;throw Object.assign(new Error(code),{code})};
  await assert.rejects(service.request('stopSession',{id:'session'}),{code});assert.equal(calls,1);
 }
 let calls=[];service.requestOnce=async name=>{calls.push(name);const code=name==='claimSession'?'LEASE_HELD':'LEASE_REQUIRED';throw Object.assign(new Error(code),{code})};
 await assert.rejects(service.request('stopSession',{id:'session'}),{code:'LEASE_HELD'});
 assert.deepEqual(calls,['stopSession','claimSession']);
 calls=[];service.requestOnce=async name=>{calls.push(name);throw Object.assign(new Error('LEASE_REQUIRED'),{code:'LEASE_REQUIRED'})};
 await assert.rejects(service.request('writeTerminal',{id:'session',data:'x'}),{code:'LEASE_REQUIRED'});assert.deepEqual(calls,['writeTerminal']);
})

test('a rejected Stop leaves the terminal attached',async t=>{
 const {CodeService}=require('../electron/code/code-service.cjs'),root=fs.mkdtempSync('/tmp/zq-stop-');
 const service=new CodeService({directory:root,tmuxPath:null,pty:{}});
 t.after(()=>{service.close();fs.rmSync(root,{recursive:true,force:true})});
 service.snapshot=async()=>({sessions:[{id:'session',ownership:'owned'}]});
 let killed=0;service.terminals.set('session',{kill(){killed++}});
 service.request=async()=>{throw Object.assign(new Error('LEASE_HELD'),{code:'LEASE_HELD'})};
 await assert.rejects(service.invoke('stopSession',{id:'session',expectedRevision:0}),{code:'LEASE_HELD'});
 assert.equal(killed,0);assert.ok(service.terminals.has('session'));
})
