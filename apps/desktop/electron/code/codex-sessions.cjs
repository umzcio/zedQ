const os=require('node:os')
const {spawn}=require('node:child_process')
const {KimiSessions}=require('./kimi-sessions.cjs')
const {buildProfileLaunch}=require('./profile-launch.cjs')
const {fail}=require('./service-storage.cjs')
// Short-lived discovery process, no thread is resumed and no model is called.
function codexRead(profile, method, params, cwd=os.homedir()) {
  const launch=buildProfileLaunch(profile,cwd,['app-server','--stdio'],true)
  return new Promise((resolve,reject)=>{
    const env={...process.env};delete env.ELECTRON_RUN_AS_NODE
    const child=spawn(launch.file,launch.args,{cwd,env,detached:true,stdio:['pipe','pipe','pipe']});let buffer='',settled=false
    const finish=(error,result)=>{if(settled)return;settled=true;clearTimeout(timer);child.stdin.end();try{process.kill(-child.pid,'SIGTERM')}catch{};error?reject(Object.assign(new Error(error),{code:error})):resolve(result)}
    const timer=setTimeout(()=>finish('CODEX_DISCOVERY_FAILED'),15000)
    const send=m=>child.stdin.write(JSON.stringify(m)+'\n')
    child.stderr.resume();child.stdin.on('error',()=>finish('CODEX_DISCOVERY_FAILED'));child.on('error',()=>finish('CODEX_NOT_INSTALLED'));child.on('exit',()=>finish('CODEX_DISCOVERY_FAILED'))
    child.stdout.setEncoding('utf8');child.stdout.on('data',chunk=>{
      buffer+=chunk;if(Buffer.byteLength(buffer)>4*1024*1024)return finish('PROTOCOL_TOO_LARGE')
      let n;while((n=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,n);buffer=buffer.slice(n+1);if(!line.trim())continue;let m;try{m=JSON.parse(line)}catch{return finish('INVALID_PROTOCOL')}
        if(m.error)return finish('CODEX_DISCOVERY_FAILED')
        if(m.id===1){send({method:'initialized'});send({id:2,method,params})}else if(m.id===2)return finish(null,m.result)
      }
    })
    send({id:1,method:'initialize',params:{clientInfo:{name:'zq_history',version:'1.6.0'},capabilities:{experimentalApi:true}}})
  })
}
class CodexSessions extends KimiSessions {
  constructor(host){super(host,'codex');this.cache=new Map();this.reads=new Map()}
  profileId(id){const profiles=this.host.catalog.value.profiles;const p=id?profiles.find(p=>p.id===id):profiles.find(p=>p.adapter==='codex'&&p.functionName==='codex');if(!p||p.adapter!=='codex'||p.hostId!=='local')fail('INVALID_PROFILE');return p.id}
  profile(id){return this.host.catalog.find('profiles',this.profileId(id))}
  launch(s,mode){return buildProfileLaunch(this.profile(s.profileId),s.cwd,mode==='chat'?['app-server','--stdio']:['resume',s.nativeId],true)}
  async list(profileId){profileId=this.profileId(profileId);if(this.reads.has(profileId))return this.reads.get(profileId)
    const read=codexRead(this.profile(profileId),'thread/list',{limit:200,sortKey:'updated_at',sourceKinds:['cli','vscode','exec','appServer'],archived:false}).then(r=>{
      if(!Array.isArray(r.data))fail('INVALID_PROTOCOL')
      const result={sessions:r.data.filter(t=>typeof t.cwd==='string'&&t.cwd.startsWith('/')).map(t=>({nativeId:t.id,cwd:t.cwd,title:String(t.name||t.preview||'Codex session').slice(0,200),updatedAt:t.updatedAt*1000})),truncated:!!r.nextCursor};this.cache.set(profileId,{result,at:Date.now()});return result
    }).finally(()=>this.reads.delete(profileId));this.reads.set(profileId,read);return read
  }
  async resolveNative(id,profileId){const cached=this.cache.get(profileId);return (cached&&Date.now()-cached.at<30000?cached.result:await this.list(profileId)).sessions.find(s=>s.nativeId===id)}
  async validateProfile(s,id){this.profileId(id);if(id===s.profileId)return
    // Verify actual native availability before stopping the source profile.
    const target=await codexRead(this.profile(id),'thread/read',{threadId:s.nativeId,includeTurns:false},s.cwd)
    if(target.thread?.id!==s.nativeId||target.thread.cwd!==s.cwd)fail('SHARED_HISTORY_UNCONFIRMED')
  }
}
module.exports={CodexSessions,codexRead}
