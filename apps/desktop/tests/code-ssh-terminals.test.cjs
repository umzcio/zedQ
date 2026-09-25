const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {RemoteHosts,asUser,sshArgs,INSTALL}=require('../electron/code/remote.cjs');
const {CodeHost}=require('../electron/code/code-host.cjs');
const {prepareRoot}=require('../electron/code/service-storage.cjs');
const {CodeService}=require('../electron/code/code-service.cjs');
function root(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'zq-ssh-test-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));return dir}
function remote(t,options={}){const calls=[],dir=root(t);const manager=new RemoteHosts(dir,{run:async(alias,args,input)=>{calls.push({alias,args,input});return args.includes(INSTALL)?JSON.stringify({bridge:'/root/.local/share/zq/code/bundles/hash/remote-bridge.cjs'}):''},open:async(alias,bridge,user)=>({metadata:{uid:user==='root'?0:501},close(){},request:async()=>({projects:[],profiles:[],sessions:[]})}),...options});t.after(()=>manager.close());return {dir,manager,calls}}
test('root bootstrap and terminal commands use noninteractive sudo; login commands remain unchanged',async t=>{
 const {manager,calls,dir}=remote(t);const login=manager.create({name:'Host',sshAlias:'host'}),admin=manager.create({name:'Host root',sshAlias:'host',runAs:'root'});
 assert.notEqual(login.id,admin.id);assert.equal(manager.create({name:'Again',sshAlias:'host',runAs:'root'}).id,admin.id);
 await manager.connect(admin.id);assert.equal(calls.length,3);for(const {args} of calls)assert.deepEqual(args.slice(0,5),['sudo','-n','-H','--','/bin/sh']);
 assert.ok(calls[0].args.at(-1).includes('id -u'));assert.ok(calls[2].args.includes(INSTALL));
 assert.throws(()=>manager.update({id:login.id,patch:{runAs:'root'}}),{code:'HOST_USER_IMMUTABLE'});
 manager.update({id:admin.id,patch:{visible:false}});assert.equal(manager.rows().find(h=>h.id===admin.id).available,true);
 const restored=new RemoteHosts(dir);assert.equal(restored.find(admin.id).runAs,'root');assert.equal(restored.find(admin.id).visible,false);restored.close();
 await manager.connect(login.id);assert.equal(calls[3].args[0],'/bin/sh');assert.equal(calls[4].args[0],'node');
 const argv=['/a path/tmux','attach-session','-t','$2'];assert.deepEqual(asUser(argv),argv);assert.deepEqual(asUser(argv,'root').slice(-4),argv);
 const command=sshArgs('host',asUser(argv,'root'),true);assert.ok(command.includes('-tt'));assert.match(command.at(-1),/^'sudo' '-n' '-H' '--'/);assert.match(command.at(-1),/'\$2'$/);
 assert.throws(()=>asUser(argv,'other'),{code:'INVALID_HOST'});
});
test('failed passwordless sudo never installs a helper or falls back to login user',async t=>{
 let calls=0,opened=0;const {manager}=remote(t,{run:async()=>{calls++;throw Error('denied')},open:async()=>{opened++}});const h=manager.create({name:'Root',sshAlias:'host',runAs:'root'});
 await assert.rejects(manager.connect(h.id),{code:'SSH_SUDO_REQUIRED'});assert.equal(calls,1);assert.equal(opened,0);assert.equal(manager.clients.size,0);
});
test('root handshake requires verified uid zero',async t=>{
 let closed=0;const {manager}=remote(t,{open:async()=>({metadata:{uid:501},close(){closed++}})});const h=manager.create({name:'Root',sshAlias:'host',runAs:'root'});await assert.rejects(manager.connect(h.id),{code:'SSH_USER_MISMATCH'});assert.equal(closed,1);assert.equal(manager.clients.size,0);
});
test('concurrent connections coalesce; disconnect cancels an unfinished connection',async t=>{
 let release,opened=0;const {manager}=remote(t,{run:async(_a,args)=>{if(args.includes(INSTALL))return JSON.stringify({bridge:'/tmp/remote-bridge.cjs'});await new Promise(r=>release=r)},open:async()=>{opened++;return {close(){},request:async()=>({projects:[],profiles:[],sessions:[]})}}});const h=manager.create({name:'Host',sshAlias:'host'});
 const a=manager.connect(h.id),b=manager.connect(h.id);manager.disconnect(h.id);const checks=[assert.rejects(a,{code:'HOST_DISCONNECTED'}),assert.rejects(b,{code:'HOST_DISCONNECTED'})];release();await Promise.all(checks);assert.equal(opened,0);assert.equal(manager.clients.size,0);
});
test('standalone tmux attachment reuses identity and links without changing cwd or process',async t=>{
 const dir=root(t),owner={},host=new CodeHost({paths:prepareRoot(dir),seedFile:'/absent',tmux:{inspect:async()=>null}});
 let info={target:'$3',name:'native',cwd:dir,identity:'server:birth',attached:false};let creates=[];
 host.external={inspect:async()=>info,discover:async()=>[info],create:async(...args)=>{creates.push(args);return '$3'}};
 const s=await host.dispatch(owner,'attachExternalTerminal',{hostId:'local',target:'$3'});assert.equal(s.projectId,'');assert.equal(s.cwd,dir);
 await host.dispatch(owner,'releaseSession',{id:s.id});assert.equal((await host.dispatch(owner,'attachExternalTerminal',{target:'$3'})).id,s.id);assert.equal(host.catalog.value.sessions.length,1);
 await assert.rejects(host.dispatch({},'attachExternalTerminal',{target:'$3'}),{code:'LEASE_HELD'});
 const folder=path.join(dir,'project');fs.mkdirSync(folder);const project=host.catalog.createProject({name:'Project',cwd:folder});
 await host.dispatch(owner,'linkTerminal',{id:s.id,projectId:project.id});assert.equal(s.projectId,project.id);assert.equal(s.cwd,dir);assert.equal(s.tmuxTarget,'$3');assert.equal(s.nativeId,'');
 await host.dispatch(owner,'linkTerminal',{id:s.id,projectId:null});assert.equal(s.projectId,'');assert.equal(s.cwd,dir);
 info={...info,target:'$4',identity:'server:new'};host.external.create=async(...args)=>{creates.push(args);return '$4'};
 const fresh=await host.dispatch(owner,'createTerminal',{hostId:'local',projectId:project.id,name:'new-work'});assert.equal(fresh.projectId,project.id);assert.deepEqual(creates,[['new-work',project.cwd]]);
 await assert.rejects(host.dispatch(owner,'createTerminal',{name:'bad;touch /tmp/no'}),{code:'INVALID_REQUEST'});
});
test('desktop attaches under the recorded root context and rejects cross-host project links',async t=>{
 const dir=root(t),spawned=[];const service=new CodeService({directory:dir,tmuxPath:null,pty:{spawn(file,args){spawned.push({file,args});return {kill(){},onData(){},onExit(){}}}}});clearInterval(service.timer);t.after(()=>service.close());
 const host=service.remotes.create({name:'Root',sshAlias:'host',runAs:'root'});service.remotes.clients.set(host.id,{metadata:{tmuxPath:'/usr/bin/tmux',root:'/root/runtime'},close(){}});
 const s={id:'session',hostId:host.id,ownership:'external',tmuxTarget:'$4'};service.snapshot=async()=>({sessions:[s],projects:[],profiles:[]});service.request=async()=>({ok:true});
 await service.invoke('attachTerminal',{id:s.id,cols:80,rows:24});assert.match(spawned[0].args.at(-1),/^'sudo' '-n' '-H' '--'/);assert.match(spawned[0].args.at(-1),/'\/usr\/bin\/tmux' 'attach-session' '-t' '\$4'$/);
 service.lastSnapshot={sessions:[s],projects:[{id:'other',hostId:'local'}],profiles:[]};await assert.rejects(service.requestOnce('linkTerminal',{id:s.id,projectId:'other'}),{code:'HOST_MISMATCH'});
});
test('real isolated tmux creates a login shell, survives detach, and refuses duplicate names',async t=>{
 const {execFile,execFileSync}=require('node:child_process'),{externalTmux}=require('../electron/code/external-terminal.cjs');
 const dir=root(t),env={...process.env,TMUX_TMPDIR:dir,HOME:dir,LC_ALL:'C',LANG:'C'};delete env.TMUX;
 const cwd=path.join(dir,'café');fs.mkdirSync(cwd);
 const binary='/opt/homebrew/bin/tmux';
 const execute=(file,args,options,callback)=>execFile(file,args,{...options,env},callback);
 const tmux=externalTmux(binary,execute);
 t.after(()=>{try{execFileSync(binary,['kill-server'],{env,stdio:'ignore'})}catch{}});
 assert.deepEqual(await tmux.discover(),[]);
 const target=await tmux.create('isolated-work',cwd);assert.match(target,/^\$\d+$/);
 const info=await tmux.inspect(target);assert.equal(info.name,'isolated-work');assert.equal(info.attached,false);assert.equal(fs.realpathSync(info.cwd),fs.realpathSync(cwd));assert.equal(info.windows,1);
 await assert.rejects(tmux.create('isolated-work',dir),{code:'TMUX_FAILED'});
 await tmux.write(target,'echo zq-test\r');assert.equal((await tmux.inspect(target)).identity,info.identity);
});
test('Bash-only hosts connect; missing dependencies are reported before installing',async t=>{
 const {DEPENDENCY_PROBE}=require('../electron/code/remote.cjs');
 const {execFileSync}=require('node:child_process');
 const bin=path.join(root(t),'bin');fs.mkdirSync(bin);
 // The probe must work using POSIX sh with only the actual runtime dependencies.
 const probe=()=>execFileSync('/bin/sh',['-c',DEPENDENCY_PROBE],{encoding:'utf8',env:{PATH:bin}});
 assert.equal(probe(),'node\ntmux\n');
 fs.writeFileSync(path.join(bin,'node'),'#!/bin/sh\nexit 0\n',{mode:0o700});assert.equal(probe(),'tmux\n');
 fs.writeFileSync(path.join(bin,'tmux'),'#!/bin/sh\nexit 0\n',{mode:0o700});assert.equal(probe(),'');
 for(const [output,code] of [['node\n','SSH_NODE_REQUIRED'],['tmux\n','SSH_TMUX_REQUIRED'],['node\ntmux\n','SSH_DEPENDENCIES_REQUIRED'],['unexpected banner','SSH_BOOTSTRAP_FAILED']]) {
  let calls=0;const {manager}=remote(t,{run:async()=>{calls++;return output}});const host=manager.create({name:'Host',sshAlias:'host'});
  await assert.rejects(manager.connect(host.id),{code});assert.equal(calls,1);assert.equal(manager.clients.size,0);
 }
 const {manager,calls}=remote(t);const host=manager.create({name:'Bash host',sshAlias:'host'});await manager.connect(host.id);
 assert.equal(manager.rows()[0].available,true);assert.equal(calls[0].args.at(-1),DEPENDENCY_PROBE);assert.ok(!DEPENDENCY_PROBE.includes('zsh'));
});
test('root login shell preserves literal tmux IDs and shell metacharacters',t=>{
 const {execFileSync}=require('node:child_process');const dir=root(t);
 const values=['$0','$7','two words',"quote'and\"double",'$(touch SHOULD_NOT_EXIST)','`touch ALSO_NOT_CREATED`','semi;colon'];
 const command=asUser(['/usr/bin/printf','<%s>\n',...values],'root');
 // Execute the real login-shell wrapper after sudo would establish root's environment.
 const output=execFileSync(command[4],command.slice(5),{encoding:'utf8',env:{PATH:'/usr/bin:/bin',HOME:dir,SHELL:'/bin/bash'}});
 assert.equal(output,values.map(v=>`<${v}>\n`).join(''));assert.equal(fs.existsSync(path.join(dir,'SHOULD_NOT_EXIST')),false);
});
test('terminal exit flushes final output and publishes a reconnectable exit event',async t=>{
 const dir=root(t),events=[];let onData,onExit;
 const service=new CodeService({directory:dir,tmuxPath:'/unused',pty:{spawn(){return {kill(){},onData(fn){onData=fn},onExit(fn){onExit=fn}}}}});clearInterval(service.timer);t.after(()=>service.close());
 service.onTerminal=e=>events.push(e);service.request=async()=>({ok:true});service.snapshot=async()=>({sessions:[{id:'session',hostId:'local',ownership:'external',tmuxTarget:'$0'}],projects:[],profiles:[]});
 const attached=await service.invoke('attachTerminal',{id:'session',cols:80,rows:24});onData('connection closed');onExit({exitCode:1});
 const exit=events.at(-1);assert.equal(exit.attachmentId,attached.attachmentId);assert.equal(exit.exited,true);assert.equal(exit.exitCode,1);assert.equal(exit.data,'connection closed');assert.equal(service.terminals.size,0);assert.equal(service.attachments.size,0);
 await new Promise(r=>setImmediate(r));assert.equal(events.length,2);
});
test('remote navigation survives app restart without reconnecting and is removed with its host',async t=>{
 let remoteSessions=[{id:'remembered',title:'aif',projectId:'',hostId:'local',state:'ready',createdAt:1,archivedAt:null}];
 const {manager,dir}=remote(t,{open:async()=>({close(){},request:async()=>({projects:[],profiles:[],sessions:structuredClone(remoteSessions),events:[{text:'must not be cached'}]})})});
 const h=manager.create({name:'Host',sshAlias:'host'});await manager.connect(h.id);manager.close();
 const cache=path.join(dir,'remote-snapshots.json');assert.equal(fs.statSync(cache).mode & 0o777,0o600);assert.ok(!fs.readFileSync(cache,'utf8').includes('must not be cached'));
 let connects=0;const restored=new RemoteHosts(dir,{run:async()=>{connects++;throw Error('must not connect')}});t.after(()=>restored.close());
 assert.equal(connects,0);assert.equal(restored.rows()[0].available,false);assert.equal(restored.snapshots.get(h.id).sessions[0].title,'aif');
 const service=new CodeService({directory:dir,tmuxPath:null,pty:{}});clearInterval(service.timer);t.after(()=>service.close());
 const snapshot=await service.snapshot();assert.equal(snapshot.sessions[0].state,'disconnected');assert.equal(snapshot.sessions[0].hostId,h.id);
 // Refreshing from the host replaces stale records; hiding the host does not remove its session shortcut.
 manager.update({id:h.id,patch:{visible:false}});remoteSessions=[];await manager.connect(h.id);assert.deepEqual(manager.snapshots.get(h.id).sessions,[]);manager.close();
 restored.delete(h.id);const again=new RemoteHosts(dir);assert.equal(again.snapshots.size,0);assert.deepEqual(again.rows(),[]);again.close();
});
test('terminal wheel and keyboard bursts use the attached PTY, without per-event SSH or tmux RPCs',async t=>{
 const {randomUUID}=require('node:crypto'),dir=root(t),calls=[],writes=[],sizes=[];
 const service=new CodeService({directory:dir,tmuxPath:'/unused',pty:{spawn(){return {kill(){},onData(){},onExit(){},write(data){writes.push(data)},resize(cols,rows){sizes.push([cols,rows])}}}}});clearInterval(service.timer);t.after(()=>service.close());
 service.request=async(method)=>{calls.push(method);return {ok:true}};
 service.snapshot=async()=>({sessions:[{id:'session',hostId:'local',ownership:'external',tmuxTarget:'$0'}],projects:[],profiles:[]});
 const attachmentId=randomUUID();await service.invoke('attachTerminal',{id:'session',cols:80,rows:24,attachmentId});calls.length=0;
 const events=Array.from({length:240},(_,i)=>i%2?'\x1b[<64;10;8M':'\x1b[<65;10;8M');
 await Promise.all(events.map(data=>service.invoke('writeTerminal',{id:'session',attachmentId,data})));
 await service.invoke('writeTerminal',{id:'session',attachmentId,data:'hello\r'});
 await service.invoke('resizeTerminal',{id:'session',attachmentId,cols:100,rows:30});
 assert.deepEqual(writes,[...events,'hello\r']);assert.deepEqual(sizes,[[100,30]]);assert.deepEqual(calls,[]);
 await assert.rejects(service.invoke('writeTerminal',{id:'session',attachmentId:randomUUID(),data:'stale'}),{code:'ATTACHMENT_SUPERSEDED'});
 await assert.rejects(service.invoke('writeTerminal',{id:'session',attachmentId,data:'x'.repeat(8193)}),{code:'INVALID_REQUEST'});
 await assert.rejects(service.invoke('resizeTerminal',{id:'session',attachmentId,cols:0,rows:24}),{code:'INVALID_REQUEST'});
 await service.invoke('detachTerminal',{id:'session',attachmentId});
 await assert.rejects(service.invoke('writeTerminal',{id:'session',attachmentId,data:'late'}),{code:'ATTACHMENT_SUPERSEDED'});
 assert.equal(writes.length,241);
});
