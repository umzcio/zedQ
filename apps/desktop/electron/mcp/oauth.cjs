const http=require('node:http');
const {randomBytes,timingSafeEqual}=require('node:crypto');
const {validateAuthorizationResponseIssuer,auth,extractWWWAuthenticateParams,UnauthorizedError}=require('@modelcontextprotocol/client');
const {ConnectorError,validUrl,boundedJSON}=require('./security.cjs');
class NativeOAuthProvider {
 constructor({row,secrets,signal,openExternal,onAuthenticating,allowLoopbackHttp}){
  Object.assign(this,{row,secrets,signal,openExternal,onAuthenticating,allowLoopbackHttp});this.interactive=true;this.nonce=randomBytes(32).toString('base64url');
  this.callback=new Promise((resolve,reject)=>{this.resolveCallback=resolve;this.rejectCallback=reject});this.callback.catch(()=>{});
  this.abort=()=>this.close(new ConnectorError('Connector authorization cancelled.'));signal.addEventListener('abort',this.abort,{once:true});
 }
 async start(){this.savedTokens=await this.secrets.get('tokens');this.savedClient=await this.secrets.get('client');this.signal.throwIfAborted();
  this.server=http.createServer((req,res)=>this.receive(req,res));this.server.requestTimeout=10000;this.server.headersTimeout=10000;
  await new Promise((resolve,reject)=>{this.server.once('error',reject);this.server.listen(0,'127.0.0.1',resolve)});
  this.redirectUrl=`http://127.0.0.1:${this.server.address().port}/oauth/callback`;this.signal.throwIfAborted();
 }
 transportAuth(){return {token:async()=>this.tokens()?.access_token,onUnauthorized:ctx=>{
  if(!this.authFlight){const challenge=extractWWWAuthenticateParams(ctx.response);this.challenge=challenge;
   this.authFlight=auth(this,{serverUrl:this.row.url,...challenge,fetchFn:ctx.fetchFn}).then(result=>{if(result!=='AUTHORIZED')throw new UnauthorizedError()}).finally(()=>{this.authFlight=undefined});
  }return this.authFlight;
 }}}
 async finish(params,fetchFn){const result=await auth(this,{serverUrl:this.row.url,...this.challenge,authorizationCode:params.get('code'),iss:params.get('iss')??undefined,fetchFn});if(result!=='AUTHORIZED')throw new ConnectorError('Authorization did not complete. Reconnect.')}
 get clientMetadataUrl(){return this.row.clientMetadataUrl}
 get clientMetadata(){return {client_name:'zQ',redirect_uris:[this.redirectUrl],grant_types:['authorization_code','refresh_token'],response_types:['code'],token_endpoint_auth_method:'none',application_type:'native'}}
 state(){return this.nonce}
 clientInformation(ctx){if(this.row.clientId)return {client_id:this.row.clientId,token_endpoint_auth_method:'none',issuer:ctx?.issuer};return this.savedClient}
 async saveClientInformation(value){if(value.client_secret||value.token_endpoint_auth_method&&value.token_endpoint_auth_method!=='none')throw new ConnectorError('This provider requires a confidential client. Register zQ as a public native client and enter its client ID.');this.signal.throwIfAborted();await this.secrets.set('client',value);this.savedClient=value}
 tokens(ctx){if(!ctx&&this.savedTokens?.expiresAt&&Date.now()>=this.savedTokens.expiresAt)return undefined;return this.savedTokens}
 async saveTokens(value){this.signal.throwIfAborted();const tokens={...value,...(!value.refresh_token&&this.savedTokens?.issuer===value.issuer?{refresh_token:this.savedTokens.refresh_token}:{}),...(Number.isFinite(value.expires_in)?{expiresAt:Date.now()+value.expires_in*1000}: {})};await this.secrets.set('tokens',tokens);this.savedTokens=tokens}
 saveDiscoveryState(value){boundedJSON(value,128*1024,'OAuth discovery');const m=value.authorizationServerMetadata;
  if(!this.row.clientId&&!this.savedClient&&!m?.registration_endpoint&&!(m?.client_id_metadata_document_supported&&this.row.clientMetadataUrl))throw new ConnectorError('This provider requires client registration. Enter a pre-registered public client ID or a supported HTTPS client metadata URL.');
  if(m?.token_endpoint_auth_methods_supported&&!m.token_endpoint_auth_methods_supported.includes('none'))throw new ConnectorError('This provider does not support public native OAuth clients. Check its client registration requirements.');
  this.discovery=value;
 }
 discoveryState(){return this.discovery}
 saveCodeVerifier(value){this.verifier=value}
 codeVerifier(){if(!this.verifier)throw new ConnectorError('Authorization expired. Reconnect.');return this.verifier}
 async redirectToAuthorization(url){if(!this.interactive||this.signal.aborted)throw new ConnectorError('Connector authorization expired. Reconnect to sign in.');validUrl(url.href,this.allowLoopbackHttp,true);this.onAuthenticating();this.redirected=true;await this.openExternal(url.href)}
 async invalidateCredentials(scope){if(scope==='all'||scope==='tokens'){await this.secrets.delete('tokens');this.savedTokens=undefined}if(scope==='all'||scope==='client'){await this.secrets.delete('client');this.savedClient=undefined}if(scope==='all'||scope==='verifier')this.verifier=undefined;if(scope==='all'||scope==='discovery')this.discovery=undefined}
 receive(req,res){const reply=(status,text)=>{res.writeHead(status,{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store','Content-Security-Policy':"default-src 'none'",'Referrer-Policy':'no-referrer'});res.end(text)};
  if(req.method!=='GET'||req.url.length>8192||req.headers.host!==new URL(this.redirectUrl).host)return reply(400,'Invalid authorization callback.');
  const url=new URL(req.url,this.redirectUrl);if(url.pathname!=='/oauth/callback')return reply(404,'Not found.');
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
