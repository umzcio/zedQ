'use strict';
const {auth,discoverOAuthServerInfo}=require('@modelcontextprotocol/client');
const {ConnectorError,createSafeFetch,boundedJSON}=require('./security.cjs');
const {getCatalogEntry}=require('./catalog.cjs');

// Google permits anonymous MCP initialization/tool discovery. Authorization must
// therefore finish during explicit Connect, before those public methods succeed.
// Scopes are Google's documented MCP setup scopes, not every advertised scope:
// https://developers.google.com/workspace/guides/configure-mcp-servers
const PREFIX='https://www.googleapis.com/auth/';
const SCOPES={
 gmail:['gmail.readonly','gmail.compose'],
 'google-drive':['drive.readonly','drive.file'],
 'google-calendar':['calendar.calendarlist.readonly','calendar.events.freebusy','calendar.events.readonly'],
};
const ISSUER='https://accounts.google.com';
const AUTHORIZATION_ENDPOINT=ISSUER+'/o/oauth2/v2/auth';
const TOKEN_ENDPOINT='https://oauth2.googleapis.com/token';
function googleEntry(row){
 let origin;try{origin=new URL(row?.url).origin}catch{return undefined}
 const entry=Object.keys(SCOPES).map(getCatalogEntry).find(item=>item&&new URL(item.url).origin===origin);
 if(entry&&entry.url!==row.url)throw new ConnectorError(`Use the exact Google MCP URL for this connector: ${entry.url}`);
 return entry;
}
function scopesCover(value,required){const granted=new Set(typeof value==='string'?value.split(/\s+/):[]);return required.every(scope=>granted.has(scope))}
function issuerMatches(value){return value===ISSUER||value===ISSUER+'/'}
function waiting(promise,signal){
 signal?.throwIfAborted();if(!signal)return promise;
 return new Promise((resolve,reject)=>{
  const abort=()=>finish(new ConnectorError('Google sign-in cancelled.'));
  const finish=(error,value)=>{signal.removeEventListener('abort',abort);error?reject(error):resolve(value)};
  signal.addEventListener('abort',abort,{once:true});Promise.resolve(promise).then(value=>finish(null,value),error=>finish(error));if(signal.aborted)abort();
 });
}
async function prepareGoogleAuthorization({row,provider,fetchImpl=globalThis.fetch,signal=provider?.signal}={}){
 const entry=googleEntry(row);if(!entry)return false;
 if(row.authType&&row.authType!=='oauth')throw new ConnectorError('Google Workspace presets require OAuth. Choose OAuth and enter your registered Google client ID and secret.');
 if(!provider?.interactive)throw new ConnectorError('Reconnect this Google connector to sign in. Authorization can only start during explicit Connect.');
 if(!row.clientId||!provider.manualSecret?.value)throw new ConnectorError('Enter the Google OAuth web client ID and client secret, enable the API and MCP service in that Cloud project, then connect.');
 if(!['127.0.0.1','localhost'].includes(row.redirectHost??'127.0.0.1')||!Number.isInteger(row.redirectPort)||row.redirectPort<1||row.redirectPort>65535||provider.redirectUrl!==`http://${row.redirectHost??'127.0.0.1'}:${row.redirectPort}/oauth/callback`)throw new ConnectorError('Configure a fixed local callback port and register its exact callback URL in your Google OAuth web client, then connect.');
 signal?.throwIfAborted();
 const required=SCOPES[entry.id].map(scope=>PREFIX+scope),server=new URL(row.url);
 const allowed=new Set([
  `${server.origin}/.well-known/oauth-protected-resource${server.pathname}`,
  `${server.origin}/.well-known/oauth-protected-resource`,
  ISSUER+'/.well-known/oauth-authorization-server',ISSUER+'/.well-known/openid-configuration',TOKEN_ENDPOINT,
 ]);
 const boundedFetch=createSafeFetch({signal,fetchImpl,maxBytes:128*1024,timeoutMs:15000,credentialOrigin:server.origin,tokenEndpoint:()=>provider.discovery?.authorizationServerMetadata?.token_endpoint});
 const googleFetch=(input,init)=>{
  const url=input instanceof Request?input.url:String(input);
  if(!allowed.has(url))throw new ConnectorError('Google OAuth metadata referenced an unexpected endpoint. Check the Google connector configuration.');
  return boundedFetch(input,init);
 };
 try{
  const discovery=await discoverOAuthServerInfo(row.url,{fetchFn:googleFetch});signal?.throwIfAborted();
  boundedJSON(discovery,128*1024,'Google OAuth discovery');
  const resource=discovery.resourceMetadata,metadata=discovery.authorizationServerMetadata;
  if(resource?.resource!==row.url||!resource.authorization_servers?.length||!resource.authorization_servers.every(issuerMatches)||!issuerMatches(discovery.authorizationServerUrl)||!issuerMatches(metadata?.issuer)||metadata.authorization_endpoint!==AUTHORIZATION_ENDPOINT||metadata.token_endpoint!==TOKEN_ENDPOINT||!metadata.code_challenge_methods_supported?.includes('S256')||!required.every(scope=>resource.scopes_supported?.includes(scope)))throw new ConnectorError('Google OAuth metadata does not match this connector or its documented scopes. Check the Google MCP configuration before signing in.');
  // Provider saves the issuer/token-endpoint binding before any client secret is
  // sent. All SDK issuer and callback checks remain enabled.
  await provider.saveDiscoveryState(discovery);
  const complete=()=>{provider.redirected=false;provider.interactive=false;provider.verifier=undefined;provider.stopListener();return true};
  const prior=provider.savedTokens;
  const correctGrant=prior?.resourceUrl===row.url&&issuerMatches(prior.issuer)&&scopesCover(prior.scope,required);
  if(correctGrant&&prior.access_token&&Number.isFinite(prior.expiresAt)&&prior.expiresAt>Date.now()+30000)return complete();
  provider.challenge={scope:required.join(' ')};
  const oauthProvider=new Proxy(provider,{get(target,key){
   if(key==='redirectToAuthorization')return async value=>{
    const url=new URL(value);if(url.origin+url.pathname!==AUTHORIZATION_ENDPOINT)throw new ConnectorError('Google returned an unexpected authorization endpoint.');
    url.searchParams.set('access_type','offline');url.searchParams.set('prompt','consent');
    return target.redirectToAuthorization(url);
   };
   const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;
  }});
  const result=await auth(oauthProvider,{serverUrl:row.url,scope:provider.challenge.scope,fetchFn:googleFetch,forceReauthorization:!correctGrant});
  if(result==='REDIRECT'){
   const params=await waiting(provider.callback,signal);signal?.throwIfAborted();await provider.finish(params,googleFetch);
  }else if(result!=='AUTHORIZED')throw new ConnectorError('Google authorization did not complete. Reconnect to sign in.');
  signal?.throwIfAborted();
  const saved=provider.savedTokens;
  if(!saved?.access_token||saved.resourceUrl!==row.url||!issuerMatches(saved.issuer)||saved.expiresAt&&saved.expiresAt<=Date.now())throw new ConnectorError('Google did not return a usable authorization. Reconnect to sign in.');
  // RFC 6749 permits omission when the granted scope equals the requested one.
  if(saved.scope===undefined)await provider.saveTokens({...saved,scope:required.join(' ')});
  else if(!scopesCover(saved.scope,required))throw new ConnectorError('Google did not grant the scopes required by this connector. Review the consent and Cloud app configuration, then reconnect.');
  return complete();
 }catch(error){
  if(signal?.aborted)throw new ConnectorError('Google sign-in cancelled.');
  if(error instanceof ConnectorError)throw error;
  throw new ConnectorError('Google authorization failed. Check the registered client, callback URL, enabled APIs, MCP services and consent-screen test users, then reconnect.');
 }
}
module.exports={prepareGoogleAuthorization};
