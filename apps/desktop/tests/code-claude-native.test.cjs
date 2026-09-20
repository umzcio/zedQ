const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http')
const {execFile,execFileSync}=require('node:child_process'),{promisify}=require('node:util'),{CodeService}=require('../electron/code/code-service.cjs')
const exec=promisify(execFile),delay=ms=>new Promise(r=>setTimeout(r,ms))
async function until(fn){for(let n=0;n<300;n++){const value=await fn();if(value)return value;await delay(100)}throw Error('timeout')}
test('installed Claude CLI and Chat resume one native conversation with history replay', {skip:!process.env.ZQ_TEST_CLAUDE_NATIVE,timeout:120000},async t=>{
 const root=fs.mkdtempSync('/tmp/zq-claude-'),home=path.join(root,'home'),runtime=path.join(root,'runtime'),binary=path.join(os.homedir(),'.local/bin/claude');fs.mkdirSync(home,{mode:0o700})
 const requests=[]
 const server=http.createServer((req,res)=>{let body='';req.on('data',c=>body+=c);req.on('end',()=>{if(req.url.includes('count_tokens')){res.setHeader('Content-Type','application/json');return res.end('{"input_tokens":10}')}const data=JSON.parse(body||'{}');if(!Array.isArray(data.messages)){res.setHeader('Content-Type','application/json');return res.end('{}')}requests.push(data);const text='Native Claude fixture reply '+requests.length;const message={id:'msg_'+requests.length,type:'message',role:'assistant',model:data.model,content:[{type:'text',text}],stop_reason:'end_turn',stop_sequence:null,usage:{input_tokens:10,output_tokens:10}};if(!data.stream){res.setHeader('Content-Type','application/json');return res.end(JSON.stringify(message))}res.writeHead(200,{'Content-Type':'text/event-stream'});for(const event of [{type:'message_start',message:{...message,content:[],stop_reason:null}},{type:'content_block_start',index:0,content_block:{type:'text',text:''}},{type:'content_block_delta',index:0,delta:{type:'text_delta',text}},{type:'content_block_stop',index:0},{type:'message_delta',delta:{stop_reason:'end_turn',stop_sequence:null},usage:{output_tokens:10}},{type:'message_stop'}])res.write('event: '+event.type+'\ndata: '+JSON.stringify(event)+'\n\n');res.end()})})
 await new Promise(r=>server.listen(0,'127.0.0.1',r))
 const overrides={CLAUDE_CONFIG_DIR:home,ANTHROPIC_BASE_URL:`http://127.0.0.1:${server.address().port}`,ANTHROPIC_API_KEY:'isolated-fixture',CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC:'1',CODEX_HOME:path.join(root,'codex'),KIMI_CODE_HOME:path.join(root,'kimi'),ZQ_NATIVE_PROFILE_SEED:path.join(root,'none')},old=Object.fromEntries(Object.keys(overrides).map(k=>[k,process.env[k]]));Object.assign(process.env,overrides)
 const service=new CodeService({directory:runtime,tmuxPath:'/opt/homebrew/bin/tmux'})
 t.after(()=>{service.close();server.close();try{execFileSync('/opt/homebrew/bin/tmux',['-S',path.join(runtime,'tmux'),'kill-server'],{stdio:'ignore'})}catch{};for(const [k,v]of Object.entries(old)){if(v===undefined)delete process.env[k];else process.env[k]=v}fs.rmSync(root,{recursive:true,force:true,maxRetries:5,retryDelay:100})})
 const cli=args=>{const pending=exec(binary,args,{cwd:root,env:{...process.env},timeout:40000,maxBuffer:2*1024*1024});pending.child.stdin.end();return pending}
 await cli(['-p','CLI first fixture turn'])
 const list=await service.invoke('listNativeSessions');assert.equal(list.errors.filter(e=>e.source==='Claude').length,0,JSON.stringify(list.errors))
 const row=list.sessions.find(r=>r.agent==='claude');assert(row,JSON.stringify(list))
 const launcher=path.join(root,'fixture.zsh');fs.writeFileSync(launcher,`fixture-claude() { command '${binary}' "$@"; }\n`)
 const p=await service.invoke('createProfile',{name:'Fixture Claude',launcherFile:launcher,functionName:'fixture-claude',adapter:'claude',sharedHistoryConfirmed:true})
 let s=await service.invoke('openNativeSession',{agent:'claude',nativeId:row.nativeId,profileId:p.id,mode:'chat'})
 assert.equal(s.state,'ready',JSON.stringify(s));assert.equal(s.nativeId,row.nativeId)
 let events=(await service.invoke('events',{id:s.id,after:0})).events
 assert(events.some(e=>e.text.includes('CLI first fixture turn')),JSON.stringify(events))
 await service.invoke('sendMessage',{id:s.id,text:'Chat second fixture turn'})
 await until(async()=>{const e=(await service.invoke('events',{id:s.id,after:0})).events;return e.some(e=>e.kind==='assistant'&&e.text.includes('Native Claude fixture reply'))&&requests.some(r=>JSON.stringify(r.messages).includes('Chat second fixture turn'))})
 await until(async()=>(await service.invoke('snapshot')).sessions.find(r=>r.id===s.id).state==='ready')
 s=await service.invoke('stopSession',{id:s.id,expectedRevision:s.revision});assert.equal(s.state,'stopped',JSON.stringify(s))
 await cli(['--resume',row.nativeId,'-p','CLI third fixture turn'])
 assert(JSON.stringify(requests.at(-1)).includes('Chat second fixture turn'))
 if(process.env.ZQ_TEST_NATIVE_APP) {
  await require('./fixtures/native-session-ui.cjs')({root,agent:'Claude',nativeId:row.nativeId,historyText:'CLI first fixture turn',replyText:'Native Claude fixture reply 4',profile:{launcherFile:launcher,functionName:'fixture-claude'}})
  await cli(['--resume',row.nativeId,'-p','CLI after packaged native'])
  assert(JSON.stringify(requests.at(-1)).includes('Packaged native fourth turn'))
 }
 await require('./fixtures/native-pr-review.cjs')({service,root,agent:'claude',profileId:p.id,expected:'Native Claude fixture reply'})
 console.log('PASS: installed Claude native CLI → Chat → CLI; original ID and history preserved')
})
