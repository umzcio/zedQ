const fs = require('node:fs'), path = require('node:path'), os = require('node:os')
const {spawn} = require('node:child_process')
const {randomUUID,createHash} = require('node:crypto')
const {atomic,privateRead,keys,text} = require('./code-catalog.cjs')
const {fail} = require('./service-storage.cjs')
const quote = v => "'"+v.replace(/'/g,"'\\''")+"'"
const validAlias = v => typeof v === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.@-]{0,199}$/.test(v)
function sshArgs(alias, argv, tty=false) {
  if (!validAlias(alias) || !Array.isArray(argv) || argv.some(v=>typeof v!=='string'||v.includes('\0'))) fail('INVALID_HOST')
  return ['-o','BatchMode=yes','-o','ConnectTimeout=10','-o','ControlMaster=no','-o','ControlPath=none',...(tty?['-tt']:['-T']),'--',alias,argv.map(quote).join(' ')]
}
function discoverAliases(file=path.join(os.homedir(),'.ssh/config')) {
  const aliases=new Set(), visited=new Set()
  function read(config, depth=0) {
    if(depth>5 || visited.size>=32 || visited.has(config)) return
    visited.add(config)
    let data=''; try { const stat=fs.statSync(config); if(!stat.isFile()||stat.size>262144)return; data=fs.readFileSync(config,'utf8') } catch {return}
    for(const line of data.split('\n')) {
      const tokens=(line.match(/"[^"]*"|'[^']*'|#[^\n]*|[^\s#]+/g)||[]).filter(v=>!v.startsWith('#')).map(v=>v.replace(/^["']|["']$/g,''))
      const directive=tokens.shift()?.toLowerCase()
      if(directive==='host')for(const alias of tokens)if(validAlias(alias))aliases.add(alias)
      if(directive==='include')for(let pattern of tokens) {
        if(pattern.startsWith('~/'))pattern=path.join(os.homedir(),pattern.slice(2))
        if(!path.isAbsolute(pattern))pattern=path.join(config.startsWith('/etc/ssh/')?'/etc/ssh':path.join(os.homedir(),'.ssh'),pattern)
        try {for(const next of fs.globSync(pattern))read(next,depth+1)}catch{}
      }
    }
  }
  read(file)
  if(file===path.join(os.homedir(),'.ssh/config'))read('/etc/ssh/ssh_config')
  return {aliases:[...aliases].sort()}
}
function runSSH(alias, argv, input, spawnProcess=spawn) {
  return new Promise((resolve,reject)=>{
    const child=spawnProcess('/usr/bin/ssh',sshArgs(alias,argv),{stdio:['pipe','pipe','pipe']})
    child.stdout.setEncoding('utf8')
    let output='',failed=false
    const timer=setTimeout(()=>{failed=true;child.kill();reject(Object.assign(new Error('SSH_CONNECTION_FAILED'),{code:'SSH_CONNECTION_FAILED'}))},20000)
    child.stdout.on('data',b=>{output+=b.toString();if(Buffer.byteLength(output)>65536){failed=true;child.kill()}})
    child.stderr.on('data',()=>{}) // remote shell output may contain secrets; never persist or return it
    child.on('error',()=>{clearTimeout(timer);reject(Object.assign(new Error('SSH_UNAVAILABLE'),{code:'SSH_UNAVAILABLE'}))})
    child.on('close',code=>{clearTimeout(timer);if(!failed&&code===0)resolve(output);else reject(Object.assign(new Error('SSH_CONNECTION_FAILED'),{code:'SSH_CONNECTION_FAILED'}))})
    child.stdin.on('error',()=>{});child.stdin.end(input||'')
  })
}
// Fixed installer, fed only shipped code bytes. No shell interpolation, credentials,
// renderer-selected install path, or remote startup files are copied into zQ.
const INSTALL = `const fs=require('fs'),path=require('path'),os=require('os'),crypto=require('crypto');let raw='';process.stdin.setEncoding('utf8');process.stdin.on('data',b=>{raw+=b;if(raw.length>2097152)process.exit(2)});process.stdin.on('end',()=>{const files=JSON.parse(raw);const base=path.join(os.homedir(),'.local/share/zq');fs.mkdirSync(base,{recursive:true,mode:448});for(const dir of [base,path.join(base,'code'),path.join(base,'code','bundles')]){fs.mkdirSync(dir,{recursive:true,mode:448});const s=fs.lstatSync(dir);if(!s.isDirectory()||s.isSymbolicLink()||s.uid!==process.getuid()||(s.mode&63))process.exit(3)}const digest=crypto.createHash('sha256').update(raw).digest('hex');const dest=path.join(base,'code','bundles',digest);fs.mkdirSync(dest,{mode:448,recursive:true});const st=fs.lstatSync(dest);if(!st.isDirectory()||st.isSymbolicLink()||st.uid!==process.getuid()||(st.mode&63))process.exit(3);for(const [name,content] of Object.entries(files)){if(!/^[a-z-]+\\.cjs$/.test(name))process.exit(4);const file=path.join(dest,name);if(fs.existsSync(file)){const s=fs.lstatSync(file);if(!s.isFile()||s.isSymbolicLink()||s.uid!==process.getuid()||(s.mode&63)||s.nlink!==1||fs.readFileSync(file,'utf8')!==content)process.exit(5)}else fs.writeFileSync(file,content,{flag:'wx',mode:384})}process.stdout.write(JSON.stringify({bridge:path.join(dest,'remote-bridge.cjs')}))})`
function bundle(){return Object.fromEntries(fs.readdirSync(__dirname).filter(n=>/^[a-z-]+\.cjs$/.test(n)).sort().map(n=>[n,fs.readFileSync(path.join(__dirname,n),'utf8')]))}
function openRemote(alias, bridge, spawnProcess=spawn) {
  return new Promise((resolve,reject)=>{
    const child=spawnProcess('/usr/bin/ssh',sshArgs(alias,['node',bridge]),{stdio:['pipe','pipe','pipe']})
    const pending=new Map();let buffer='',serial=0,ready=false,metadata
    const error=code=>Object.assign(new Error(code),{code})
    const timer=setTimeout(()=>{child.kill();reject(error('SSH_SERVICE_TIMEOUT'))},15000)
    const client={close:()=>child.kill(),get metadata(){return metadata},request(method,params={}){
      const id=++serial,data=JSON.stringify({id,method,params})+'\n'
      if(Buffer.byteLength(data)>65536||pending.size>=16)return Promise.reject(error('INVALID_REQUEST'))
      if(child.exitCode!==null||child.killed)return Promise.reject(error('SERVICE_DISCONNECTED'))
      return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{pending.delete(id);child.kill();reject(error('SERVICE_REQUEST_TIMEOUT'))},75000);pending.set(id,{resolve,reject,timer});child.stdin.write(data)})
    }}
    child.stdout.setEncoding('utf8')
    child.stderr.on('data',()=>{});child.stdin.on('error',()=>{})
    child.on('error',()=>{clearTimeout(timer);reject(error('SSH_CONNECTION_FAILED'))})
    child.on('close',()=>{clearTimeout(timer);if(!ready)reject(error('SSH_CONNECTION_FAILED'));for(const p of pending.values()){clearTimeout(p.timer);p.reject(error('SERVICE_DISCONNECTED'))}pending.clear()})
    child.stdout.on('data',chunk=>{
      buffer+=chunk;if(Buffer.byteLength(buffer)>512*1024){child.kill();return}
      let end;while((end=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,end);buffer=buffer.slice(end+1);let m
        try{m=JSON.parse(line)}catch{child.kill();return}
        if(!ready){if(!m.ready||!path.posix.isAbsolute(m.root)||!path.posix.isAbsolute(m.tmuxPath)){child.kill();return}ready=true;metadata=m;clearTimeout(timer);resolve(client)}
        else {const p=pending.get(m.id);if(!p)continue;pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(error(m.error)):p.resolve(m.result)}
      }
    })
  })
}
class RemoteHosts {
  constructor(root,{run=runSSH,open=openRemote}={}){this.file=path.join(root,'hosts.json');this.run=run;this.open=open;this.clients=new Map();this.snapshots=new Map();try{this.hosts=privateRead(this.file)}catch(e){if(e.code!=='ENOENT')throw e;this.hosts=[]}}
  save(){atomic(this.file,this.hosts)}
  rows(){return this.hosts.map(h=>({...h,kind:'ssh',available:this.clients.has(h.id),error:this.clients.has(h.id)?null:'Connect to access this host.'}))}
  find(id){const h=this.hosts.find(h=>h.id===id);if(!h)fail('HOST_NOT_FOUND');return h}
  create(input){keys(input,['name','sshAlias']);if(!text(input.name,200)||!validAlias(input.sshAlias)||this.hosts.length>=32)fail('INVALID_HOST');const h={id:randomUUID(),name:input.name,sshAlias:input.sshAlias};this.hosts.push(h);this.save();return this.rows().find(r=>r.id===h.id)}
  update({id,patch}){const h=this.find(id);keys(patch,['name','sshAlias']);if((patch.name!==undefined&&!text(patch.name,200))||(patch.sshAlias!==undefined&&!validAlias(patch.sshAlias)))fail('INVALID_HOST');if(patch.sshAlias&&patch.sshAlias!==h.sshAlias)fail('HOST_ALIAS_IMMUTABLE');Object.assign(h,patch);this.save();return this.rows().find(r=>r.id===id)}
  delete(id){this.find(id);this.disconnect(id);this.hosts=this.hosts.filter(h=>h.id!==id);this.snapshots.delete(id);this.save();return {ok:true}}
  async connect(id){const h=this.find(id);if(this.clients.has(id))return this.rows().find(r=>r.id===id)
    await this.run(h.sshAlias,['/bin/sh','-c','command -v node >/dev/null && command -v tmux >/dev/null && test -x /bin/zsh'])
    const installed=JSON.parse(await this.run(h.sshAlias,['node','-e',INSTALL],JSON.stringify(bundle())))
    if(!path.posix.isAbsolute(installed.bridge)||!installed.bridge.endsWith('/remote-bridge.cjs'))fail('SSH_BOOTSTRAP_FAILED')
    const c=await this.open(h.sshAlias,installed.bridge);this.clients.set(id,c)
    try{await this.snapshot(id)}catch(e){this.disconnect(id);throw e}return this.rows().find(r=>r.id===id)
  }
  disconnect(id){this.clients.get(id)?.close();this.clients.delete(id);return {ok:true}}
  async request(id,method,input){const c=this.clients.get(id);if(!c)fail('HOST_DISCONNECTED');try{return await c.request('code:'+method,input)}catch(e){if(['SERVICE_DISCONNECTED','SERVICE_REQUEST_TIMEOUT'].includes(e.code))this.disconnect(id);throw e}}
  async snapshot(id){const s=await this.request(id,'snapshot',{});for(const key of ['projects','profiles','sessions'])for(const r of s[key])r.hostId=id;this.snapshots.set(id,s);return s}
  close(){for(const id of this.clients.keys())this.disconnect(id)}
}
module.exports={RemoteHosts,sshArgs,quote,discoverAliases,runSSH,openRemote,INSTALL}
