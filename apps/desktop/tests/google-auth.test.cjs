'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),net=require('node:net');
const {prepareGoogleAuthorization}=require('../electron/mcp/google-auth.cjs');
const {NativeOAuthProvider}=require('../electron/mcp/oauth.cjs');
const GOOGLE='https://gmailmcp.googleapis.com/mcp/v1';
const SCOPES=['https://www.googleapis.com/auth/gmail.readonly','https://www.googleapis.com/auth/gmail.compose'];
async function freePort(){const server=net.createServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const port=server.address().port;await new Promise(resolve=>server.close(resolve));return port}
async function fixture(t,{interactive=true,tokens,manualSecret=true,complete=true,metadataChanges={},rowChanges={},supportedScopes=SCOPES,tokenChanges={}}={}){
 const row={id:'google-fixture',catalogId:'gmail',name:'Gmail',url:GOOGLE,authType:'oauth',clientId:'fixture-client.apps.googleusercontent.com',redirectHost:'127.0.0.1',redirectPort:await freePort(),...rowChanges};
 const slots=new Map([['clientSecret',manualSecret?{value:'fixture-client-secret',url:row.url,clientId:row.clientId}:undefined],['tokens',tokens?{resourceUrl:row.url,...tokens}:undefined]]);
 const controller=new AbortController(),opened=[],requests=[];let authenticating=0;
 const provider=new NativeOAuthProvider({row,interactive,signal:controller.signal,secrets:{queue:Promise.resolve(),get:async k=>structuredClone(slots.get(k)),set:async(k,v)=>slots.set(k,structuredClone(v)),delete:async k=>slots.delete(k)},onAuthenticating:()=>{authenticating++},openExternal:async value=>{
  const url=new URL(value);opened.push(url);
  if(complete){const callback=new URL(url.searchParams.get('redirect_uri'));callback.searchParams.set('state',url.searchParams.get('state'));callback.searchParams.set('code','fixture-code');callback.searchParams.set('iss','https://accounts.google.com');const response=await fetch(callback);assert.equal(response.status,200)}
 }});
 await provider.start();t.after(()=>{controller.abort();provider.close()});
 const fetchImpl=async(value,init={})=>{
  const url=String(value);requests.push({url,init});
  if(url===row.url.replace('/mcp/v1','/.well-known/oauth-protected-resource/mcp/v1'))return Response.json({resource:row.url,authorization_servers:['https://accounts.google.com/'],scopes_supported:[...supportedScopes,'https://mail.google.com/']});
  if(url==='https://accounts.google.com/.well-known/oauth-authorization-server')return Response.json({issuer:'https://accounts.google.com',authorization_endpoint:'https://accounts.google.com/o/oauth2/v2/auth',token_endpoint:'https://oauth2.googleapis.com/token',response_types_supported:['code'],grant_types_supported:['authorization_code','refresh_token'],token_endpoint_auth_methods_supported:['client_secret_post','client_secret_basic'],code_challenge_methods_supported:['S256'],authorization_response_iss_parameter_supported:true,...metadataChanges});
  if(url==='https://oauth2.googleapis.com/token')return Response.json({access_token:'fixture-access-token',refresh_token:'fixture-refresh-token',token_type:'Bearer',expires_in:3600,scope:supportedScopes.join(' '),...tokenChanges});
  throw Error('Unexpected Google request');
 };
 return {row,provider,fetchImpl,signal:controller.signal,controller,slots,opened,requests,get authenticating(){return authenticating}};
}
const call=f=>prepareGoogleAuthorization({row:f.row,provider:f.provider,fetchImpl:f.fetchImpl,signal:f.signal});

test('Google explicit connect completes SDK OAuth before returning, with fixed callback and least scopes',async t=>{
 const f=await fixture(t);assert.equal(await call(f),true);assert.equal(f.opened.length,1);assert.equal(f.authenticating,1);
 const url=f.opened[0];assert.equal(url.origin+url.pathname,'https://accounts.google.com/o/oauth2/v2/auth');assert.equal(url.searchParams.get('redirect_uri'),`http://127.0.0.1:${f.row.redirectPort}/oauth/callback`);assert.deepEqual(url.searchParams.get('scope').split(' ').sort(),[...SCOPES].sort());assert.equal(url.searchParams.get('code_challenge_method'),'S256');assert.equal(url.searchParams.get('access_type'),'offline');assert.equal(url.searchParams.get('prompt'),'consent');assert.equal(url.searchParams.has('client_secret'),false);
 const token=f.requests.find(r=>r.url==='https://oauth2.googleapis.com/token');assert.equal(token.init.body.get('grant_type'),'authorization_code');assert.equal(token.init.body.get('code'),'fixture-code');assert.ok(token.init.body.get('code_verifier'));assert.equal(f.slots.get('tokens').resourceUrl,GOOGLE);assert.equal(f.provider.tokens().access_token,'fixture-access-token');assert.equal(f.provider.redirected,false);assert.equal(f.provider.interactive,false);assert.ok(f.requests.every(r=>!r.url.includes('tools/call')));
 // A failed post-login MCP handshake cannot open another browser and replay this callback.
 delete f.provider.savedTokens.refresh_token;await assert.rejects(f.provider.transportAuth().onUnauthorized({response:new Response('',{status:401}),fetchFn:f.fetchImpl}),/Reconnect|expired/i);assert.equal(f.opened.length,1);
});

test('Google requires registered client settings and fixed callback before any browser or metadata request',async t=>{
 for(const options of [{manualSecret:false},{rowChanges:{clientId:undefined}},{rowChanges:{redirectPort:undefined}},{rowChanges:{authType:'bearer'}}]){
  // Bearer provider startup itself validates credentials, so inspect that mode using an OAuth-started fixture.
  const f=await fixture(t,options.rowChanges?.authType?{}:options);if(options.rowChanges?.authType)f.row.authType='bearer';
  await assert.rejects(call(f),/client|secret|callback|OAuth/i);assert.equal(f.opened.length,0);assert.equal(f.requests.length,0);
 }
});

test('Google reuses unexpired issuer/resource/scope-bound tokens without another sign-in',async t=>{
 const f=await fixture(t,{tokens:{access_token:'cached-token',issuer:'https://accounts.google.com',expiresAt:Date.now()+3600000,scope:SCOPES.join(' ')}});assert.equal(await call(f),true);assert.equal(f.opened.length,0);assert.equal(f.requests.filter(r=>r.url.endsWith('/token')).length,0);
});

test('Google silently refreshes expired grants during explicit connect',async t=>{
 const f=await fixture(t,{tokens:{access_token:'expired-token',refresh_token:'cached-refresh',issuer:'https://accounts.google.com',expiresAt:Date.now()-1,scope:SCOPES.join(' ')}});assert.equal(await call(f),true);assert.equal(f.opened.length,0);assert.equal(f.requests.find(r=>r.url.endsWith('/token')).init.body.get('grant_type'),'refresh_token');assert.equal(f.provider.tokens().access_token,'fixture-access-token');
});

test('Google metadata cannot redirect authorization or client credentials to another host',async t=>{
 const f=await fixture(t,{metadataChanges:{token_endpoint:'https://evil.example/token'}});await assert.rejects(call(f),/Google|metadata|endpoint/i);assert.equal(f.opened.length,0);assert.equal(f.requests.length,2);assert.equal(f.slots.get('clientSecret').issuer,undefined);
});

test('non-Google endpoints are untouched and tool-time preparation cannot open a browser',async t=>{
 assert.equal(await prepareGoogleAuthorization({row:{url:'https://gmailmcp.googleapis.com.evil.example/mcp/v1'},provider:{},fetchImpl:()=>{throw Error('Unexpected fetch')}}),false);
 const f=await fixture(t);f.provider.interactive=false;await assert.rejects(call(f),/Reconnect|explicit|connect|sign.in/i);assert.equal(f.opened.length,0);assert.equal(f.requests.length,0);
});

test('cancelled Google browser sign-in never reports authorization complete',async t=>{
 const f=await fixture(t,{complete:false});const pending=call(f);const rejected=assert.rejects(pending,/cancel/i);
 for(let n=0;n<100&&!f.opened.length;n++)await new Promise(resolve=>setTimeout(resolve,5));assert.equal(f.opened.length,1);f.controller.abort();await rejected;assert.equal(f.slots.get('tokens'),undefined);
});

test('Calendar and Drive use their own documented scopes rather than all advertised access',async t=>{
 for(const [catalogId,url,scopes]of[
  ['google-calendar','https://calendarmcp.googleapis.com/mcp/v1',['https://www.googleapis.com/auth/calendar.calendarlist.readonly','https://www.googleapis.com/auth/calendar.events.freebusy','https://www.googleapis.com/auth/calendar.events.readonly']],
  ['google-drive','https://drivemcp.googleapis.com/mcp/v1',['https://www.googleapis.com/auth/drive.readonly','https://www.googleapis.com/auth/drive.file']],
 ]){const f=await fixture(t,{rowChanges:{catalogId,url},supportedScopes:scopes});assert.equal(await call(f),true);assert.deepEqual(f.opened[0].searchParams.get('scope').split(' '),scopes);assert.equal(f.provider.savedTokens.resourceUrl,url)}
});

test('missing scope in a token response means requested scope, while explicit partial consent fails',async t=>{
 const omitted=await fixture(t,{tokenChanges:{scope:undefined}});assert.equal(await call(omitted),true);assert.equal(omitted.provider.savedTokens.scope,SCOPES.join(' '));
 const partial=await fixture(t,{tokenChanges:{scope:SCOPES[0]}});await assert.rejects(call(partial),/grant.*scopes/i);
});

test('known Google origins reject noncanonical MCP URLs before anonymous discovery or sign-in',async()=>{
 for(const url of ['https://gmailmcp.googleapis.com/mcp/v1/','https://gmailmcp.googleapis.com/mcp/v1?x=1','https://calendarmcp.googleapis.com/other','https://drivemcp.googleapis.com/mcp/v1/']){
  let requests=0;await assert.rejects(prepareGoogleAuthorization({row:{url},provider:{},fetchImpl:()=>{requests++;throw Error('Unexpected fetch')}}),/exact.*URL|canonical/i);assert.equal(requests,0);
 }
});

test('standard Gmail API authorization skips MCP discovery and renews tokens without a browser',async t=>{
 const url='https://gmail.googleapis.com/gmail/v1';const f=await fixture(t,{rowChanges:{url}});
 assert.equal(await call(f),true);assert.equal(f.opened.length,1);assert.equal(f.opened[0].searchParams.has('resource'),false);
 assert.ok(f.requests.every(r=>!r.url.includes('mcp')&&!r.url.includes('oauth-protected-resource')));
 const {gmailAccessToken}=require('../electron/mcp/google-auth.cjs');
 f.provider.savedTokens.expiresAt=Date.now()-1;
 const token=await gmailAccessToken(f.provider,f.fetchImpl);assert.equal(token,'fixture-access-token');assert.equal(f.opened.length,1);assert.equal(f.requests.at(-1).init.body.get('grant_type'),'refresh_token');
 await gmailAccessToken(f.provider,f.fetchImpl,true);assert.equal(f.opened.length,1);assert.equal(f.requests.at(-1).init.body.get('grant_type'),'refresh_token');
 delete f.provider.savedTokens.refresh_token;await assert.rejects(gmailAccessToken(f.provider,f.fetchImpl,true),/Reconnect/);assert.equal(f.opened.length,1);
});

test('direct Calendar and Drive authorize and refresh independently on their shared API origin',async t=>{
 const {googleAccessToken}=require('../electron/mcp/google-auth.cjs');
 for(const [catalogId,url,scopes]of[
  ['google-calendar','https://www.googleapis.com/calendar/v3',['calendar.calendarlist.readonly','calendar.events.freebusy','calendar.events.readonly']],
  ['google-drive','https://www.googleapis.com/drive/v3',['drive.readonly','drive.file']],
 ]){const required=scopes.map(s=>'https://www.googleapis.com/auth/'+s);const f=await fixture(t,{rowChanges:{catalogId,url},supportedScopes:required});await call(f);assert.equal(f.opened[0].searchParams.has('resource'),false);assert.deepEqual(f.opened[0].searchParams.get('scope').split(' '),required);assert.ok(f.requests.every(r=>!r.url.includes('oauth-protected-resource')));await googleAccessToken(f.provider,f.fetchImpl,true);assert.equal(f.opened.length,1);assert.equal(f.provider.savedTokens.resourceUrl,url);}
});


test('background Google reconnect refreshes without binding the shared callback port',async t=>{
 const port=await freePort(),occupied=require('node:http').createServer();await new Promise(resolve=>occupied.listen(port,'127.0.0.1',resolve));t.after(()=>occupied.close());
 const f=await fixture(t,{interactive:false,rowChanges:{url:'https://gmail.googleapis.com/gmail/v1',redirectPort:port},tokens:{access_token:'expired-token',refresh_token:'cached-refresh',issuer:'https://accounts.google.com',expiresAt:Date.now()-1,scope:SCOPES.join(' ')}});
 assert.equal(await call(f),true);assert.equal(f.provider.server,undefined);assert.equal(f.opened.length,0);assert.equal(f.requests.find(r=>r.url.endsWith('/token')).init.body.get('grant_type'),'refresh_token');
});

test('background Google reconnect requires new consent for missing scopes without opening the browser',async t=>{
 const f=await fixture(t,{interactive:false,rowChanges:{url:'https://gmail.googleapis.com/gmail/v1'},tokens:{access_token:'cached-token',refresh_token:'cached-refresh',issuer:'https://accounts.google.com',expiresAt:Date.now()+3600000,scope:SCOPES[0]}});
 await assert.rejects(call(f),error=>error.needsSignIn===true);assert.equal(f.opened.length,0);assert.equal(f.requests.filter(r=>r.url.endsWith('/token')).length,0);
});


test('revoked Google refresh grant requires sign-in while a temporary token outage only needs retry',async t=>{
 for(const temporary of [false,true]){
  const f=await fixture(t,{interactive:false,rowChanges:{url:'https://gmail.googleapis.com/gmail/v1'},tokens:{access_token:'expired-token',refresh_token:'cached-refresh',issuer:'https://accounts.google.com',expiresAt:Date.now()-1,scope:SCOPES.join(' ')}});
  const fetchImpl=f.fetchImpl;f.fetchImpl=(url,init)=>String(url).endsWith('/token')?Promise.resolve(Response.json({error:temporary?'server_error':'invalid_grant'},{status:temporary?503:400})):fetchImpl(url,init);
  await assert.rejects(call(f));assert.equal(f.provider.needsSignIn===true,!temporary);assert.equal(f.opened.length,0);assert.equal(f.provider.server,undefined);
 }
});
