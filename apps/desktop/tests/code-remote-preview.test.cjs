const {test} = require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os')
const {EventEmitter}=require('node:events'),{execFileSync}=require('node:child_process')
const {RemoteHosts,sshArgs,discoverAliases,INSTALL}=require('../electron/code/remote.cjs')
const {Previews,previewURL}=require('../electron/code/preview.cjs')
const {buildTerminalLaunch}=require('../electron/code/terminal-launch.cjs')
function root(t){const p=fs.mkdtempSync(path.join(os.tmpdir(),'zqr-'));t.after(()=>fs.rmSync(p,{recursive:true,force:true}));return p}
test('SSH argv survives shell metacharacters exactly once and rejects option aliases',t=>{
 const values=['node','/tmp/a b\'c','$(touch /tmp/never); *\nnext','literal\\slash']
 const args=sshArgs('work-host',values)
 assert.deepEqual(args.slice(-2,-1),['work-host'])
 // Replace the executable with printf to observe what the remote shell receives.
 const command=args.at(-1).replace(/^'node'/,"printf '%s\\0'")
 const got=execFileSync('/bin/sh',['-c',command]).toString().split('\0').slice(0,-1)
 assert.deepEqual(got,values.slice(1));assert.throws(()=>sshArgs('-oProxyCommand=bad',values),{code:'INVALID_HOST'})
 const dir=root(t),config=path.join(dir,'config');fs.writeFileSync(config,'Host work two\n Host *.example !excluded\nHost other\n')
 assert.deepEqual(discoverAliases(config),{aliases:['other','two','work']})
})
test('explicit connect alone installs host service, reconnect retains remote identity, config contains no credentials',async t=>{
 const dir=root(t),calls=[];let closed=0
 const remoteSnapshot={version:1,seq:1,projects:[{id:'project',hostId:'local'}],profiles:[],sessions:[{id:'session',hostId:'local',pid:123}]}
 const manager=new RemoteHosts(dir,{run:async(alias,argv,input)=>{calls.push({alias,argv,input});return argv.includes(INSTALL)?JSON.stringify({bridge:'/home/me/.local/share/zq/code/bundles/hash/remote-bridge.cjs'}):''},open:async()=>({close(){closed++},request:async()=>structuredClone(remoteSnapshot)})})
 const host=manager.create({name:'Work',sshAlias:'work'});assert.equal(calls.length,0)
 await manager.connect(host.id);assert.equal(calls.length,2);assert.equal(manager.snapshots.get(host.id).sessions[0].pid,123)
 assert.equal(manager.snapshots.get(host.id).sessions[0].hostId,host.id)
 manager.disconnect(host.id);await manager.connect(host.id);assert.equal(manager.snapshots.get(host.id).sessions[0].pid,123)
 assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(path.join(dir,'hosts.json')))[0]).sort(),['id','name','sshAlias'])
 assert.equal(closed,1);manager.close()
})
test('remote installer preserves private scope and refuses changed code or symlinks',t=>{
 const home=root(t),env={...process.env,HOME:home},files=JSON.stringify({'remote-bridge.cjs':'module.exports = 1'})
 const run=()=>JSON.parse(execFileSync(process.execPath,['-e',INSTALL],{env,input:files,stdio:['pipe','pipe','ignore']}).toString())
 const {bridge}=run();assert.ok(bridge.startsWith(home+'/'));assert.equal(fs.statSync(bridge).mode&0o777,0o600);assert.equal(run().bridge,bridge)
 fs.writeFileSync(bridge,'changed');assert.throws(run)
 fs.unlinkSync(bridge);fs.symlinkSync('/etc/passwd',bridge);assert.throws(run)
})
test('preview accepts only credential-free HTTP loopback with valid ports',()=>{
 for(const value of ['file:///etc/passwd','javascript:alert(1)','https://example.com','http://127.0.0.1:99999','http://user:secret@localhost/','http://0.0.0.0'])assert.throws(()=>previewURL(value))
 assert.equal(previewURL('http://[::1]:3000/path?q=1').port,3000)
})
test('preview forwarding binds loopback, owns only its child and records process exit',async()=>{
 const children=[],args=[]
 const previews=new Previews({allocatePort:async()=>34567,probe:async()=>true,spawnProcess:(file,argv)=>{args.push(argv);const p=new EventEmitter();p.stdout=new EventEmitter();queueMicrotask(()=>p.stdout.emit('data','zq-forward-ready'));p.kill=()=>{p.killed=true;p.emit('exit',0)};children.push(p);return p}})
 const local=await previews.open({id:'p'},'http://localhost:3000/a');assert.equal(local.forwarded,false)
 const remote=await previews.open({id:'r'},'http://localhost:4000/a',{sshAlias:'work'})
 assert.equal(remote.url,'http://127.0.0.1:34567/a');assert.ok(args[0].includes('127.0.0.1:34567:127.0.0.1:4000'))
 children[0].emit('exit',1);assert.equal(remote.state,'stopped')
 const again=await previews.open({id:'r'},'http://localhost:4000/',{sshAlias:'work'})
 previews.stop(again.id);assert.equal(children[1].killed,true);assert.equal(local.state,'ready');previews.close()
})
test('generic adapter passes launcher verbatim without Claude identity or structured flags',()=>{
 const launch=buildTerminalLaunch({profile:{hostId:'local',adapter:'terminal',modes:['terminal'],launcherFile:'/tmp/a b.zsh',functionName:'local-model'},session:{hostId:'local',cwd:'/tmp'},mode:'terminal'})
 assert.deepEqual(launch.args.slice(3),['/tmp/a b.zsh','local-model']);assert.ok(!launch.args.includes('--resume'))
 assert.throws(()=>buildTerminalLaunch({profile:{adapter:'terminal'},mode:'chat'}),{code:'MODE_UNSUPPORTED'})
})
