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
    return reply({content:[{type:'text',text:msg.params.arguments.text}],...(state.output===undefined?{}:{structuredContent:state.output})});
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
