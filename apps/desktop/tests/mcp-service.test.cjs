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
async function fixture(t,{oauth=false,registration=true,metadataUrl=false}={}) {
 const state={calls:[],tokens:0,opens:0,access:'secret-access',rejectAccess:false};
 const server=http.createServer(async(req,res)=>{
  const url=new URL(req.url,state.origin);let bytes='';for await(const chunk of req)bytes+=chunk;
  const json=(value,status=200,headers={})=>{res.writeHead(status,{'Content-Type':'application/json',...headers});res.end(JSON.stringify(value))};
  if(url.pathname.startsWith('/.well-known/oauth-protected-resource'))return json({resource:state.origin+'/mcp',authorization_servers:[state.origin]});
  if(url.pathname==='/.well-known/oauth-authorization-server')return json({issuer:state.origin,...(metadataUrl?{client_id_metadata_document_supported:true}:{}),authorization_endpoint:state.origin+'/authorize',token_endpoint:state.origin+'/token',...(registration?{registration_endpoint:state.origin+'/register'}:{}),response_types_supported:['code'],grant_types_supported:['authorization_code','refresh_token'],token_endpoint_auth_methods_supported:['none'],code_challenge_methods_supported:['S256'],authorization_response_iss_parameter_supported:true});
  if(url.pathname==='/register'){state.registration=JSON.parse(bytes);return json({...state.registration,client_id:'registered-public'},201)}
  if(url.pathname==='/token'){
   state.tokens++;const params=new URLSearchParams(bytes);state.tokenParams=params;
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
