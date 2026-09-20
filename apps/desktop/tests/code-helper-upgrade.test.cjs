const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{randomUUID}=require('node:crypto'),{execFileSync}=require('node:child_process');
const {connectCodeService}=require('../electron/code/session-client.cjs'),{createTmux}=require('../electron/code/tmux.cjs');
test('refreshing an older helper preserves owned terminal PID and enables quick terminal creation',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'zq-upgrade-')),old=path.join(root,'old'),runtime=path.join(root,'runtime'),tmuxPath='/opt/homebrew/bin/tmux',env={...process.env,TMUX_TMPDIR:root};fs.mkdirSync(old);
 for(const name of fs.readdirSync(path.resolve(__dirname,'../electron/code')).filter(n=>n.endsWith('.cjs')))fs.copyFileSync(path.resolve(__dirname,'../electron/code',name),path.join(old,name));
 const file=path.join(old,'code-host.cjs');let source=fs.readFileSync(file,'utf8'),a=source.indexOf("    if (method === 'createTerminal') {"),b=source.indexOf("    if (method === 'attachExternalTerminal') {",a);source=source.slice(0,a)+source.slice(b);fs.writeFileSync(file,source);
 let client;const tmux=createTmux({binary:tmuxPath,socket:path.join(runtime,'tmux'),env});
 t.after(()=>{client?.close();for(const args of [['-S',path.join(runtime,'tmux'),'kill-server'],['kill-server']])try{execFileSync(tmuxPath,args,{env,stdio:'ignore'})}catch{}fs.rmSync(root,{recursive:true,force:true});});
 client=await require(path.join(old,'session-client.cjs')).connectCodeService({root:runtime,tmuxPath,env});
 const id=randomUUID(),row=await client.request('create',{id,launch:{file:'/bin/sleep',args:['3600'],cwd:root}});
 await assert.rejects(client.request('code:createTerminal',{hostId:'local',name:'quick-shell'}),{code:'INVALID_REQUEST'});
 client.close();await tmux.stop('zq-service');
 client=await connectCodeService({root:runtime,tmuxPath,env});
 assert.equal((await client.request('snapshot',{id})).pid,row.pid);
 const created=await client.request('code:createTerminal',{hostId:'local',name:'quick-shell'});assert.equal(created.mode,'terminal');assert.equal(created.hostId,'local');assert.equal(created.projectId,'');
});
