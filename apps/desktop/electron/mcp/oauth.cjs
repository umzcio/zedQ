const http=require('node:http');
const {randomBytes,timingSafeEqual}=require('node:crypto');
const {validateAuthorizationResponseIssuer,auth,extractWWWAuthenticateParams,UnauthorizedError}=require('@modelcontextprotocol/client');
const {ConnectorError,validUrl,boundedJSON}=require('./security.cjs');
// Published public registration: github.com/microsoft/work-iq/blob/main/plugins/workiq/.mcp.json.
// Copilot CLI 1.0.52's published callback server uses http://127.0.0.1:<port>/.
const WORKIQ='https://workiq.svc.cloud.microsoft/mcp',WORKIQ_METADATA='https://workiq.svc.cloud.microsoft/.well-known/oauth-protected-resource/mcp';
const ENTRA='https://login.microsoftonline.com/organizations/v2.0',ENTRA_ISSUER='https://login.microsoftonline.com/{tenantid}/v2.0';
const ENTRA_AUTHORIZE='https://login.microsoftonline.com/organizations/oauth2/v2.0/authorize',ENTRA_TOKEN='https://login.microsoftonline.com/organizations/oauth2/v2.0/token';

class NativeOAuthProvider {
 constructor({row,secrets,signal,openExternal,onAuthenticating,allowLoopbackHttp,interactive=true}){
  Object.assign(this,{row,secrets,signal,openExternal,onAuthenticating,allowLoopbackHttp});this.workIQ=row.catalogId==='microsoft365'&&row.url===WORKIQ&&(row.authType??'oauth')==='oauth'&&row.clientId==='ba081686-5d24-4bc6-a0d6-d034ecffed87'&&row.redirectPort===12798&&row.redirectHost==='127.0.0.1'&&!row.clientMetadataUrl;this.callbackPath=this.workIQ?'/':'/oauth/callback';
  // Entra v2 uses scopes, not the legacy resource parameter (also omitted by Copilot CLI).
  if(this.workIQ)this.validateResourceURL=(requested,advertised)=>{if(requested.href!==WORKIQ||advertised!==WORKIQ)throw new ConnectorError('Work IQ authorization resource changed. Update zQ before signing in.');return undefined};
  this.interactive=interactive;this.nonce=randomBytes(32).toString('base64url');
  this.callback=new Promise((resolve,reject)=>{this.resolveCallback=resolve;this.rejectCallback=reject});this.callback.catch(()=>{});
  this.abort=()=>this.close(new ConnectorError('Connector authorization cancelled.'));signal.addEventListener('abort',this.abort,{once:true});
 }
 async start(){
  if(this.row.authType==='bearer'){
   const token=await this.secrets.get('token');this.signal.throwIfAborted();
   if(!token?.value||token.url!==this.row.url){this.needsSignIn=true;throw new ConnectorError('Enter a bearer token for this connector endpoint, then connect.')}
   this.savedTokens={access_token:token.value};return;
  }
  this.savedTokens=await this.secrets.get('tokens');if(this.savedTokens?.resourceUrl!==this.row.url)this.savedTokens=undefined;
  this.savedClient=await this.secrets.get('client');this.manualSecret=await this.secrets.get('clientSecret');
  if(this.workIQ&&this.manualSecret)throw new ConnectorError('Microsoft’s published Work IQ app is a public client. Clear the client secret to use it.');
  if(this.manualSecret&&(this.manualSecret.url!==this.row.url||this.manualSecret.clientId!==this.row.clientId))throw new ConnectorError('OAuth client secret belongs to different connection settings. Enter it again for this endpoint and client ID.');
  this.signal.throwIfAborted();
  if(!this.interactive){
   // Refresh grants do not use a redirect or need a listening callback port.
   this.redirectUrl=`http://${this.row.redirectHost??'127.0.0.1'}:${this.row.redirectPort??1}${this.callbackPath}`;return;
  }
  this.server=http.createServer((req,res)=>this.receive(req,res));this.server.requestTimeout=10000;this.server.headersTimeout=10000;
  await new Promise((resolve,reject)=>{this.server.once('error',error=>reject(new ConnectorError(error.code==='EADDRINUSE'?'OAuth callback port is in use. Close the other sign-in session or choose a registered callback port.':'OAuth callback listener could not start. Check the registered callback port.')));this.server.listen(this.row.redirectPort??0,'127.0.0.1',resolve)});
  this.redirectUrl=`http://${this.row.redirectHost??'127.0.0.1'}:${this.server.address().port}${this.callbackPath}`;this.signal.throwIfAborted();
 }
 async prepare(fetchFn){
  if(!this.workIQ)return;
  const read=async url=>{const response=await fetchFn(url,{headers:{Accept:'application/json'}});if(!response.ok)throw new ConnectorError('Work IQ authorization metadata is unavailable. Try connecting again later.');const value=await response.json();boundedJSON(value,128*1024,'Work IQ authorization metadata');return value};
  const resource=await read(WORKIQ_METADATA),metadata=await read(`${ENTRA}/.well-known/openid-configuration`);this.signal.throwIfAborted();
  if(resource.resource!==WORKIQ||!Array.isArray(resource.authorization_servers)||resource.authorization_servers.length!==1||resource.authorization_servers[0]!==ENTRA||!Array.isArray(resource.scopes_supported)||resource.scopes_supported.length!==1||resource.scopes_supported[0]!=='fdcc1f02-fc51-4226-8753-f668596af7f7/WorkIQAgent.Ask'||metadata.issuer!==ENTRA_ISSUER||metadata.authorization_endpoint!==ENTRA_AUTHORIZE||metadata.token_endpoint!==ENTRA_TOKEN||!Array.isArray(metadata.response_types_supported)||!metadata.response_types_supported.includes('code'))throw new ConnectorError('Work IQ authorization metadata changed. Update zQ before signing in.');
  // Entra's organizations document intentionally publishes a tenant issuer template:
  // learn.microsoft.com/entra/identity-platform/access-tokens#validate-the-issuer.
  // Validate that exact template and endpoints above, then use the SDK's supported
  // discoveryState cache hook. Do not enable skipIssuerMetadataValidation globally.
  // Microsoft's published Work IQ registration is explicitly a public client; Entra
  // documents native authorization-code + PKCE despite omitting "none" in discovery.
  await this.saveDiscoveryState({authorizationServerUrl:ENTRA,resourceMetadataUrl:WORKIQ_METADATA,resourceMetadata:resource,authorizationServerMetadata:{...metadata,token_endpoint_auth_methods_supported:['none']}});
 }
 transportAuth(){if(this.row.authType==='bearer')return {token:async()=>this.savedTokens?.access_token,onUnauthorized:async()=>{throw new ConnectorError('Bearer token was rejected or expired. Update the token in connector settings and reconnect.')}};return {token:async()=>this.tokens()?.access_token,onUnauthorized:async ctx=>{
  if(!this.interactive&&!this.savedTokens?.refresh_token)throw this.signInRequired();
  if(!this.authFlight){const challenge=extractWWWAuthenticateParams(ctx.response);this.challenge=challenge;
   this.authFlight=auth(this,{serverUrl:this.row.url,...challenge,fetchFn:this.authorizationFetch(ctx.fetchFn)}).then(result=>{if(result!=='AUTHORIZED')throw new UnauthorizedError()}).finally(()=>{this.authFlight=undefined});
  }return this.authFlight;
 }}}
 async finish(params,fetchFn){const result=await auth(this,{serverUrl:this.row.url,...this.challenge,authorizationCode:params.get('code'),iss:params.get('iss')??undefined,fetchFn});if(result!=='AUTHORIZED')throw new ConnectorError('Authorization did not complete. Reconnect.')}
 get clientMetadataUrl(){return this.row.clientMetadataUrl}
 get clientMetadata(){return {client_name:'zQ',redirect_uris:[this.redirectUrl],grant_types:['authorization_code','refresh_token'],response_types:['code'],token_endpoint_auth_method:this.manualSecret?'client_secret_basic':'none',application_type:'native'}}
 state(){return this.nonce}
 clientInformation(ctx){if(!this.interactive&&!this.row.clientId&&!this.savedClient&&!this.row.clientMetadataUrl)throw this.signInRequired();if(this.row.clientId)return {client_id:this.row.clientId,...(this.manualSecret?{client_secret:this.manualSecret.value,token_endpoint_auth_method:this.clientAuthMethod}:{token_endpoint_auth_method:'none'}),issuer:ctx?.issuer};return this.savedClient}
 async saveClientInformation(value){if(value.client_secret||value.token_endpoint_auth_method&&value.token_endpoint_auth_method!=='none')throw new ConnectorError('This provider requires a confidential client. Register zQ as a public native client and enter its client ID.');this.signal.throwIfAborted();await this.secrets.set('client',value);this.savedClient=value}
 tokens(ctx){if(!ctx&&this.savedTokens?.expiresAt&&Date.now()>=this.savedTokens.expiresAt)return undefined;return this.savedTokens}
 async saveTokens(value){this.signal.throwIfAborted();const tokens={...value,resourceUrl:this.row.url,...(!value.refresh_token&&this.savedTokens?.issuer===value.issuer?{refresh_token:this.savedTokens.refresh_token}:{}),...(Number.isFinite(value.expires_in)?{expiresAt:Date.now()+value.expires_in*1000}: {})};await this.secrets.set('tokens',tokens);this.savedTokens=tokens}
 async saveDiscoveryState(value){boundedJSON(value,128*1024,'OAuth discovery');const m=value.authorizationServerMetadata;
  if(!this.row.clientId&&!this.savedClient&&!m?.registration_endpoint&&!(m?.client_id_metadata_document_supported&&this.row.clientMetadataUrl))throw new ConnectorError('This provider requires client registration. Enter a pre-registered client ID or a supported HTTPS client metadata URL.');
  if(this.manualSecret){
   const methods=m?.token_endpoint_auth_methods_supported??['client_secret_basic'];this.clientAuthMethod=methods.includes('client_secret_basic')?'client_secret_basic':methods.includes('client_secret_post')?'client_secret_post':undefined;
   if(!this.clientAuthMethod)throw new ConnectorError('This provider does not support Basic or POST client-secret authentication. Check the registered app requirements.');
   const issuer=m?.issuer??value.authorizationServerUrl,tokenEndpoint=m?.token_endpoint;
   if(!issuer||!tokenEndpoint)throw new ConnectorError('The provider must publish its issuer and token endpoint before a client secret can be used.');
   validUrl(tokenEndpoint,this.allowLoopbackHttp);
   if(this.manualSecret.issuer&&(this.manualSecret.issuer!==issuer||this.manualSecret.tokenEndpoint!==tokenEndpoint))throw new ConnectorError('OAuth provider or token endpoint changed. Verify the provider and enter the client secret again.');
   if(!this.manualSecret.issuer){this.signal.throwIfAborted();this.manualSecret={...this.manualSecret,issuer,tokenEndpoint};await this.secrets.set('clientSecret',this.manualSecret)}
  }else if(m?.token_endpoint_auth_methods_supported&&!m.token_endpoint_auth_methods_supported.includes('none'))throw new ConnectorError('This provider requires a registered client secret. Enter your app client ID and client secret in connector settings.');
  this.discovery=value;
 }
 discoveryState(){return this.discovery}
 saveCodeVerifier(value){this.verifier=value}
 codeVerifier(){if(!this.verifier)throw new ConnectorError('Authorization expired. Reconnect.');return this.verifier}
 authorizationFetch(fetchFn){this.authorizationFailure=undefined;return async(...args)=>{try{const response=await fetchFn(...args);if(response.status===429||response.status>=500)this.authorizationFailure=new ConnectorError('Connector authorization service is unavailable. Try connecting again later.');return response}catch(error){this.authorizationFailure=new ConnectorError('Could not reach the connector authorization service. Check your connection and try again.');throw error}}}
 signInRequired(){this.needsSignIn=true;const error=new ConnectorError('Connector authorization expired. Reconnect to sign in again.');error.needsSignIn=true;return error}
 async redirectToAuthorization(url){if(this.authorizationFailure)throw this.authorizationFailure;if(!this.interactive||this.signal.aborted)throw this.signInRequired();validUrl(url.href,this.allowLoopbackHttp,true);this.onAuthenticating();this.redirected=true;await this.openExternal(url.href)}
 async invalidateCredentials(scope){if(scope==='all'||scope==='tokens'){await this.secrets.delete('tokens');this.savedTokens=undefined}if(scope==='all'||scope==='client'){await this.secrets.delete('client');this.savedClient=undefined}if(scope==='all'||scope==='verifier')this.verifier=undefined;if(scope==='all'||scope==='discovery')this.discovery=undefined}
 receive(req,res){const reply=(status,text)=>{res.writeHead(status,{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store','Content-Security-Policy':"default-src 'none'",'Referrer-Policy':'no-referrer'});res.end(text)};
  if(req.method!=='GET'||req.url.length>8192||req.headers.host!==new URL(this.redirectUrl).host)return reply(400,'Invalid authorization callback.');
  const url=new URL(req.url,this.redirectUrl);if(url.pathname!==this.callbackPath)return reply(404,'Not found.');
  const states=url.searchParams.getAll('state'),actual=Buffer.from(states[0]||''),expected=Buffer.from(this.nonce);
  if(!this.redirected||states.length!==1||actual.length!==expected.length||!timingSafeEqual(actual,expected))return reply(400,'Invalid authorization state.');
  try{if(url.searchParams.getAll('iss').length>1||url.searchParams.getAll('code').length>1)throw Error();validateAuthorizationResponseIssuer({iss:url.searchParams.get('iss')??undefined,expectedIssuer:this.discovery?.authorizationServerMetadata?.issuer??this.discovery?.authorizationServerUrl,issParameterSupported:this.discovery?.authorizationServerMetadata?.authorization_response_iss_parameter_supported===true})}catch{return reply(400,'Invalid authorization issuer.')}
  if(url.searchParams.has('error')){reply(400,'Authorization was declined. Return to zQ.');this.rejectCallback(new ConnectorError('Authorization was declined. Reconnect to try again.'));return this.stopListener()}
  const code=url.searchParams.get('code');if(!code||code.length>4096)return reply(400,'Invalid authorization code.');
  reply(200,'Authorization received. You can return to zQ.');this.resolveCallback(url.searchParams);this.stopListener();
 }
 stopListener(){this.server?.close();this.server?.closeIdleConnections()}
 close(error=new ConnectorError('Connector authorization cancelled.')){this.interactive=false;this.verifier=undefined;this.rejectCallback(error);this.stopListener();this.server?.closeAllConnections();this.signal.removeEventListener('abort',this.abort)}
}
module.exports={NativeOAuthProvider};
