const {randomUUID}=require('node:crypto');
class ConnectorError extends Error {}
function safeError(error) {
 if(error instanceof ConnectorError)return error;
 if(error?.name==='AbortError'||error?.name==='TimeoutError')return new ConnectorError('Connector request cancelled or timed out. Reconnect and try again.');
 if(/Unauthorized|OAuth|Issuer|Registration|InsufficientScope/.test(error?.constructor?.name||''))return new ConnectorError('Connector authorization failed or expired. Reconnect; check the token, client ID and provider registration requirements.');
 return new ConnectorError('Connector request failed. Check the server URL and connection, then reconnect.');
}
function validUrl(value,allowLoopbackHttp=false,allowOAuthParams=false,allowedQueryParams=[]) {
 let url;try{url=new URL(value)}catch{throw new ConnectorError('Enter a valid HTTPS server URL.')}
 if(url.username||url.password||url.hash)throw new ConnectorError('Server URLs cannot contain credentials or fragments.');
 if(url.protocol!=='https:'&&!(allowLoopbackHttp&&url.protocol==='http:'&&['127.0.0.1','[::1]','localhost'].includes(url.hostname)))throw new ConnectorError('Remote connectors require HTTPS.');
 if(url.href.length>2048)throw new ConnectorError('Server URL is too long.');
 // URL query secrets cannot be protected by Keychain once stored as metadata.
 for(const name of url.searchParams.keys())if(!allowOAuthParams&&!allowedQueryParams.includes(name)&&/token|secret|password|api.?key|authorization|code/i.test(name))throw new ConnectorError('Server URLs cannot contain credentials. Use browser authorization.');
 return url;
}
function boundedJSON(value,limit,label='Connector data') {
 let encoded;try{encoded=JSON.stringify(value)}catch{throw new ConnectorError(`${label} must be valid JSON.`)}
 if(!encoded||Buffer.byteLength(encoded)>limit)throw new ConnectorError(`${label} exceeds the supported size limit.`);
 return encoded;
}
function createSafeFetch({signal,allowLoopbackHttp=false,fetchImpl=fetch,timeoutMs=60000,maxBytes=2*1024*1024,allowedQueryParams=[],credentialOrigin,tokenEndpoint=()=>undefined}) {
 return async(input,init={})=>{
  const url=validUrl(input instanceof Request?input.url:String(input),allowLoopbackHttp,false,allowedQueryParams);
  if(credentialOrigin){
   const headers=new Headers(init.headers??(input instanceof Request?input.headers:undefined)),authorization=headers.get('authorization');
   if(authorization&&/^Bearer /i.test(authorization)&&url.origin!==credentialOrigin)throw new ConnectorError('Connector credential origin does not match its saved endpoint.');
   const endpoint=tokenEndpoint();const tokenRequest=endpoint&&url.href===new URL(endpoint).href;
   if(authorization&&!/^Bearer /i.test(authorization)&&!tokenRequest)throw new ConnectorError('OAuth credentials can only be sent to the discovered token endpoint.');
   const body=init.body;
   if(body instanceof URLSearchParams&&['client_secret','refresh_token','code'].some(key=>body.has(key))&&!tokenRequest)throw new ConnectorError('OAuth credentials can only be sent to the discovered token endpoint.');
  }
  const requestSignal=AbortSignal.any([signal,init.signal,...(input instanceof Request?[input.signal]:[]),AbortSignal.timeout(timeoutMs)].filter(Boolean));
  const response=await fetchImpl(url,{...init,signal:requestSignal,redirect:'error',credentials:'omit'});
  if(Number(response.headers.get('content-length'))>maxBytes){await response.body?.cancel();throw new ConnectorError('Connector response exceeds the supported size limit.')}
  if(!response.body)return response;
  const reader=response.body.getReader();let count=0;
  const stream=new ReadableStream({async pull(controller){try{const {done,value}=await reader.read();if(done){controller.close();return}count+=value.byteLength;if(count>maxBytes){await reader.cancel();throw new ConnectorError('Connector response exceeds the supported size limit.')}controller.enqueue(value)}catch(error){controller.error(error)}},cancel:reason=>reader.cancel(reason)});
  return new Response(stream,{status:response.status,statusText:response.statusText,headers:response.headers});
 };
}
// Credentials may contain arbitrary Unicode and exceed one native Keychain entry.
// Commit a manifest last, so a failed write never replaces the previous secret.
class SecretStore {
 constructor(credentials,id){this.credentials=credentials;this.prefix=`mcp-${id}`;this.queue=Promise.resolve()}
 key(slot){return `${this.prefix}-${slot}`}
 async get(slot){const raw=await this.credentials.get(this.key(slot));if(!raw)return undefined;try{const m=JSON.parse(Buffer.from(raw,'base64url').toString());if(!/^[a-f0-9-]{36}$/.test(m.g)||!Number.isInteger(m.n)||m.n<1||m.n>32)throw Error();let text='';for(let i=0;i<m.n;i++){const chunk=await this.credentials.get(`${this.key(slot)}-${m.g}-${i}`);if(typeof chunk!=='string'||chunk.length>7800)throw Error();text+=chunk}return JSON.parse(Buffer.from(text,'base64url').toString())}catch{throw new ConnectorError('Saved connector credentials could not be read. Remove and reconnect the server.')}}
 transaction(changes,commit){const operation=this.queue.then(async()=>{
  const staged=[];
  try{
   for(const [slot,value] of Object.entries(changes)){
    const old=await this.credentials.get(this.key(slot));const entry={slot,old};staged.push(entry);
    if(value!==undefined){const encoded=Buffer.from(boundedJSON(value,128*1024,'Connector credentials')).toString('base64url');entry.manifest={g:randomUUID(),n:Math.ceil(encoded.length/7800)};for(let i=0;i<entry.manifest.n;i++)await this.credentials.set(`${this.key(slot)}-${entry.manifest.g}-${i}`,encoded.slice(i*7800,(i+1)*7800))}
   }
   for(const entry of staged){entry.touched=true;if(entry.manifest)await this.credentials.set(this.key(entry.slot),Buffer.from(JSON.stringify(entry.manifest)).toString('base64url'));else await this.credentials.delete(this.key(entry.slot))}
   await commit();
  }catch(error){
   let failed=false;for(const entry of staged){try{if(entry.touched){if(entry.old)await this.credentials.set(this.key(entry.slot),entry.old);else await this.credentials.delete(this.key(entry.slot))}await this.cleanup(entry.slot,entry.manifest)}catch{failed=true}}
   if(failed)throw new ConnectorError('Credential rollback failed. Check Keychain access before reconnecting.');throw error;
  }
  for(const entry of staged)if(entry.old){try{await this.cleanup(entry.slot,JSON.parse(Buffer.from(entry.old,'base64url').toString()))}catch{/* Orphaned chunks contain no active credential manifest. */}}
 });this.queue=operation.catch(()=>{});return operation}
 async manifest(slot){const raw=await this.credentials.get(this.key(slot));if(!raw)return;try{return JSON.parse(Buffer.from(raw,'base64url').toString())}catch{return}}
 async cleanup(slot,m){if(m&&/^[a-f0-9-]{36}$/.test(m.g)&&Number.isInteger(m.n)&&m.n>0&&m.n<=32)for(let i=0;i<m.n;i++)await this.credentials.delete(`${this.key(slot)}-${m.g}-${i}`)}
 set(slot,value){const operation=this.queue.then(async()=>{const text=Buffer.from(boundedJSON(value,128*1024,'OAuth credentials')).toString('base64url');const old=await this.manifest(slot),m={g:randomUUID(),n:Math.ceil(text.length/7800)};try{for(let i=0;i<m.n;i++)await this.credentials.set(`${this.key(slot)}-${m.g}-${i}`,text.slice(i*7800,(i+1)*7800));await this.credentials.set(this.key(slot),Buffer.from(JSON.stringify(m)).toString('base64url'))}catch(error){await this.cleanup(slot,m).catch(()=>{});throw error}await this.cleanup(slot,old).catch(()=>{})});this.queue=operation.catch(()=>{});return operation}
 delete(slot){const operation=this.queue.then(async()=>{const old=await this.manifest(slot);await this.credentials.delete(this.key(slot));await this.cleanup(slot,old)});this.queue=operation.catch(()=>{});return operation}
}
module.exports={ConnectorError,safeError,validUrl,boundedJSON,createSafeFetch,SecretStore};
