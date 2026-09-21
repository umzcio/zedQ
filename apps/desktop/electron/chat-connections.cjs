'use strict';
const {randomUUID}=require('node:crypto');
const {text,modelId,modelList,modelLabel}=require('./chat-store.cjs');
const cloud=provider=>['openai','anthropic','google','xai','perplexity','openrouter','groq','bedrock'].includes(provider);
const publicConnection=c=>({id:c.id,name:c.name,provider:c.provider,baseUrl:c.baseUrl,hasApiKey:!!c.credentialRef,updatedAt:c.updatedAt??0,enabledModels:[...(c.enabledModels??[])],favoriteModels:[...(c.favoriteModels??[])],modelLabels:{...(c.modelLabels??{})}});

// Metadata is durable in ChatStore. Secrets are write-only to the renderer and
// resolved from Keychain immediately before native provider use.
class ChatConnections{
 constructor(host,{credentials,provider,providerFactory}={}){
  this.host=host;this.credentials=credentials;this.override=provider;
  this.factory=providerFactory??((kind,options)=>require('@zq/providers').createProvider(kind,options));
  this.busy=new Set();this.cleaning=null;
 }
 isCurrent(connection){const current=this.host.state.connections.find(c=>c.id===connection.id);return current&&current.provider===connection.provider&&current.baseUrl===connection.baseUrl&&current.credentialRef===connection.credentialRef&&(current.updatedAt??0)===(connection.updatedAt??0)}
 find(id){const c=this.host.state.connections.find(c=>c.id===id);if(!c)throw Error('Connection not found.');return c}
 assertAvailable(id){if(this.busy.has(id))throw Error('This connection is saving. Try again when it finishes.')}
 assertEditable(id){this.assertAvailable(id);if([...this.host.runs.keys()].some(key=>this.host.conversation(key).connectionId===id))throw Error('Stop responses using this connection before changing it.')}
 assertIdle(){if(this.busy.size||this.cleaning)throw Error('A connection is saving. Keep zQ open until it finishes, then try closing again.')}
 validate(input){
  if(!input||!text(input.name,256)||!input.name.trim())throw Error('Enter a connection name up to 256 bytes.');
  if(input.id!==undefined&&(!text(input.id,256)||!input.id))throw Error('Invalid connection.');
  if(input.apiKey!==undefined&&(!text(input.apiKey,8192)||/[\r\n]/.test(input.apiKey)))throw Error('Enter a valid API key.');
  if(input.removeApiKey!==undefined&&typeof input.removeApiKey!=='boolean')throw Error('Invalid key setting.');
  if(input.enabledModels!==undefined&&!modelList(input.enabledModels))throw Error('Choose up to 1000 unique model IDs, each up to 512 bytes.');
  const normalized=require('@zq/providers').normalizeConnection(input);
  const old=input.id?this.find(input.id):null;
  const apiKey=input.apiKey?.trim()||'';
  if(normalized.provider==='ollama'&&apiKey)throw Error('Ollama connections do not use an API key.');
  if(apiKey&&input.removeApiKey)throw Error('Choose either a replacement key or removal.');
  const same=old&&old.provider===normalized.provider&&old.baseUrl===normalized.baseUrl;
  if(old?.credentialRef&&!same&&!apiKey&&!input.removeApiKey)throw Error('Enter a new API key or remove the saved key before changing its provider or endpoint.');
  const credentialRef=!input.removeApiKey&&same?old.credentialRef:undefined;
  if(cloud(normalized.provider)&&!apiKey&&!credentialRef)throw Error('Enter an API key for this provider.');
  return{old,apiKey,connection:{id:old?.id??randomUUID(),name:input.name.trim(),...normalized,...(credentialRef?{credentialRef}:{}),updatedAt:Math.max(Date.now(),(old?.updatedAt??0)+1)}};
 }
 save(input){
  const {old,apiKey,connection}=this.validate(input);this.assertEditable(connection.id);
  const selected=input.enabledModels===undefined?undefined:[...input.enabledModels];
  const commit=()=>this.host.change(s=>{
   if(old&&!s.connections.some(c=>c.id===old.id))throw Error('Connection not found.');
   const index=s.connections.findIndex(c=>c.id===connection.id),current=s.connections[index];
   // Credential writes await Keychain. Merge preferences from the current state at commit.
   connection.modelLabels={...(current?.modelLabels??{})};
   connection.enabledModels=selected??current?.enabledModels??[];connection.favoriteModels=(current?.favoriteModels??[]).filter(m=>connection.enabledModels.includes(m));
   if(index<0)s.connections.push(connection);else s.connections[index]=connection;
   if(s.defaultModel?.connectionId===connection.id&&!connection.enabledModels.includes(s.defaultModel.model))s.defaultModel=null;
   if(old?.credentialRef&&old.credentialRef!==connection.credentialRef)s.pendingCredentialDeletes=[...new Set([...(s.pendingCredentialDeletes??[]),old.credentialRef])];
   if(connection.credentialRef)s.pendingCredentialDeletes=(s.pendingCredentialDeletes??[]).filter(id=>id!==connection.credentialRef);
   return publicConnection(connection);
  });
  // Preserve synchronous legacy Ollama saves. IPC awaits either return shape.
  if(!apiKey&&!old?.credentialRef)return commit();
  this.busy.add(connection.id);
  return(async()=>{
   try{
    if(apiKey){
     if(!this.credentials)throw Error('Secure credential storage is unavailable.');
     connection.credentialRef=randomUUID();
     // Journal before the key is written: a crash or failed metadata commit can
     // leave only a retired item, never a connection pointing to an unwritten key.
     this.host.change(s=>{s.pendingCredentialDeletes=[...(s.pendingCredentialDeletes??[]),connection.credentialRef];return null});
     await this.credentials.set(connection.credentialRef,apiKey);
    }
    return commit();
   }finally{this.busy.delete(connection.id);await this.cleanup()}
  })();
 }
 delete(id){
  const old=this.find(id);this.assertEditable(id);
  const result=this.host.change(s=>{
   s.connections=s.connections.filter(c=>c.id!==id);
   for(const chat of s.conversations)if(chat.connectionId===id)chat.connectionId=null;
   if(s.defaultModel?.connectionId===id)s.defaultModel=null;for(const p of s.projects??[])if(p.defaultModel?.connectionId===id){p.defaultModel=null;p.defaultTools=[]}
   if(old.credentialRef)s.pendingCredentialDeletes=[...new Set([...(s.pendingCredentialDeletes??[]),old.credentialRef])];
   return null;
  });
  return this.cleanup().then(()=>result);
 }
 saveModelPreferences(input){
  if(!input||typeof input!=='object'||Array.isArray(input)||!text(input.connectionId,256)||!input.connectionId)throw Error('Choose a saved connection.');
  for(const key of ['enabledModels','favoriteModels'])if(input[key]!==undefined&&!modelList(input[key]))throw Error('Choose up to 1000 unique model IDs, each up to 512 bytes.');
  if(input.defaultModel!==undefined&&input.defaultModel!==null&&!modelId(input.defaultModel))throw Error('Choose a valid default model.');
  if(input.modelLabel!==undefined){const edit=input.modelLabel;if(!edit||typeof edit!=='object'||Array.isArray(edit)||!modelId(edit.model)||(edit.label!==null&&!modelLabel(edit.label)))throw Error('Enter a model label up to 80 characters on one line.')}
  this.host.change(s=>{
   const c=s.connections.find(c=>c.id===input.connectionId);if(!c)throw Error('Connection not found.');
   if(input.modelLabel!==undefined){
    if(!['ollama','vllm'].includes(c.provider))throw Error('Custom model labels are available for Ollama and vLLM.');
    const {model,label}=input.modelLabel;const labels={...(c.modelLabels??{})};
    if(label===null)delete labels[model];else Object.defineProperty(labels,model,{value:label.trim(),enumerable:true,writable:true,configurable:true});
    if(Object.keys(labels).length>1000)throw Error('A connection can have up to 1000 custom model labels.');c.modelLabels=labels;
   }
   const enabled=input.enabledModels??c.enabledModels;
   const favorites=input.favoriteModels??c.favoriteModels.filter(m=>enabled.includes(m));
   if(!favorites.every(m=>enabled.includes(m)))throw Error('Favorite models must be enabled.');
   if(input.defaultModel!==undefined&&input.defaultModel!==null&&!enabled.includes(input.defaultModel))throw Error('The default model must be enabled.');
   c.enabledModels=[...enabled];c.favoriteModels=[...favorites];
   if(input.defaultModel!==undefined)s.defaultModel=input.defaultModel===null?null:{connectionId:c.id,model:input.defaultModel};
   else if(s.defaultModel?.connectionId===c.id&&!enabled.includes(s.defaultModel.model))s.defaultModel=null;
   return null;
  });
  return this.host.snapshot();
 }
 async cleanup(){
  if(this.cleaning)return this.cleaning;
  if(!this.credentials||this.busy.size||!this.host.state.pendingCredentialDeletes?.length)return;
  this.cleaning=(async()=>{
   for(const id of [...this.host.state.pendingCredentialDeletes]){
    if(this.host.state.connections.some(c=>c.credentialRef===id))continue;
    try{await this.credentials.delete(id,{interactive:false});this.host.change(s=>{s.pendingCredentialDeletes=s.pendingCredentialDeletes.filter(key=>key!==id);return null})}
    catch{/* Keychain may be locked. The durable journal retries next launch. */}
   }
  })();
  try{await this.cleaning}finally{this.cleaning=null}
 }
 async adapter(connection,inputKey){
  this.assertAvailable(connection.id);
  let apiKey=inputKey;
  if(!apiKey&&connection.credentialRef){
   if(!this.credentials)throw Error('Secure credential storage is unavailable.');
   apiKey=await this.credentials.get(connection.credentialRef);
   if(!apiKey)throw Error('The saved API key is missing. Edit this connection to enter it again.');
  }
  if(cloud(connection.provider)&&!apiKey)throw Error('Enter an API key for this provider.');
  return this.override??this.factory(connection.provider,{apiKey});
 }
 async models(id){const c=this.find(id);const adapter=await this.adapter(c);this.assertAvailable(id);if(!this.isCurrent(c))throw Error('The connection changed. Refresh models.');return adapter.listModels(c.baseUrl)}
 async test(input){
  if(typeof input==='string')input={name:'Ollama',provider:'ollama',baseUrl:input};
  const {connection,apiKey}=this.validate(input);const adapter=await this.adapter(connection,apiKey);
  return adapter.listModels(connection.baseUrl);
 }
}
module.exports={ChatConnections,publicConnection};
