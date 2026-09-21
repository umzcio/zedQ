const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ConnectorService } = require('../electron/mcp/service.cjs');
function setup(t, extra={}) {
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'zq-mcp-')); const secrets=new Map();
 const credentials={get:async k=>secrets.get(k),set:async(k,v)=>{assert.match(v,/^[\x21-\x7e]{1,8192}$/);secrets.set(k,v)},delete:async k=>secrets.delete(k)};
 const service=new ConnectorService({directory,credentials,openExternal:async()=>{},...extra});
 t.after(async()=>{await service.close();fs.rmSync(directory,{recursive:true,force:true})});return {service,directory,credentials,secrets};
}
test('metadata persists atomically, public snapshots cannot mutate service, credentials never accepted as URL data',async t=>{
 const {service,directory,credentials}=setup(t);
 await assert.rejects(async()=>service.save({name:'Bad',url:'http://example.com/mcp'}),/HTTPS/);
 await assert.rejects(async()=>service.save({name:'Bad',url:'https://u:secret@example.com/mcp'}),/credentials/);
 await service.save({name:'Example',url:'https://example.com/mcp',clientId:'native-public'});
 const [row]=service.list();assert.equal(row.status,'disconnected');assert.equal(row.revision,1);row.name='changed';
 const reopened=new ConnectorService({directory,credentials,openExternal:async()=>{}});t.after(()=>reopened.close());
 assert.equal(reopened.list()[0].name,'Example');assert.equal(reopened.list()[0].clientId,'native-public');
 await service.remove(row.id);assert.deepEqual(service.list(),[]);
});
const http=require('node:http');
const crypto=require('node:crypto');
async function fixture(t,{oauth=false,registration=true,metadataUrl=false,authMethods=['none']}={}) {
 const state={calls:[],tokens:0,opens:0,access:'secret-access',rejectAccess:false};
 const server=http.createServer(async(req,res)=>{
  const url=new URL(req.url,state.origin);let bytes='';for await(const chunk of req)bytes+=chunk;
  const json=(value,status=200,headers={})=>{res.writeHead(status,{'Content-Type':'application/json',...headers});res.end(JSON.stringify(value))};
  if(url.pathname.startsWith('/.well-known/oauth-protected-resource'))return json({resource:state.origin+'/mcp',authorization_servers:[state.origin]});
  if(url.pathname==='/.well-known/oauth-authorization-server')return json({issuer:state.origin,...(metadataUrl?{client_id_metadata_document_supported:true}:{}),authorization_endpoint:state.origin+'/authorize',token_endpoint:state.origin+'/token',...(registration?{registration_endpoint:state.origin+'/register'}:{}),response_types_supported:['code'],grant_types_supported:['authorization_code','refresh_token'],token_endpoint_auth_methods_supported:authMethods,code_challenge_methods_supported:['S256'],authorization_response_iss_parameter_supported:true});
  if(url.pathname==='/register'){state.registration=JSON.parse(bytes);return json({...state.registration,client_id:'registered-public'},201)}
  if(url.pathname==='/token'){
   state.tokens++;const params=new URLSearchParams(bytes);state.tokenParams=params;state.tokenAuthorization=req.headers.authorization;
   if(params.get('grant_type')==='authorization_code'){
    assert.equal(params.get('code'),'only-code');assert.equal(crypto.createHash('sha256').update(params.get('code_verifier')).digest('base64url'),state.authorization.searchParams.get('code_challenge'));assert.equal(params.get('redirect_uri'),state.authorization.searchParams.get('redirect_uri'));
   }
   state.rejectAccess=false;return json({access_token:state.access,refresh_token:'secret-refresh',token_type:'Bearer',expires_in:3600});
  }
  if(url.pathname==='/mcp') {
   if(oauth&&(req.headers.authorization!==`Bearer ${state.access}`||state.rejectAccess))return json({},401,{'WWW-Authenticate':`Bearer resource_metadata="${state.origin}/.well-known/oauth-protected-resource"`});
   if(req.method==='DELETE'){state.deleted=true;res.writeHead(200);return res.end()}
   if(req.method!=='POST'){res.writeHead(405);return res.end()}
   const msg=JSON.parse(bytes);state.calls.push(msg);
   if(!('id' in msg)){res.writeHead(202);return res.end()}
   const reply=result=>json({jsonrpc:'2.0',id:msg.id,result},200,state.sessionId?{'mcp-session-id':state.sessionId}:{});
   if(msg.method==='initialize')return reply({protocolVersion:'2025-11-25',capabilities:{tools:{}},serverInfo:{name:'fixture',version:'1'}});
   if(msg.method==='tools/list')return reply({tools:state.tools??[{name:'echo',description:'Echo input',inputSchema:{type:'object',properties:{text:{type:'string'}},required:['text'],additionalProperties:false},annotations:{readOnlyHint:true}},{name:'wait',description:'Wait',inputSchema:{type:'object'}}]});
   if(msg.method==='tools/call'){
    if(msg.params.name==='wait'){state.waitStarted?.();return}
    return reply({content:[{type:'text',text:msg.params.arguments.text??'Fixture tool result'}],...(state.output===undefined?{}:{structuredContent:state.output})});
   }
   return json({jsonrpc:'2.0',id:msg.id,error:{code:-32601,message:'Unknown method'}});
  }
  res.writeHead(404);res.end();
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));state.origin=`http://127.0.0.1:${server.address().port}`;
 t.after(()=>{server.closeAllConnections();server.close()});
 state.openExternal=async raw=>{state.opens++;state.authorization=new URL(raw);const callback=new URL(state.authorization.searchParams.get('redirect_uri'));callback.searchParams.set('state',state.authorization.searchParams.get('state'));callback.searchParams.set('code','only-code');callback.searchParams.set('iss',state.origin);state.callback=callback; if(!state.deferCallback)assert.equal((await fetch(callback)).status,200)};
 return state;
}
test('SDK discovers real tools, selection/revisions guard calls, schemas reject bad input and disconnect cancels',async t=>{
 const f=await fixture(t);const {service}=setup(t,{allowLoopbackHttp:true});await service.save({name:'Fixture',url:f.origin+'/mcp'});const id=service.list()[0].id;
 await service.connect(id);const row=service.list()[0];assert.equal(row.status,'connected');assert.equal(row.tools.length,2);assert.equal(row.tools[0].enabled,false);
 await assert.rejects(service.callTool(id,'echo',{text:'hello'},{expectedRevision:row.revision}),/enabled/);
 await service.setTools({id,names:['echo','wait']});const revision=service.list()[0].revision;
 await assert.rejects(service.callTool(id,'echo',{text:'hello'},{expectedRevision:row.revision}),/changed/);
 await assert.rejects(service.callTool(id,'echo',{text:3},{expectedRevision:revision}),/arguments/);
 const result=await service.callTool(id,'echo',{text:'hello'},{expectedRevision:revision});assert.equal(result.content[0].text,'hello');
 let started;const ready=new Promise(r=>started=r);f.waitStarted=started;const waiting=service.callTool(id,'wait',{},{expectedRevision:revision});const rejected=assert.rejects(waiting,/cancel|disconnect|closed/i);await ready;await service.disconnect(id);await rejected;assert.equal(service.list()[0].status,'disconnected');
});
test('real SDK OAuth does PKCE, validates state, stores tokens only in Keychain, refreshes without another browser',async t=>{
 const f=await fixture(t,{oauth:true});const {service,directory,secrets}=setup(t,{allowLoopbackHttp:true,openExternal:f.openExternal});
 await service.save({name:'OAuth',url:f.origin+'/mcp'});const id=service.list()[0].id;await service.connect(id);
 assert.equal(f.opens,1);assert.equal(f.tokens,1);assert.equal(f.registration.token_endpoint_auth_method,'none');assert.equal(service.list()[0].status,'connected');
 assert.ok(secrets.size>0);assert.ok(!JSON.stringify(service.list()).includes('secret-'));for(const file of fs.readdirSync(directory))assert.ok(!fs.readFileSync(path.join(directory,file),'utf8').includes('secret-'));
 await service.setTools({id,names:['echo']});f.rejectAccess=true;await service.callTool(id,'echo',{text:'refreshed'},{expectedRevision:service.list()[0].revision});assert.equal(f.tokens,2);assert.equal(f.opens,1);
 await service.disconnect(id);await service.connect(id);assert.equal(f.opens,1);
});
test('OAuth callback rejects state/issuer mismatch and disconnect aborts pending login',async t=>{
 const f=await fixture(t,{oauth:true});f.deferCallback=true;const {service}=setup(t,{allowLoopbackHttp:true,openExternal:f.openExternal});await service.save({name:'OAuth',url:f.origin+'/mcp'});const id=service.list()[0].id;
 const connecting=service.connect(id);const rejected=assert.rejects(connecting,/cancel|disconnect/i);while(!f.callback)await new Promise(r=>setTimeout(r,5));
 const bad=new URL(f.callback);bad.searchParams.set('state','attacker');assert.equal((await fetch(bad)).status,400);
 const badIssuer=new URL(f.callback);badIssuer.searchParams.set('iss','https://attacker.example');assert.equal((await fetch(badIssuer)).status,400);assert.equal(f.tokens,0);
 await service.disconnect(id);await rejected;assert.equal(service.list()[0].status,'disconnected');
});
test('providers requiring registration give actionable error without opening browser',async t=>{
 const f=await fixture(t,{oauth:true,registration:false});const {service}=setup(t,{allowLoopbackHttp:true,openExternal:f.openExternal});await service.save({name:'OAuth',url:f.origin+'/mcp'});
 await assert.rejects(service.connect(service.list()[0].id),/register|registration|client ID/i);assert.equal(f.opens,0);assert.equal(service.list()[0].status,'error');
});
test('reconnect preserves enabled tools/revision and pre-registered public clients bypass DCR',async t=>{
 const f=await fixture(t,{oauth:true,registration:false});const {service}=setup(t,{allowLoopbackHttp:true,openExternal:f.openExternal});await service.save({name:'OAuth',url:f.origin+'/mcp',clientId:'already-registered'});const id=service.list()[0].id;await service.connect(id);assert.equal(f.registration,undefined);assert.equal(f.authorization.searchParams.get('client_id'),'already-registered');await service.setTools({id,names:['echo']});const revision=service.list()[0].revision;await service.disconnect(id);await service.connect(id);assert.equal(service.list()[0].revision,revision);assert.equal(service.list()[0].tools[0].enabled,true);
});
test('expired credentials cannot trigger a browser from tool calls',async t=>{
 const f=await fixture(t,{oauth:true});const {service}=setup(t,{allowLoopbackHttp:true,openExternal:f.openExternal});await service.save({name:'OAuth',url:f.origin+'/mcp'});const id=service.list()[0].id;await service.connect(id);await service.setTools({id,names:['echo']});
 // Model the server invalidating a session with no refresh grant.
 const session=service.sessions.get(id);session.provider.savedTokens.refresh_token=undefined;session.provider.savedTokens.expiresAt=Date.now()-1;f.rejectAccess=true;
 await assert.rejects(service.callTool(id,'echo',{text:'expired'},{expectedRevision:service.list()[0].revision}),/authorization.*expired|Reconnect/i);assert.equal(f.opens,1);assert.equal(service.list()[0].status,'error');
});
test('concurrent connects are rejected instead of orphaning a browser flow',async t=>{
 const f=await fixture(t,{oauth:true});f.deferCallback=true;const {service}=setup(t,{allowLoopbackHttp:true,openExternal:f.openExternal});await service.save({name:'OAuth',url:f.origin+'/mcp'});const id=service.list()[0].id;const first=service.connect(id);const rejected=assert.rejects(first,/cancel|disconnect/);await assert.rejects(service.connect(id),/busy/);await service.disconnect(id);await rejected;
});
test('disk write failure rolls public metadata back to the committed snapshot',async t=>{
 const {service}=setup(t);await service.save({name:'Committed',url:'https://example.com/mcp'});const row=service.list()[0];const original=fs.renameSync;fs.renameSync=()=>{throw Error('simulated disk failure')};try{await assert.rejects(service.save({...row,name:'Not committed'}));assert.equal(service.list()[0].name,'Committed')}finally{fs.renameSync=original}
});
test('disconnect terminates SDK server sessions',async t=>{
 const f=await fixture(t);f.sessionId='fixture-session';const {service}=setup(t,{allowLoopbackHttp:true});await service.save({name:'Fixture',url:f.origin+'/mcp'});const id=service.list()[0].id;await service.connect(id);await service.disconnect(id);assert.equal(f.deleted,true);
});

test('HTTPS client metadata URLs are used when authorization server advertises support',async t=>{
 const f=await fixture(t,{oauth:true,registration:false,metadataUrl:true});const {service}=setup(t,{allowLoopbackHttp:true,openExternal:f.openExternal});await service.save({name:'OAuth',url:f.origin+'/mcp',clientMetadataUrl:'https://client.example/native.json'});await service.connect(service.list()[0].id);assert.equal(f.authorization.searchParams.get('client_id'),'https://client.example/native.json');assert.equal(f.registration,undefined);
});

test('modern input and output schemas are validated before results reach chat',async t=>{
 const f=await fixture(t);f.tools=[{name:'echo',inputSchema:{$schema:'https://json-schema.org/draft/2020-12/schema',type:'object',properties:{text:{type:'string'}},required:['text']},outputSchema:{type:'object',properties:{ok:{const:true}},required:['ok']}}];f.output={ok:false};const {service}=setup(t,{allowLoopbackHttp:true});await service.save({name:'Modern',url:f.origin+'/mcp'});const id=service.list()[0].id;await service.connect(id);await service.setTools({id,names:['echo']});assert.equal(service.list()[0].tools[0].outputSchema,undefined);const revision=service.list()[0].revision;await assert.rejects(service.callTool(id,'echo',{text:'hello'},{expectedRevision:revision}),/output|result|schema/i);f.output={ok:true};const result=await service.callTool(id,'echo',{text:'hello'},{expectedRevision:revision});assert.deepEqual(result.structuredContent,{ok:true});
});

const {SecretStore}=require('../electron/mcp/security.cjs');
test('bearer credentials are write-only, preserve on edit, clear explicitly and authenticate without browser',async t=>{
 const f=await fixture(t,{oauth:true});const {service,directory,credentials}=setup(t,{allowLoopbackHttp:true,openExternal:f.openExternal});
 const row=await service.save({name:'Bearer',url:f.origin+'/mcp',authType:'bearer',token:f.access,catalogId:'github'});
 assert.equal(row.hasToken,true);assert.equal(row.token,undefined);assert.equal(row.catalogId,'github');await service.connect(row.id);assert.equal(f.opens,0);assert.equal(f.tokens,0);
 await service.disconnect(row.id);await service.save({...row,name:'Renamed'});await service.connect(row.id);assert.equal(f.opens,0);
 assert.ok(!fs.readFileSync(path.join(directory,'mcp-connectors.json'),'utf8').includes(f.access));
 const reopened=new ConnectorService({directory,credentials,allowLoopbackHttp:true,openExternal:async()=>{}});t.after(()=>reopened.close());assert.equal(reopened.list()[0].hasToken,true);
 await service.disconnect(row.id);await service.save({...row,token:''});assert.equal(service.list()[0].hasToken,false);await assert.rejects(service.connect(row.id),/token/i);assert.equal(f.opens,0);
});
test('failed metadata save preserves every prior credential and endpoint changes revoke credentials',async t=>{
 const {service,credentials}=setup(t);const row=await service.save({name:'Original',url:'https://old.example/mcp',authType:'bearer',token:'original-token'});const store=new SecretStore(credentials,row.id);await store.set('tokens',{access_token:'oauth-original'});await store.set('client',{client_id:'old-registration'});
 const rename=fs.renameSync;fs.renameSync=()=>{throw Error('disk failure')};try{await assert.rejects(service.save({...row,url:'https://new.example/mcp',token:'replacement-token'}));}finally{fs.renameSync=rename}
 assert.equal(service.list()[0].url,row.url);assert.equal((await store.get('token')).value,'original-token');assert.equal((await store.get('tokens')).access_token,'oauth-original');assert.equal((await store.get('client')).client_id,'old-registration');
 await service.save({...row,url:'https://new.example/mcp'});assert.equal(service.list()[0].hasToken,false);assert.equal(await store.get('tokens'),undefined);assert.equal(await store.get('client'),undefined);
});
test('manual confidential OAuth uses the supplied secret with PKCE and never exposes it',async t=>{
 for(const method of ['client_secret_basic','client_secret_post']){
  const f=await fixture(t,{oauth:true,registration:false,authMethods:[method]});const {service,directory}=setup(t,{allowLoopbackHttp:true,openExternal:f.openExternal});const row=await service.save({name:'Manual OAuth',url:f.origin+'/mcp',clientId:'my-client',clientSecret:'my-private-secret'});
  assert.equal(row.hasClientSecret,true);await service.connect(row.id);assert.equal(f.opens,1);assert.equal(f.registration,undefined);
  if(method==='client_secret_basic')assert.equal(f.tokenAuthorization,'Basic '+Buffer.from('my-client:my-private-secret').toString('base64'));else assert.equal(f.tokenParams.get('client_secret'),'my-private-secret');
  assert.ok(!JSON.stringify(service.list()).includes('my-private-secret'));assert.ok(!fs.readFileSync(path.join(directory,'mcp-connectors.json'),'utf8').includes('my-private-secret'));
 }
});
test('fixed loopback callbacks honor registered host and report occupied ports before sign-in',async t=>{
 const f=await fixture(t,{oauth:true,registration:false});const occupied=http.createServer();await new Promise(r=>occupied.listen(0,'127.0.0.1',r));const port=occupied.address().port;t.after(()=>occupied.close());
 const {service}=setup(t,{allowLoopbackHttp:true,openExternal:f.openExternal});const row=await service.save({name:'Fixed',url:f.origin+'/mcp',clientId:'registered',redirectPort:port,redirectHost:'localhost'});
 await assert.rejects(service.connect(row.id),/port.*in use|in use.*port/i);assert.equal(f.opens,0);await new Promise(r=>occupied.close(r));await service.connect(row.id);assert.equal(f.authorization.searchParams.get('redirect_uri'),`http://localhost:${port}/oauth/callback`);await service.disconnect(row.id);
 const check=http.createServer();await new Promise((resolve,reject)=>check.once('error',reject).listen(port,'127.0.0.1',resolve));await new Promise(r=>check.close(r));
});
test('authentication fields reject unsupported modes and malformed secrets and callbacks',async t=>{
 const {service}=setup(t);for(const extra of [{authType:'password'},{token:'bad\nheader'},{token:123},{clientSecret:'secret'},{redirectPort:0},{redirectPort:65536},{redirectHost:'evil.example'},{catalogId:'x'.repeat(65)}])await assert.rejects(service.save({name:'Invalid',url:'https://example.com/mcp',...extra}));
});

test('changing OAuth registration revokes grants while callback edits preserve the registered app secret',async t=>{
 const {service,credentials}=setup(t);const row=await service.save({name:'Manual',url:'https://example.com/mcp',clientId:'first-app',clientSecret:'secret-value'});const store=new SecretStore(credentials,row.id);await store.set('tokens',{access_token:'old-grant'});
 await service.save({...row,redirectPort:4000});assert.equal(await store.get('tokens'),undefined);assert.equal((await store.get('clientSecret')).value,'secret-value');assert.equal(service.list()[0].hasClientSecret,true);
 await service.save({...service.list()[0],clientId:'other-app'});assert.equal(await store.get('clientSecret'),undefined);assert.equal(service.list()[0].hasClientSecret,false);
 await service.save({...service.list()[0],authType:'bearer',token:'new-token'});assert.equal(service.list()[0].hasToken,true);assert.equal(service.list()[0].hasClientSecret,false);
});
test('a rejected bearer token never attempts OAuth discovery or sign-in',async t=>{
 const f=await fixture(t,{oauth:true});const {service}=setup(t,{allowLoopbackHttp:true,openExternal:f.openExternal});const row=await service.save({name:'Bearer',url:f.origin+'/mcp',authType:'bearer',token:'wrong-token'});await assert.rejects(service.connect(row.id),/token.*rejected|token.*expired/i);assert.equal(f.opens,0);assert.equal(f.tokens,0);assert.equal(f.registration,undefined);
});
test('client-secret auth pins issuer and token endpoint before transmitting the secret',async t=>{
 const {NativeOAuthProvider}=require('../electron/mcp/oauth.cjs');const {service,credentials}=setup(t);const row=await service.save({name:'Pinned',url:'https://mcp.example/mcp',clientId:'my-app',clientSecret:'pinned-secret'});const store=new SecretStore(credentials,row.id);const create=()=>new NativeOAuthProvider({row,secrets:store,signal:new AbortController().signal,openExternal:async()=>{},onAuthenticating:()=>{}});
 const first=create();t.after(()=>first.close());await first.start();await first.saveDiscoveryState({authorizationServerUrl:'https://login.example',authorizationServerMetadata:{issuer:'https://login.example',token_endpoint:'https://login.example/token',token_endpoint_auth_methods_supported:['client_secret_post']}});first.close();
 const second=create();t.after(()=>second.close());await second.start();await assert.rejects(second.saveDiscoveryState({authorizationServerUrl:'https://evil.example',authorizationServerMetadata:{issuer:'https://evil.example',token_endpoint:'https://evil.example/token',token_endpoint_auth_methods_supported:['client_secret_post']}}),/provider.*changed|endpoint.*changed/i);
});

test('malformed manual registration inputs produce an actionable validation error',async t=>{
 const {service}=setup(t);await assert.rejects(service.save({name:'Invalid',url:'https://example.com/mcp',clientId:42,clientSecret:'secret'}),/registered OAuth client ID/);
});

test('Google-style tool schemas validate through SDK calls and structured results',async t=>{
 const f=await fixture(t);const {service}=setup(t,{allowLoopbackHttp:true});
 const view={type:'string',enum:['MINIMAL','METADATA_ONLY'],'x-google-enum-descriptions':['Include snippets','Metadata only']};
 f.tools=[{name:'search_threads',inputSchema:{type:'object',properties:{query:{type:'string'},view},required:['query']},outputSchema:{type:'object',properties:{view},required:['view']}}];
 f.output={view:'MINIMAL'};
 const row=await service.save({name:'Google schema fixture',url:f.origin+'/mcp'});await service.connect(row.id);await service.setTools({id:row.id,names:['search_threads']});const options={expectedRevision:service.list()[0].revision};
 await assert.rejects(service.callTool(row.id,'search_threads',{query:'concert',view:'invalid'},options),/arguments/);
 assert.equal(f.calls.filter(call=>call.method==='tools/call').length,0);
 const result=await service.callTool(row.id,'search_threads',{query:'concert',view:'MINIMAL'},options);
 assert.deepEqual(result.structuredContent,{view:'MINIMAL'});
 assert.equal(f.calls.filter(call=>call.method==='tools/call').length,1);
 f.output={view:'invalid'};
 await assert.rejects(service.callTool(row.id,'search_threads',{query:'concert'},options),/output.*schema/);
});

test('legacy Gmail migrates trusted credentials and verifies standard API access before connecting',async t=>{
 const calls=[];const {service,directory,credentials}=setup(t,{fetchImpl:async(url,init)=>{
  calls.push(String(url));if(String(url)==='https://accounts.google.com/.well-known/oauth-authorization-server')return Response.json({issuer:'https://accounts.google.com',authorization_endpoint:'https://accounts.google.com/o/oauth2/v2/auth',token_endpoint:'https://oauth2.googleapis.com/token',response_types_supported:['code'],token_endpoint_auth_methods_supported:['client_secret_post'],code_challenge_methods_supported:['S256']});
  assert.equal(new Headers(init.headers).get('authorization'),'Bearer saved-access');assert.equal(String(url),'https://gmail.googleapis.com/gmail/v1/users/me/profile');return Response.json({emailAddress:'fixture@example.test'});
 }});
 const old='https://gmailmcp.googleapis.com/mcp/v1',url='https://gmail.googleapis.com/gmail/v1';
 const id=crypto.randomUUID();fs.writeFileSync(path.join(directory,'mcp-connectors.json'),JSON.stringify({version:1,connectors:[{id,name:'My mail',catalogId:'gmail',url:old,clientId:'saved-client',authType:'oauth',redirectPort:43187,redirectHost:'127.0.0.1',hasClientSecret:true,revision:1,tools:[]}]}));
 const secrets=new SecretStore(credentials,id);await secrets.set('clientSecret',{value:'saved-secret',url:old,clientId:'saved-client',issuer:'https://accounts.google.com',tokenEndpoint:'https://oauth2.googleapis.com/token'});await secrets.set('tokens',{access_token:'saved-access',refresh_token:'saved-refresh',resourceUrl:old,issuer:'https://accounts.google.com',scope:'https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.compose',expiresAt:Date.now()+3600000});
 const migrated=new ConnectorService({directory,credentials,fetchImpl:service.fetchImpl,openExternal:async()=>{throw Error('Saved authorization must not open a browser')}});t.after(()=>migrated.close());assert.equal(migrated.list()[0].url,url);
 await migrated.connect(id);assert.equal(migrated.list()[0].status,'connected');assert.equal(migrated.list()[0].name,'My mail');assert.ok(migrated.list()[0].tools.some(tool=>tool.name==='search_threads'));assert.ok(migrated.list()[0].tools.every(tool=>!tool.enabled));assert.equal((await secrets.get('clientSecret')).url,url);assert.equal((await secrets.get('tokens')).resourceUrl,url);assert.ok(calls.every(url=>!url.includes('mcp')));assert.ok(!fs.readFileSync(path.join(directory,'mcp-connectors.json'),'utf8').includes('saved-access'));
});

test('google-calendar migrates trusted credentials and verifies standard API access before connecting',async t=>{
 const calls=[];const {service,directory,credentials}=setup(t,{fetchImpl:async(url,init)=>{
  calls.push(String(url));if(String(url)==='https://accounts.google.com/.well-known/oauth-authorization-server')return Response.json({issuer:'https://accounts.google.com',authorization_endpoint:'https://accounts.google.com/o/oauth2/v2/auth',token_endpoint:'https://oauth2.googleapis.com/token',response_types_supported:['code'],token_endpoint_auth_methods_supported:['client_secret_post'],code_challenge_methods_supported:['S256']});
  assert.equal(new Headers(init.headers).get('authorization'),'Bearer saved-access');assert.equal(String(url),'https://www.googleapis.com/calendar/v3/users/me/calendarList?maxResults=1&fields=items%28id%29');return Response.json({emailAddress:'fixture@example.test'});
 }});
 const old='https://calendarmcp.googleapis.com/mcp/v1',url='https://www.googleapis.com/calendar/v3';
 const id=crypto.randomUUID();fs.writeFileSync(path.join(directory,'mcp-connectors.json'),JSON.stringify({version:1,connectors:[{id,name:'My mail',catalogId:'google-calendar',url:old,clientId:'saved-client',authType:'oauth',redirectPort:43187,redirectHost:'127.0.0.1',hasClientSecret:true,revision:1,tools:[]}]}));
 const secrets=new SecretStore(credentials,id);await secrets.set('clientSecret',{value:'saved-secret',url:old,clientId:'saved-client',issuer:'https://accounts.google.com',tokenEndpoint:'https://oauth2.googleapis.com/token'});await secrets.set('tokens',{access_token:'saved-access',refresh_token:'saved-refresh',resourceUrl:old,issuer:'https://accounts.google.com',scope:'https://www.googleapis.com/auth/calendar.calendarlist.readonly https://www.googleapis.com/auth/calendar.events.freebusy https://www.googleapis.com/auth/calendar.events.readonly',expiresAt:Date.now()+3600000});
 const migrated=new ConnectorService({directory,credentials,fetchImpl:service.fetchImpl,openExternal:async()=>{throw Error('Saved authorization must not open a browser')}});t.after(()=>migrated.close());assert.equal(migrated.list()[0].url,url);
 await migrated.connect(id,{interactive:false});assert.equal(migrated.list()[0].status,'connected');assert.equal(migrated.list()[0].name,'My mail');assert.ok(migrated.list()[0].tools.some(tool=>tool.name==='list_events'));assert.ok(migrated.list()[0].tools.every(tool=>!tool.enabled));assert.equal((await secrets.get('clientSecret')).url,url);assert.equal((await secrets.get('tokens')).resourceUrl,url);assert.ok(calls.every(url=>!url.includes('mcp')));assert.ok(!fs.readFileSync(path.join(directory,'mcp-connectors.json'),'utf8').includes('saved-access'));
});

test('google-drive migrates trusted credentials and verifies standard API access before connecting',async t=>{
 const calls=[];const {service,directory,credentials}=setup(t,{fetchImpl:async(url,init)=>{
  calls.push(String(url));if(String(url)==='https://accounts.google.com/.well-known/oauth-authorization-server')return Response.json({issuer:'https://accounts.google.com',authorization_endpoint:'https://accounts.google.com/o/oauth2/v2/auth',token_endpoint:'https://oauth2.googleapis.com/token',response_types_supported:['code'],token_endpoint_auth_methods_supported:['client_secret_post'],code_challenge_methods_supported:['S256']});
  assert.equal(new Headers(init.headers).get('authorization'),'Bearer saved-access');assert.equal(String(url),'https://www.googleapis.com/drive/v3/about?fields=user%28permissionId%29');return Response.json({emailAddress:'fixture@example.test'});
 }});
 const old='https://drivemcp.googleapis.com/mcp/v1',url='https://www.googleapis.com/drive/v3';
 const id=crypto.randomUUID();fs.writeFileSync(path.join(directory,'mcp-connectors.json'),JSON.stringify({version:1,connectors:[{id,name:'My mail',catalogId:'google-drive',url:old,clientId:'saved-client',authType:'oauth',redirectPort:43187,redirectHost:'127.0.0.1',hasClientSecret:true,revision:1,tools:[]}]}));
 const secrets=new SecretStore(credentials,id);await secrets.set('clientSecret',{value:'saved-secret',url:old,clientId:'saved-client',issuer:'https://accounts.google.com',tokenEndpoint:'https://oauth2.googleapis.com/token'});await secrets.set('tokens',{access_token:'saved-access',refresh_token:'saved-refresh',resourceUrl:old,issuer:'https://accounts.google.com',scope:'https://www.googleapis.com/auth/drive.readonly https://www.googleapis.com/auth/drive.file',expiresAt:Date.now()+3600000});
 const migrated=new ConnectorService({directory,credentials,fetchImpl:service.fetchImpl,openExternal:async()=>{throw Error('Saved authorization must not open a browser')}});t.after(()=>migrated.close());assert.equal(migrated.list()[0].url,url);
 await migrated.connect(id);assert.equal(migrated.list()[0].status,'connected');assert.equal(migrated.list()[0].name,'My mail');assert.ok(migrated.list()[0].tools.some(tool=>tool.name==='search_files'));assert.ok(migrated.list()[0].tools.every(tool=>!tool.enabled));assert.equal((await secrets.get('clientSecret')).url,url);assert.equal((await secrets.get('tokens')).resourceUrl,url);assert.ok(calls.every(url=>!url.includes('mcp')));assert.ok(!fs.readFileSync(path.join(directory,'mcp-connectors.json'),'utf8').includes('saved-access'));
});

test('launch restores connected OAuth sessions and selected tools, but not deliberate disconnects or unused presets',async t=>{
 const f=await fixture(t,{oauth:true});const {service,directory,credentials}=setup(t,{allowLoopbackHttp:true,openExternal:f.openExternal});
 const first=await service.save({name:'Remember me',url:f.origin+'/mcp'});
 const off=await service.save({name:'Leave off',url:f.origin+'/mcp'});
 await service.save({name:'Never connected',url:f.origin+'/mcp'});
 await service.connect(first.id);await service.setTools({id:first.id,names:['echo']});await service.connect(off.id);await service.disconnect(off.id);
 const revision=service.get(first.id).revision,opens=f.opens;await service.close();f.rejectAccess=true;
 const reopened=new ConnectorService({directory,credentials,allowLoopbackHttp:true,openExternal:f.openExternal});t.after(()=>reopened.close());
 await reopened.restoreConnections();
 assert.equal(reopened.get(first.id).status,'connected');assert.equal(reopened.get(first.id).revision,revision);assert.equal(reopened.get(first.id).tools[0].enabled,true);
 assert.equal(reopened.get(off.id).status,'disconnected');assert.equal(reopened.list()[2].status,'disconnected');assert.equal(f.opens,opens);
 assert.equal(reopened.sessions.get(first.id).provider.server,undefined);
 assert.equal((await reopened.callTool(first.id,'echo',{text:'After relaunch'},{expectedRevision:revision})).content[0].text,'After relaunch');
});

test('missing saved authorization requires sign-in without a browser or fresh registration on launch',async t=>{
 const f=await fixture(t,{oauth:true});const {service,directory,credentials}=setup(t,{allowLoopbackHttp:true,openExternal:f.openExternal});
 const row=await service.save({name:'OAuth',url:f.origin+'/mcp'});await service.connect(row.id);await service.close();
 const {SecretStore}=require('../electron/mcp/security.cjs');await new SecretStore(credentials,row.id).delete('tokens');
 const reopened=new ConnectorService({directory,credentials,allowLoopbackHttp:true,openExternal:f.openExternal});t.after(()=>reopened.close());
 await reopened.restoreConnections();assert.equal(reopened.get(row.id).status,'error');assert.equal(reopened.get(row.id).needsSignIn,true);assert.equal(f.opens,1);
 await reopened.connect(row.id);assert.equal(reopened.get(row.id).status,'connected');assert.equal(reopened.get(row.id).needsSignIn,undefined);assert.equal(f.opens,2);
});

test('window suspension preserves intent; disconnecting a queued connector prevents restoration',async t=>{
 const f=await fixture(t);const {service}=setup(t,{allowLoopbackHttp:true});const ids=[];
 for(let i=0;i<4;i++){const row=await service.save({name:`Connector ${i}`,url:f.origin+'/mcp'});ids.push(row.id);await service.connect(row.id)}
 await service.suspend();assert.ok(service.list().every(row=>row.status==='disconnected'&&row.autoConnect));
 const restoring=service.restoreConnections();await service.disconnect(ids[3]);await restoring;
 assert.equal(service.get(ids[3]).status,'disconnected');assert.equal(service.get(ids[3]).autoConnect,false);
 await service.suspend();const pending=service.restoreConnections();await service.suspend();await pending;
 assert.ok(service.list().every(row=>row.status==='disconnected'));assert.equal(service.sessions.size,0);
});

test('old metadata does not guess whether a previously used connector was deliberately disconnected',async t=>{
 const f=await fixture(t);const {service,directory,credentials}=setup(t,{allowLoopbackHttp:true});const row=await service.save({name:'Legacy',url:f.origin+'/mcp'});await service.connect(row.id);await service.close();
 const saved=JSON.parse(fs.readFileSync(service.file));delete saved.connectors[0].autoConnect;fs.writeFileSync(service.file,JSON.stringify(saved));
 const reopened=new ConnectorService({directory,credentials,allowLoopbackHttp:true,openExternal:async()=>{throw Error('Must not open')}});t.after(()=>reopened.close());await reopened.restoreConnections();assert.equal(reopened.get(row.id).status,'disconnected');
});

test('a timed-out background connection reports failure without preventing the other saved connectors restoring',async t=>{
 const f=await fixture(t);const {service}=setup(t,{allowLoopbackHttp:true});
 const slow=await service.save({name:'Unavailable',url:f.origin+'/mcp'}),good=await service.save({name:'Available',url:f.origin+'/mcp'});
 await service.connect(slow.id);await service.connect(good.id);await service.suspend();
 service.connectTimeoutMs=100;
 // Hold one request at the transport boundary; the other worker can finish.
 const originalFetch=service.fetchImpl;let calls=0;service.fetchImpl=async(url,init)=>{if(++calls===1)return new Promise((resolve,reject)=>init.signal.addEventListener('abort',()=>reject(init.signal.reason),{once:true}));return originalFetch(url,init)};
 await service.restoreConnections();assert.ok(service.list().some(row=>row.status==='connected'));assert.ok(service.list().some(row=>row.status==='error'&&/timed out/.test(row.error)&&!row.needsSignIn));
});

test('background restore stops at denied Keychain access; explicit reconnect authorizes and refresh stays silent',async t=>{
 const f=await fixture(t,{oauth:true});const {service,directory,credentials}=setup(t,{allowLoopbackHttp:true,openExternal:f.openExternal});
 const row=await service.save({name:'Keychain fixture',url:f.origin+'/mcp'});await service.connect(row.id);await service.close();
 const accesses=[];let locked=true;
 const guarded={};for(const op of ['get','set','delete'])guarded[op]=async(...args)=>{
  const options=args.at(-1);accesses.push({op,interactive:options?.interactive});
  if(locked&&options?.interactive===false)throw Object.assign(new Error('native detail must not leak'),{code:'KEYCHAIN_AUTH_REQUIRED'});
  return credentials[op](...args);
 };
 const reopened=new ConnectorService({directory,credentials:guarded,allowLoopbackHttp:true,openExternal:f.openExternal});t.after(()=>reopened.close());
 await reopened.restoreConnections();
 assert.equal(reopened.get(row.id).status,'error');assert.equal(reopened.get(row.id).needsSignIn,true);
 assert.match(reopened.get(row.id).error,/Keychain access needs approval/);assert.equal(f.opens,1);
 assert.deepEqual(accesses,[{op:'get',interactive:false}]);
 // An error row does not restart the authorization loop on another restore.
 await reopened.restoreConnections();assert.equal(accesses.length,1);
 accesses.length=0;await reopened.connect(row.id);assert.equal(reopened.get(row.id).status,'connected');
 assert.ok(accesses.length>1);assert.ok(accesses.every(item=>item.interactive===true));
 await reopened.setTools({id:row.id,names:['echo']});
 locked=false;accesses.length=0;f.rejectAccess=true;
 await reopened.callTool(row.id,'echo',{text:'Refresh'},{expectedRevision:reopened.get(row.id).revision});
 assert.ok(accesses.some(item=>item.op==='set'));assert.ok(accesses.every(item=>item.interactive===false));
 locked=true;accesses.length=0;f.rejectAccess=true;
 await assert.rejects(reopened.callTool(row.id,'echo',{text:'Locked refresh'},{expectedRevision:reopened.get(row.id).revision}),/Reconnect/);
 assert.equal(reopened.get(row.id).status,'error');assert.equal(reopened.get(row.id).needsSignIn,true);
 assert.ok(accesses.length>0);assert.ok(accesses.every(item=>item.interactive===false));
});
