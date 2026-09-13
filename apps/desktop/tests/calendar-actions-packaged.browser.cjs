// Real packaged OAuth/Keychain/MCP/chat and approval UI; all cloud/model traffic is a local fixture.
const {_electron:electron}=require('playwright-core');
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),net=require('node:net'),assert=require('node:assert/strict');
const output=path.resolve('.local-data/calendar-actions-verification');fs.mkdirSync(output,{recursive:true});const directory=fs.mkdtempSync(path.join(output,'profile-'));
let app,page,origin,authorization,mode='create_event',event,mutations=[],chatCalls=0;
const times={start:{dateTime:'2026-09-15T10:00:00-05:00',timeZone:'America/Chicago'},end:{dateTime:'2026-09-15T11:00:00-05:00',timeZone:'America/Chicago'}};
const moved={start:{dateTime:'2026-09-16T14:00:00-05:00',timeZone:'America/Chicago'},end:{dateTime:'2026-09-16T15:00:00-05:00',timeZone:'America/Chicago'}};
const unwrap=r=>{assert.equal(r.ok,true,JSON.stringify(r.error));return r.value};
const server=http.createServer(async(req,res)=>{try{
 let text='';for await(const chunk of req)text+=chunk;const url=new URL(req.url,origin),json=(data,status=200)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(data))};
 if(url.pathname==='/.well-known/oauth-authorization-server')return json({issuer:'https://accounts.google.com',authorization_endpoint:'https://accounts.google.com/o/oauth2/v2/auth',token_endpoint:'https://oauth2.googleapis.com/token',response_types_supported:['code'],grant_types_supported:['authorization_code','refresh_token'],token_endpoint_auth_methods_supported:['client_secret_post'],code_challenge_methods_supported:['S256'],authorization_response_iss_parameter_supported:true});
 if(url.pathname==='/authorize'){authorization=url;const callback=new URL(url.searchParams.get('redirect_uri'));callback.searchParams.set('state',url.searchParams.get('state'));callback.searchParams.set('code','fixture-code');callback.searchParams.set('iss','https://accounts.google.com');assert.equal((await fetch(callback)).status,200);return json({ok:true})}
 if(url.pathname==='/token')return json({access_token:'fixture-calendar-token',refresh_token:'fixture-refresh',token_type:'Bearer',expires_in:3600,scope:authorization.searchParams.get('scope')});
 if(url.pathname.startsWith('/calendar/v3/')){
  assert.equal(req.headers.authorization,'Bearer fixture-calendar-token');
  if(req.method==='GET')return json(url.pathname.includes('/events/')?event:url.pathname.endsWith('/calendarList')?{items:[{id:'primary'}]}:{id:'me@example.test',summary:'Personal fixture',timeZone:'America/Chicago',accessRole:'owner'});
  assert.equal(url.searchParams.get('sendUpdates'),'all');
  if(req.method==='POST'){const body=JSON.parse(text);assert.equal(body.summary,'Planning session');event={...body,etag:'"v1"',organizer:{self:true,email:'me@example.test'},htmlLink:'https://calendar.google.com/calendar/event?eid=fixture'}}
  else{assert.equal(req.headers['if-match'],event.etag);if(req.method==='PATCH')event={...event,...JSON.parse(text),etag:'"v2"'};else assert.equal(req.method,'DELETE')}
  mutations.push(req.method);if(req.method==='DELETE'){res.writeHead(204);return res.end()}return json(event);
 }
 if(url.pathname==='/api/show')return json({capabilities:['tools']});
 if(url.pathname==='/api/tags')return json({models:[{name:'fixture:tools',model:'fixture:tools',details:{family:'fixture'}}]});
 if(url.pathname==='/api/chat'){
  chatCalls++;const body=JSON.parse(text),tool=body.tools?.find(t=>t.function.name.startsWith('mcp_'));assert.ok(tool);
  const after=body.messages.at(-1)?.role==='tool';if(after){const result=JSON.parse(body.messages.at(-1).content);assert.ok(!result.isError);assert.match(body.messages.at(-1).content,/confirmed|cancelled/)}
  const args=mode==='create_event'?{summary:'Planning session',...times,attendees:['friend@example.test'],location:'Office'}:mode==='reschedule_event'?{eventId:event.id,...moved}:{eventId:event.id};
  const message=after?{content:'Calendar action confirmed.'}:{content:'',tool_calls:[{function:{index:0,name:tool.function.name,arguments:args}}]};res.writeHead(200,{'Content-Type':'application/x-ndjson'});return res.end(JSON.stringify({message:{role:'assistant',...message},done:false})+'\n'+JSON.stringify({done:true,done_reason:'stop'})+'\n');
 }
 throw Error('Unexpected fixture route '+url.pathname);
}catch(error){console.error(error);res.writeHead(500);res.end()}});
async function reply(id,predicate){const end=Date.now()+15000;while(Date.now()<end){const state=unwrap(await page.evaluate(()=>window.zq.chat.load()));const last=state.conversations.find(c=>c.id===id)?.messages.at(-1);if(last?.status==='error')throw Error(last.error);if(predicate(last))return last;await new Promise(r=>setTimeout(r,50))}throw Error('Expected chat state did not arrive')}
(async()=>{try{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));origin=`http://127.0.0.1:${server.address().port}`;
 app=await electron.launch({executablePath:process.env.ZQ_TEST_APP,env:{...process.env,ZQ_DATA_DIR:directory},timeout:30000});page=await app.firstWindow();await page.waitForFunction(()=>!!window.zq);
 await app.evaluate(({app,shell},origin)=>{const load=process.getBuiltinModule('module').createRequire(app.getAppPath()+'/electron/main.cjs');const {ConnectorService}=load('./mcp/service.cjs'),connect=ConnectorService.prototype.connect;ConnectorService.prototype.connect=function(...args){this.fetchImpl=(raw,init)=>{const url=new URL(raw);if(!['accounts.google.com','oauth2.googleapis.com','www.googleapis.com'].includes(url.hostname))throw Error('Unexpected Google host');return fetch(origin+url.pathname+url.search,init)};return connect.apply(this,args)};shell.openExternal=async raw=>{const url=new URL(raw);if(url.origin+url.pathname!=='https://accounts.google.com/o/oauth2/v2/auth')throw Error('Unexpected sign-in URL');await fetch(origin+'/authorize'+url.search)}},origin);
 const listener=net.createServer();await new Promise(r=>listener.listen(0,'127.0.0.1',r));const port=listener.address().port;await new Promise(r=>listener.close(r));
 const rows=unwrap(await page.evaluate(port=>window.zq.connectors.save({name:'Google Calendar',catalogId:'google-calendar',url:'https://www.googleapis.com/calendar/v3',authType:'oauth',clientId:'fixture-client',clientSecret:'fixture-secret',redirectHost:'127.0.0.1',redirectPort:port}),port)),connector=rows[0];
 unwrap(await page.evaluate(id=>window.zq.connectors.connect(id),connector.id));assert.ok(authorization.searchParams.get('scope').split(' ').includes('https://www.googleapis.com/auth/calendar.events'));
 const connection=unwrap(await page.evaluate(baseUrl=>window.zq.chat.saveConnection({provider:'ollama',name:'Fixture model',baseUrl}),origin));
 await page.getByRole('button',{name:'Chat module',exact:true}).click();
 for(const [action,label,deny]of [['create_event','Create event',true],['create_event','Create event',false],['reschedule_event','Reschedule event',false],['cancel_event','Cancel event',false]]){
  mode=action;unwrap(await page.evaluate(({id,action})=>window.zq.connectors.setTools({id,names:[action]}),{id:connector.id,action}));
  const c=unwrap(await page.evaluate(connectionId=>window.zq.chat.createConversation({connectionId,model:'fixture:tools'}),connection.id));
  unwrap(await page.evaluate(id=>window.zq.chat.saveChatView({selected:id,projectId:null,projectHome:false,positions:{}}),c.id));
  const before=mutations.length;unwrap(await page.evaluate(({conversationId,id,action})=>window.zq.chat.send({conversationId,text:action,connectorIds:[id]}),{conversationId:c.id,id:connector.id,action}));
  const waiting=await reply(c.id,r=>r?.interactions?.some(i=>i.status==='waiting')),card=waiting.interactions.find(i=>i.status==='waiting');assert.equal(card.onceOnly,true);assert.equal(card.approvalAction,action);assert.match(card.detail,/Personal fixture/);assert.match(card.detail,/America\/Chicago/);assert.match(card.detail,/friend@example.test/);assert.equal(mutations.length,before);
  const section=page.locator('.chat-interaction-approval').filter({has:page.getByRole('button',{name:label,exact:true})});await section.waitFor();assert.equal(await section.getByRole('button',{name:'Allow for this chat',exact:true}).count(),0);assert.equal(await section.getByRole('button',{name:'Send email',exact:true}).count(),0);
  if(action==='reschedule_event'){assert.match(card.detail,/Before/);assert.match(card.detail,/After/);await section.screenshot({path:path.join(output,'reschedule-review.png')})}
  if(deny){await section.getByRole('button',{name:'Deny',exact:true}).click();await reply(c.id,r=>r?.status==='stopped');assert.equal(mutations.length,before);continue}
  await section.getByRole('button',{name:label,exact:true}).click();await reply(c.id,r=>r?.status==='complete');assert.equal(mutations.length,before+1);
  await page.getByRole('button',{name:'Allowed once',exact:true}).waitFor();
 }
 assert.deepEqual(mutations,['POST','PATCH','DELETE']);assert.ok(chatCalls>=7);console.log('PASS packaged Calendar: edit-scope OAuth, native previews, denial, create/reschedule/cancel, guest notices, If-Match, action labels and collapsed completed approvals.');
}finally{
 if(app){for(const row of unwrap(await page.evaluate(()=>window.zq.connectors.list())))unwrap(await page.evaluate(id=>window.zq.connectors.remove(id),row.id));await app.evaluate(({app})=>app.exit(0));await app.close()}
 server.closeAllConnections();await new Promise(r=>server.close(r));
}})().catch(error=>{console.error(error);process.exitCode=1});
