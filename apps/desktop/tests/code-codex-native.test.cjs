const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http')
const {execFile,execFileSync}=require('node:child_process'),{promisify}=require('node:util'),{CodeService}=require('../electron/code/code-service.cjs')
const exec=promisify(execFile),delay=ms=>new Promise(r=>setTimeout(r,ms))
async function until(fn){for(let n=0;n<200;n++){const value=await fn();if(value)return value;await delay(100)}throw Error('timeout')}
test('installed Codex CLI and Chat resume the same native thread with unchanged history', {skip:!process.env.ZQ_TEST_CODEX_NATIVE,timeout:120000},async t=>{
 const root=fs.mkdtempSync('/tmp/zq-codex-'),home=path.join(root,'home'),runtime=path.join(root,'runtime'),binary=path.join(os.homedir(),'.local/bin/codex');fs.mkdirSync(home,{mode:0o700})
 const requests=[]
 const server=http.createServer((req,res)=>{let body='';req.on('data',c=>body+=c);req.on('end',()=>{const data=JSON.parse(body||'{}');requests.push(data);const text='Native Codex fixture reply '+requests.length;res.writeHead(200,{'Content-Type':'text/event-stream'});const item={id:'msg_'+requests.length,type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text,annotations:[]}]};for(const event of [{type:'response.created',response:{id:'resp_'+requests.length,status:'in_progress',output:[]}},{type:'response.output_item.added',output_index:0,item:{...item,status:'in_progress',content:[]}},{type:'response.content_part.added',item_id:item.id,output_index:0,content_index:0,part:{type:'output_text',text:'',annotations:[]}},{type:'response.output_text.delta',item_id:item.id,output_index:0,content_index:0,delta:text},{type:'response.output_item.done',output_index:0,item},{type:'response.completed',response:{id:'resp_'+requests.length,status:'completed',output:[item],usage:{input_tokens:10,output_tokens:10,total_tokens:20}}}])res.write('data: '+JSON.stringify(event)+'\n\n');res.end()})})
 await new Promise(r=>server.listen(0,'127.0.0.1',r))
 fs.writeFileSync(path.join(home,'config.toml'),`model_provider = "fixture"\nmodel = "fixture"\napproval_policy = "never"\nsandbox_mode = "workspace-write"\n[model_providers.fixture]\nname = "Fixture"\nbase_url = "http://127.0.0.1:${server.address().port}/v1"\nwire_api = "responses"\nrequires_openai_auth = false\n`)
 const envKeys=['CODEX_HOME','CLAUDE_CONFIG_DIR','KIMI_CODE_HOME','ZQ_NATIVE_PROFILE_SEED'],old=Object.fromEntries(envKeys.map(k=>[k,process.env[k]]))
 Object.assign(process.env,{CODEX_HOME:home,CLAUDE_CONFIG_DIR:path.join(root,'claude'),KIMI_CODE_HOME:path.join(root,'kimi'),ZQ_NATIVE_PROFILE_SEED:path.join(root,'none')})
 const service=new CodeService({directory:runtime,tmuxPath:'/opt/homebrew/bin/tmux'})
 t.after(()=>{service.close();server.close();try{execFileSync('/opt/homebrew/bin/tmux',['-S',path.join(runtime,'tmux'),'kill-server'],{stdio:'ignore'})}catch{};for(const [k,v]of Object.entries(old)){if(v===undefined)delete process.env[k];else process.env[k]=v}fs.rmSync(root,{recursive:true,force:true,maxRetries:5,retryDelay:100})})
 const cli=args=>{const pending=exec(binary,args,{cwd:root,env:{...process.env},timeout:30000,maxBuffer:2*1024*1024});pending.child.stdin.end();return pending}
 await cli(['exec','--skip-git-repo-check','CLI first fixture turn'])
 const list=await service.invoke('listNativeSessions')
 assert.equal(list.errors.filter(e=>e.source==='codex').length,0,JSON.stringify(list.errors))
 const row=list.sessions.find(r=>r.agent==='codex');assert(row,JSON.stringify(list))
 let s=await service.invoke('openNativeSession',{agent:'codex',nativeId:row.nativeId,profileId:row.profileIds[0],mode:'chat'})
 assert.equal(s.state,'ready',JSON.stringify(s));assert.equal(s.nativeId,row.nativeId)
 let events=(await service.invoke('events',{id:s.id,after:0})).events
 assert(events.some(e=>e.text.includes('CLI first fixture turn')),JSON.stringify(events))
 await service.invoke('sendMessage',{id:s.id,text:'Chat second fixture turn'})
 await until(async()=>{const e=(await service.invoke('events',{id:s.id,after:0})).events;return e.some(e=>e.text.includes('Native Codex fixture reply 2'))})
 await until(async()=>(await service.invoke('snapshot')).sessions.find(r=>r.id===s.id).state==='ready')
 const launcher=path.join(root,'profiles.zsh');fs.writeFileSync(launcher,`fixture-codex() { command '${binary}' "$@"; }\n`)
 const alternate=await service.invoke('createProfile',{name:'Alternate Codex fixture',launcherFile:launcher,functionName:'fixture-codex',adapter:'codex',sharedHistoryConfirmed:true})
 s=await service.invoke('switchSession',{id:s.id,expectedRevision:s.revision,profileId:alternate.id,mode:'terminal'})
 assert.equal(s.state,'ready',JSON.stringify(s));assert.equal(s.profileId,alternate.id);assert.equal(s.nativeId,row.nativeId)
 s=await service.invoke('switchSession',{id:s.id,expectedRevision:s.revision,profileId:row.profileIds[0],mode:'chat'})
 assert.equal(s.state,'ready',JSON.stringify(s));assert.equal(s.nativeId,row.nativeId)
 events=(await service.invoke('events',{id:s.id,after:0})).events
 assert(events.some(e=>e.text.includes('Chat second fixture turn')))
 s=await service.invoke('stopSession',{id:s.id,expectedRevision:s.revision});assert.equal(s.state,'stopped',JSON.stringify(s))
 await cli(['exec','resume','--skip-git-repo-check',row.nativeId,'CLI third fixture turn'])
 assert(JSON.stringify(requests.at(-1)).includes('Chat second fixture turn'))
 if(process.env.ZQ_TEST_NATIVE_APP) {
  await require('./fixtures/native-session-ui.cjs')({root,agent:'Codex',nativeId:row.nativeId,historyText:'CLI first fixture turn',replyText:'Native Codex fixture reply 4'})
  await cli(['exec','resume','--skip-git-repo-check',row.nativeId,'CLI after packaged native'])
  assert(JSON.stringify(requests.at(-1)).includes('Packaged native fourth turn'))
 }
 console.log('PASS: installed Codex native CLI → Chat → CLI; original ID and history preserved')
})
