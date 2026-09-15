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
