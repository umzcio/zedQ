const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{randomUUID}=require('node:crypto')
const {keys,atomic}=require('./code-catalog.cjs'),{fail,uuid}=require('./service-storage.cjs')
const {readClaudeHistory}=require('./claude-history.cjs')
const {assertNoNativeCLI}=require('./kimi-sessions.cjs')
const {validNativeId}=require('./kimi-protocol.cjs')
function seedNativeProfiles(catalog){
  if(catalog.value.codexProfilesSeeded)return
  const source=process.env.ZQ_NATIVE_PROFILE_SEED || path.join(os.homedir(),'GitHub/dotfiles/codex/multi-account.zsh')
  for(const name of ['codex','codex-gmail']){
    if(catalog.value.profiles.some(p=>p.hostId==='local'&&p.functionName===name))continue
    if(name!=='codex'){let text='';try{text=fs.readFileSync(source,'utf8')}catch{};if(!/^\s*(?:function\s+)?codex-gmail\s*(?:\(\s*\)|\{)/m.test(text))continue}
    catalog.value.profiles.push(catalog.profile({name,functionName:name,launcherFile:name==='codex'?'/dev/null':source,adapter:'codex',sharedHistoryConfirmed:true}))
  }
  catalog.value.codexProfilesSeeded=true;catalog.save()
}
class NativeSessions {
  constructor(host){this.host=host;this.rows=new Map();this.opening=new Set()}
  async list(input={}){
    keys(input,['agent'])
    if(input.agent && !['claude','codex','kimi'].includes(input.agent))fail('INVALID_REQUEST')
    const h=this.host,profiles=h.catalog.value.profiles.filter(p=>p.hostId==='local'),sources=[
      {agent:'kimi',name:'Kimi',profileId:'',read:()=>h.kimi.list()},
      {agent:'claude',name:'Claude',profileId:profiles.find(p=>p.functionName==='claude')?.id||'',read:()=>readClaudeHistory(h.nodePath,'list')},
      ...profiles.filter(p=>p.adapter==='codex').map(p=>({agent:'codex',name:p.name,profileId:p.id,read:()=>h.codex.list(p.id)}))
    ].filter(source=>!input.agent||source.agent===input.agent)
    const results=await Promise.allSettled(sources.map(s=>s.read())), rows=new Map(),errors=[];let truncated=false
    for(let i=0;i<results.length;i++){
      const result=results[i],source=sources[i]
      if(result.status==='rejected'){errors.push({source:source.name,code:result.reason.code||'NATIVE_DISCOVERY_FAILED'});continue}
      truncated ||= result.value.truncated
      for(const native of result.value.sessions){
        if(!validNativeId(native.nativeId))continue
        const key=source.agent+':'+native.nativeId
        const previous=rows.get(key),profileIds=source.agent==='claude'?profiles.filter(p=>(p.adapter||'claude')==='claude'&&(p.functionName==='claude'||p.sharedHistoryConfirmed)).map(p=>p.id):source.profileId?[source.profileId]:[]
        const existing=h.catalog.value.sessions.find(s=>s.hostId==='local'&&s.adapter===source.agent&&s.nativeId===native.nativeId)
        rows.set(key,{...native,key,agent:source.agent,hostId:'local',sessionId:existing?.id,modes:['chat','terminal'],profileIds:[...new Set([...(previous?.profileIds||[]),...profileIds])]})
      }
    }
    if(input.agent){for(const [key,row]of this.rows)if(row.agent===input.agent)this.rows.delete(key);for(const [key,row]of rows)this.rows.set(key,row)}else this.rows=rows
    return {sessions:[...rows.values()].sort((a,b)=>b.updatedAt-a.updatedAt),errors,truncated}
  }
  async open(owner,input){
    keys(input,['agent','nativeId','profileId','mode','cwd'])
    const {agent,mode='chat'}=input,fresh=!input.nativeId
    if(!['claude','codex','kimi'].includes(agent)||!['chat','terminal'].includes(mode))fail('INVALID_REQUEST')
    if(!fresh&&!validNativeId(input.nativeId))fail('INVALID_REQUEST')
    if(fresh&&(typeof input.cwd!=='string'||!path.isAbsolute(input.cwd)))fail('INVALID_REQUEST')
    const key=agent+':'+(input.nativeId||input.cwd)
    if(this.opening.has(key))fail('SWITCH_IN_PROGRESS');this.opening.add(key)
    try{
      const h=this.host
      let existing=!fresh&&h.catalog.value.sessions.find(s=>s.hostId==='local'&&s.adapter===agent&&s.nativeId===input.nativeId)
      if(existing){
        if(h.leases.has(existing.id)&&h.leases.get(existing.id)!==owner)fail('LEASE_REQUIRED')
        h.leases.set(existing.id,owner);await h.status(existing)
        const changed=mode!==existing.mode||(input.profileId&&input.profileId!==existing.profileId)
        if(changed||['stopped','recoverable'].includes(existing.state))existing=await h.dispatch(owner,changed?'switchSession':'resumeSession',{id:existing.id,expectedRevision:existing.revision,mode,profileId:input.profileId||existing.profileId})
        existing.archivedAt=null;h.catalog.save();return existing
      }
      if(agent!=='claude')return h[agent].open(owner,{...(fresh?{cwd:input.cwd}:{nativeId:input.nativeId}),mode,...(input.profileId?{profileId:input.profileId}:{})},fresh)
      const p=input.profileId?h.catalog.value.profiles.find(p=>p.id===input.profileId):h.catalog.value.profiles.find(p=>p.functionName==='claude')
      if(!p||(p.adapter||'claude')!=='claude'||p.hostId!=='local')fail('INVALID_PROFILE')
      let native=fresh?{nativeId:randomUUID(),cwd:input.cwd,title:'New Claude session'}:this.rows.get(key)
      if(!native){await this.list();native=this.rows.get(key)}
      if(!native||!uuid(native.nativeId))fail('NATIVE_SESSION_NOT_FOUND')
      if(!fs.statSync(native.cwd).isDirectory())fail('WORKSPACE_UNAVAILABLE')
      await assertNoNativeCLI(native,'claude')
      if(h.catalog.value.sessions.length>=128)fail('LIMIT_REACHED')
      const s={id:randomUUID(),hostId:'local',projectId:h.catalog.value.projects.find(p=>p.hostId==='local'&&p.cwd===native.cwd)?.id||'',cwd:native.cwd,profileId:p.id,adapter:'claude',nativeId:native.nativeId,nativeIdVerified:false,ownership:'owned',nativeHistory:!fresh,mode,state:'starting',revision:0,title:native.title,createdAt:Date.now(),updatedAt:Date.now(),archivedAt:null,pid:null,error:null}
      h.catalog.value.sessions.push(s);h.catalog.save();h.leases.set(s.id,owner)
      // No earlier process exists for this newly registered native conversation.
      atomic(path.join(h.paths.root,s.id+'.ownership.json'),{state:'exited'})
      try{const handle=await h.start(s,{profile:p,mode},fresh);await h.ready(handle);s.nativeIdVerified=true;s.nativeHistory=true;s.state='ready'}
      catch(e){s.state='error';s.error=e.code||'NATIVE_START_FAILED';try{await h.stop(s)}catch{}}
      h.catalog.save();return s
    }finally{this.opening.delete(key)}
  }
}
module.exports={NativeSessions,seedNativeProfiles}
