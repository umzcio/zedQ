const fs=require('node:fs');
const path=require('node:path');
const {randomUUID}=require('node:crypto');
const {Client,StreamableHTTPClientTransport,UnauthorizedError}=require('@modelcontextprotocol/client');
const {inspectToolSchema,validateToolArguments}=require('./schema.cjs');
const {isBundledArxiv,isBundledGmail,isBundledGoogle,LEGACY_GOOGLE,getCatalogEntry}=require('./catalog.cjs');
const {NativeOAuthProvider}=require('./oauth.cjs');
const {ConnectorError,safeError,validUrl,boundedJSON,createSafeFetch,SecretStore}=require('./security.cjs');
const clone=value=>JSON.parse(JSON.stringify(value));
const busy=row=>['connecting','authenticating'].includes(row.status);
class ConnectorService {
 constructor({directory,credentials,openExternal,onChange=()=>{},allowLoopbackHttp=false,fetchImpl=fetch,connectTimeoutMs=300000,requestTimeoutMs=60000}){
  Object.assign(this,{directory,credentials,openExternal,onChange,allowLoopbackHttp,fetchImpl,connectTimeoutMs,requestTimeoutMs});this.sessions=new Map();this.rows=[];this.closed=false;this.restoreEpoch=0;this.locks=new Set();this.file=path.join(directory,'mcp-connectors.json');
  fs.mkdirSync(directory,{recursive:true,mode:0o700});
  if(fs.existsSync(this.file)){try{const fd=fs.openSync(this.file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);let content;try{const stat=fs.fstatSync(fd);if(!stat.isFile()||stat.size>4*1024*1024)throw Error();content=fs.readFileSync(fd)}finally{fs.closeSync(fd)}const saved=JSON.parse(content);if(saved.version!==1||!Array.isArray(saved.connectors)||saved.connectors.length>64)throw Error();this.rows=saved.connectors.map(row=>{const input=this.validateInput(row);if(!/^[a-f0-9-]{36}$/.test(row.id)||!Number.isSafeInteger(row.revision)||row.revision<1)throw Error();return {...input,id:row.id,revision:row.revision,status:'disconnected',autoConnect:row.autoConnect===true,hasToken:row.hasToken===true,hasClientSecret:row.hasClientSecret===true,tools:this.normalizeTools(row.tools,[],true)}});if(new Set(this.rows.map(r=>r.id)).size!==this.rows.length)throw Error()}catch{throw new ConnectorError('Saved connector settings could not be read. Restore the workspace backup.')}}
  this.committedRows=clone(this.rows);
 }
 list(){return clone(this.rows.map(row=>({...row,tools:row.tools.map(({outputSchema,...tool})=>tool)})))}
 assertOpen(){if(this.closed)throw new ConnectorError('Connector service is closed.')}
 get(id){this.assertOpen();const row=this.rows.find(r=>r.id===id);if(!row)throw new ConnectorError('Connector no longer exists.');return row}
 validateInput(input){if(!input||typeof input.name!=='string'||!input.name.trim()||input.name.length>100)throw new ConnectorError('Enter a connector name of 1–100 characters.');let url=validUrl(input.url,this.allowLoopbackHttp).href;if(LEGACY_GOOGLE[input.catalogId]&&url===LEGACY_GOOGLE[input.catalogId]&&(input.authType??'oauth')==='oauth')url=getCatalogEntry(input.catalogId).url;
  const authType=input.authType??'oauth';if(!['oauth','bearer'].includes(authType))throw new ConnectorError('Choose OAuth or bearer token authentication.');
  const result={name:input.name.trim(),url,authType};
  if(input.catalogId!==undefined){if(typeof input.catalogId!=='string'||!input.catalogId.trim()||input.catalogId.length>64||/[\x00-\x1f]/.test(input.catalogId))throw new ConnectorError('Invalid connector catalog ID.');result.catalogId=input.catalogId.trim()}
  if(input.redirectPort!==undefined){if(!Number.isInteger(input.redirectPort)||input.redirectPort<1||input.redirectPort>65535)throw new ConnectorError('Callback port must be between 1 and 65535.');result.redirectPort=input.redirectPort}
  if(input.redirectHost!==undefined){if(!['127.0.0.1','localhost'].includes(input.redirectHost))throw new ConnectorError('Callback host must be 127.0.0.1 or localhost.');result.redirectHost=input.redirectHost}
  for(const key of ['token','clientSecret'])if(input[key]!==undefined&&(typeof input[key]!=='string'||input[key].length>16384||/[\x00-\x20\x7f]/.test(input[key])))throw new ConnectorError('Credentials must be a single non-whitespace value of at most 16384 characters.');
  if(input.clientSecret&&(typeof input.clientId!=='string'||!input.clientId.trim()))throw new ConnectorError('Enter the registered OAuth client ID before its client secret.');
  if(input.token&&authType!=='bearer'||input.clientSecret&&authType!=='oauth')throw new ConnectorError('The supplied credential does not match the selected authentication mode.');
  for(const key of ['clientId','clientMetadataUrl'])if(input[key]){if(typeof input[key]!=='string'||input[key].length>2048||/[\x00-\x1f]/.test(input[key]))throw new ConnectorError('Invalid OAuth client settings.');result[key]=input[key].trim()}
  if(result.clientMetadataUrl){const metadata=validUrl(result.clientMetadataUrl);if(metadata.pathname==='/')throw new ConnectorError('Client metadata URL must have a document path.');result.clientMetadataUrl=metadata.href}return result;
 }
 persist(){const bytes=boundedJSON({version:1,connectors:this.rows.map(({status,error,needsSignIn,...row})=>row)},4*1024*1024,'Connector settings');const temp=`${this.file}.${randomUUID()}.tmp`;let fd;try{fd=fs.openSync(temp,'wx',0o600);fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);fs.closeSync(fd);fd=undefined;fs.renameSync(temp,this.file);this.committedRows=clone(this.rows)}finally{if(fd!==undefined)fs.closeSync(fd);if(fs.existsSync(temp))fs.unlinkSync(temp)}}
 emit(){try{this.onChange(this.list())}catch{/* Renderer listeners cannot interrupt durable mutations. */}}
 commit(){try{this.persist()}catch{this.rows=clone(this.committedRows).map(row=>({...row,status:this.sessions.has(row.id)&&row.status==='connected'?'connected':'disconnected'}));this.emit();throw new ConnectorError('Connector settings could not be saved. Check workspace disk access and try again.')}this.emit()}
 async save(input){this.assertOpen();const valid=this.validateInput(input);const existing=input.id?this.get(input.id):undefined;
  if(existing&&(busy(existing)||this.locks.has(existing.id)))throw new ConnectorError('Connector is busy. Disconnect before editing.');
  if(!existing&&this.rows.length>=64)throw new ConnectorError('A workspace supports up to 64 connectors.');
  const row=existing??{id:randomUUID(),status:'disconnected',revision:1,tools:[]};this.locks.add(row.id);
  try{
   const registrationChanged=!!existing&&['url','authType','catalogId','clientId','clientMetadataUrl','redirectPort','redirectHost'].some(key=>row[key]!==valid[key]);
   const endpointChanged=!!existing&&['url','authType'].some(key=>row[key]!==valid[key]);const secretBindingChanged=endpointChanged||!!existing&&row.clientId!==valid.clientId;
   const credentialsChanged=input.token!==undefined||input.clientSecret!==undefined;const changed=registrationChanged||credentialsChanged;
   if(existing&&changed)await this.disconnect(row.id);
   const secrets=new SecretStore(this.credentials,row.id),changes={};
   if(registrationChanged){changes.tokens=undefined;changes.client=undefined}
   if(endpointChanged)changes.token=undefined;if(secretBindingChanged)changes.clientSecret=undefined
   if(credentialsChanged){changes.tokens=undefined;changes.client=undefined}
   if(input.token!==undefined)changes.token=input.token?{value:input.token,url:valid.url}:undefined;
   if(input.clientSecret!==undefined)changes.clientSecret=input.clientSecret?{value:input.clientSecret,url:valid.url,clientId:valid.clientId}:undefined;
   const next={...valid,id:row.id,status:row.status,autoConnect:changed?false:row.autoConnect===true,revision:row.revision+(existing&&changed?1:0),tools:changed?[]:row.tools,hasToken:endpointChanged?false:row.hasToken===true,hasClientSecret:secretBindingChanged?false:row.hasClientSecret===true};
   if(input.token!==undefined)next.hasToken=!!input.token;if(input.clientSecret!==undefined)next.hasClientSecret=!!input.clientSecret;
   await secrets.transaction(changes,()=>{if(existing)Object.assign(row,next);else this.rows.push(next);for(const key of ['clientId','clientMetadataUrl','catalogId','redirectPort','redirectHost','error','needsSignIn'])if(!(key in next))delete row[key];this.commit()});
   return clone(this.get(row.id));
  }catch(error){throw safeError(error)}finally{this.locks.delete(row.id)}
 }
 normalizeTools(tools,previous=[],restore=false){if(!Array.isArray(tools)||tools.length>256)throw new ConnectorError('Connector exposes more than 256 tools.');boundedJSON(tools,1024*1024,'Tool schemas');const names=new Set();return tools.map(tool=>{
   if(!tool||typeof tool.name!=='string'||tool.name.length<1||tool.name.length>128||/[\x00-\x1f]/.test(tool.name)||names.has(tool.name))throw new ConnectorError('Connector returned an invalid or duplicate tool name.');names.add(tool.name);
   if(!tool.inputSchema||tool.inputSchema.type!=='object')throw new ConnectorError('Connector tool requires an object input schema.');boundedJSON(tool.inputSchema,64*1024,'Tool input schema');
   inspectToolSchema(tool.inputSchema);if(tool.outputSchema)inspectToolSchema(tool.outputSchema);
   const result={name:tool.name,...(typeof tool.title==='string'?{title:tool.title.slice(0,200)}:{}),description:typeof tool.description==='string'?tool.description.slice(0,16000):'',inputSchema:clone(tool.inputSchema),...(tool.outputSchema?{outputSchema:clone(tool.outputSchema)}:{}),enabled:false,readOnly:restore?tool.readOnly===true:tool.annotations?.readOnlyHint===true};
   const before=previous.find(t=>t.name===tool.name);result.enabled=restore?tool.enabled===true:!!before?.enabled&&JSON.stringify({...before,enabled:false})===JSON.stringify(result);return result;
  });
 }
 async connect(id,{interactive=true}={}){const row=this.get(id);if(this.locks.has(id)||busy(row))throw new ConnectorError('Connector is busy.');if(row.status==='connected')return clone(row);
  const previous=this.sessions.get(id);const controller=new AbortController(),session={controller};this.sessions.set(id,session);row.status='connecting';delete row.error;delete row.needsSignIn;this.emit();
  let timedOut=false;const timer=setTimeout(()=>{timedOut=true;controller.abort()},interactive?this.connectTimeoutMs:Math.min(this.connectTimeoutMs,30000));
  try{
   if(previous)await this.cleanup(previous);
   if(row.catalogId==='arxiv'){
    if(!isBundledArxiv(row))throw new ConnectorError('The bundled arXiv connector requires its original API endpoint. Add a custom connector for a different server.');
    const bundled=await require('./arxiv.cjs').createArxivSession({signal:controller.signal,fetchImpl:this.fetchImpl});Object.assign(session,{client:bundled.client,bundledClose:bundled.close,prepareSend:bundled.prepareSend});
    const listed=await bundled.client.listTools(undefined,{signal:controller.signal,timeout:this.requestTimeoutMs});controller.signal.throwIfAborted();
    const tools=this.normalizeTools(listed.tools,row.tools);if(JSON.stringify(row.tools)!==JSON.stringify(tools))row.revision++;row.tools=tools;row.status='connected';row.autoConnect=true;delete row.error;delete row.needsSignIn;this.commit();return clone(row);
   }
   if(LEGACY_GOOGLE[row.catalogId]){
    const legacy=LEGACY_GOOGLE[row.catalogId],api=getCatalogEntry(row.catalogId).url;
    if(!isBundledGoogle(row))throw new ConnectorError('The bundled Google connector requires its original Google API endpoint.');
    const secrets=new SecretStore(this.credentials,id),secret=await secrets.get('clientSecret'),tokens=await secrets.get('tokens'),changes={};
    // One-way migration only for the exact trusted Google preset and registered client.
    if(secret?.url===legacy&&secret.clientId===row.clientId&&(!secret.issuer||secret.issuer==='https://accounts.google.com')&&(!secret.tokenEndpoint||secret.tokenEndpoint==='https://oauth2.googleapis.com/token'))changes.clientSecret={...secret,url:api};
    if(tokens?.resourceUrl===legacy)changes.tokens=changes.clientSecret&&tokens.issuer==='https://accounts.google.com'?{...tokens,resourceUrl:api}:undefined;
    if(Object.keys(changes).length)await secrets.transaction(changes,()=>{controller.signal.throwIfAborted();this.commit()});
   }
   const localHttp=this.allowLoopbackHttp&&new URL(row.url).protocol==='http:';
   const provider=new NativeOAuthProvider({row,interactive,secrets:new SecretStore(this.credentials,id),signal:controller.signal,openExternal:this.openExternal,onAuthenticating:()=>{if(this.sessions.get(id)===session){row.status='authenticating';this.emit()}},allowLoopbackHttp:localHttp});session.provider=provider;await provider.start();
   const safeFetch=createSafeFetch({signal:controller.signal,allowLoopbackHttp:localHttp,fetchImpl:this.fetchImpl,timeoutMs:this.requestTimeoutMs,credentialOrigin:new URL(row.url).origin,tokenEndpoint:()=>provider.discovery?.authorizationServerMetadata?.token_endpoint});
   await provider.prepare(safeFetch);
   await require('./google-auth.cjs').prepareGoogleAuthorization({row,provider,fetchImpl:safeFetch,signal:controller.signal});
   if(isBundledGoogle(row)){
    const {googleAccessToken}=require('./google-auth.cjs');
    const create=row.catalogId==='gmail'?require('./gmail.cjs').createGmailSession:require('./google-workspace.cjs').createWorkspaceSession;
    const bundled=await create({catalogId:row.catalogId,signal:controller.signal,fetchImpl:this.fetchImpl,getToken:force=>googleAccessToken(provider,this.fetchImpl,force),calendarWriteAccess:()=>String(provider.savedTokens?.scope??'').split(/\s+/).includes('https://www.googleapis.com/auth/calendar.events')});Object.assign(session,{client:bundled.client,bundledClose:bundled.close,prepareSend:bundled.prepareSend,prepareCalendarAction:bundled.prepareCalendarAction});
    await bundled.verifyAccess();const listed=await bundled.client.listTools(undefined,{signal:controller.signal,timeout:this.requestTimeoutMs});controller.signal.throwIfAborted();
    const tools=this.normalizeTools(listed.tools,row.tools);if(JSON.stringify(row.tools)!==JSON.stringify(tools))row.revision++;row.tools=tools;row.status='connected';row.autoConnect=true;delete row.error;delete row.needsSignIn;this.commit();return clone(row);
   }
   const createClient=()=>new Client({name:'zQ',version:'1.0.0'},{jsonSchemaValidator:{getValidator(){throw new ConnectorError('Connector schema validation requires its bounded worker.')}},listMaxPages:16,listChanged:{tools:{autoRefresh:false,debounceMs:0,onChanged:()=>{if(this.sessions.get(id)!==session||row.status!=='connected')return;row.revision++;row.tools.forEach(t=>t.enabled=false);void this.disconnect(id,{preserveIntent:true}).then(()=>this.commit()).catch(()=>{})}}}});
   // OAuth redirects unwind connect; finishAuth and reconnect use fresh SDK state.
   let client=createClient(),transport=new StreamableHTTPClientTransport(new URL(row.url),{authProvider:provider.transportAuth(),fetch:safeFetch,onInsufficientScope:'throw'});Object.assign(session,{client,transport});
   try{await client.connect(transport,{signal:controller.signal,timeout:this.requestTimeoutMs})}catch(error){if(!provider.redirected)throw error;const params=await provider.callback;controller.signal.throwIfAborted();await provider.finish(params,safeFetch);await client.close();client=createClient();transport=new StreamableHTTPClientTransport(new URL(row.url),{authProvider:provider.transportAuth(),fetch:safeFetch,onInsufficientScope:'throw'});Object.assign(session,{client,transport});await client.connect(transport,{signal:controller.signal,timeout:this.requestTimeoutMs})}
   provider.interactive=false;provider.stopListener();const listed=await client.listTools(undefined,{signal:controller.signal,timeout:this.requestTimeoutMs});controller.signal.throwIfAborted();
   const tools=this.normalizeTools(listed.tools,row.tools);
   if(JSON.stringify(row.tools)!==JSON.stringify(tools))row.revision++;row.tools=tools;row.status='connected';row.autoConnect=true;delete row.error;delete row.needsSignIn;this.commit();return clone(row);
  }catch(error){const cancelled=controller.signal.aborted&&!timedOut;const safe=timedOut?new ConnectorError('Connector connection timed out. Check your connection and try again.'):cancelled?new ConnectorError('Connector connection cancelled.'):safeError(error);await this.cleanup(session);if(this.sessions.get(id)===session){this.sessions.delete(id);row.status=cancelled?'disconnected':'error';if(row.status==='error'){row.error=safe.message;if(error.needsSignIn||session.provider?.needsSignIn)row.needsSignIn=true;}this.emit()}throw safe}finally{clearTimeout(timer)}
 }
 async cleanup(session){if(session.cleanup)return session.cleanup;session.cleanup=(async()=>{const sessionId=session.transport?.sessionId;session.controller.abort();session.provider?.close();await session.bundledClose?.();await session.provider?.secrets.queue;await session.client?.close().catch(()=>{});await session.transport?.close().catch(()=>{});
  if(sessionId&&session.provider){const row=session.provider.row;const cleanupTransport=new StreamableHTTPClientTransport(new URL(row.url),{sessionId,authProvider:{token:async()=>session.provider.savedTokens?.access_token},fetch:createSafeFetch({allowLoopbackHttp:this.allowLoopbackHttp&&new URL(row.url).protocol==='http:',fetchImpl:this.fetchImpl,timeoutMs:1500,maxBytes:16384,credentialOrigin:new URL(row.url).origin})});await cleanupTransport.terminateSession().catch(()=>{});await cleanupTransport.close().catch(()=>{})}
 })();return session.cleanup}
 async disconnect(id,{preserveIntent=false}={}){const row=this.get(id);if(!preserveIntent){row.autoConnect=false;this.commit()}const session=this.sessions.get(id);this.sessions.delete(id);row.status='disconnected';delete row.error;delete row.needsSignIn;this.emit();if(session)await this.cleanup(session);return clone(row)}
 // Closing a window is not a user request to disable its connectors.
 async suspend(){this.restoreEpoch++;this.restoreFlight=undefined;await Promise.all(this.rows.map(row=>this.disconnect(row.id,{preserveIntent:true})))}
 restoreConnections(){
  this.assertOpen();if(this.restoreFlight)return this.restoreFlight;
  const epoch=this.restoreEpoch,ids=this.rows.filter(row=>row.autoConnect).map(row=>row.id);
  const worker=async()=>{while(ids.length&&!this.closed&&epoch===this.restoreEpoch){const id=ids.shift(),row=this.rows.find(row=>row.id===id);if(!row?.autoConnect||row.status!=='disconnected'||this.locks.has(id))continue;try{await this.connect(id,{interactive:false})}catch{/* Each row exposes its own retry/sign-in state. */}}};
  const flight=Promise.all([worker(),worker()]).finally(()=>{if(this.restoreFlight===flight)this.restoreFlight=undefined});this.restoreFlight=flight;return flight;
 }
 async remove(id){const row=this.get(id);if(this.locks.has(id))throw new ConnectorError('Connector is busy.');this.locks.add(id);try{await this.disconnect(id);const secrets=new SecretStore(this.credentials,id);await secrets.transaction({tokens:undefined,client:undefined,token:undefined,clientSecret:undefined},()=>{this.rows=this.rows.filter(r=>r!==row);this.commit()})}finally{this.locks.delete(id)}}
 async setTools({id,names}){const row=this.get(id);if(busy(row)||this.locks.has(id))throw new ConnectorError('Connector is busy.');if(!Array.isArray(names)||names.length>256||names.some(name=>!row.tools.some(t=>t.name===name)))throw new ConnectorError('Unknown connector tool.');const chosen=new Set(names);let changed=false;for(const tool of row.tools){const enabled=chosen.has(tool.name);if(tool.enabled!==enabled){tool.enabled=enabled;changed=true}}if(changed){row.revision++;this.commit()}return clone(row)}
 async prepareGmailSend(id,draftId,{signal,expectedRevision}={}){const row=this.get(id),session=this.sessions.get(id);if(!isBundledGmail(row)||row.status!=='connected'||!session?.prepareSend||row.revision!==expectedRevision||!row.tools.some(t=>t.name==='send_draft'&&t.enabled))throw new ConnectorError('Gmail sending is not enabled or its tools changed.');const prepared=await session.prepareSend(draftId,signal);if(this.sessions.get(id)!==session||row.revision!==expectedRevision)throw new ConnectorError('Gmail tools changed during draft review.');return prepared;}
 async prepareCalendarAction(id,action,args,{signal,expectedRevision}={}){
  const row=this.get(id),session=this.sessions.get(id);
  if(row.catalogId!=='google-calendar'||!isBundledGoogle(row)||row.status!=='connected'||!session?.prepareCalendarAction||row.revision!==expectedRevision||!row.tools.some(t=>t.name===action&&t.enabled))throw new ConnectorError('Calendar changes are not enabled or its tools changed.');
  const prepared=await session.prepareCalendarAction(action,args,signal);
  if(this.sessions.get(id)!==session||row.revision!==expectedRevision)throw new ConnectorError('Calendar tools changed during review.');return prepared;
 }
 async callTool(id,name,args,{signal,expectedRevision}={}){const row=this.get(id),session=this.sessions.get(id);if(row.status!=='connected'||!session)throw new ConnectorError('Connector is disconnected. Reconnect before using its tools.');if(expectedRevision!==row.revision)throw new ConnectorError('Connector tools changed. Review the current tools and try again.');const tool=row.tools.find(t=>t.name===name);if(!tool?.enabled)throw new ConnectorError('Connector tool is not enabled.');boundedJSON(args,128*1024,'Tool arguments');if(!await validateToolArguments(tool.inputSchema,args,{signal:AbortSignal.any([session.controller.signal,signal].filter(Boolean))}))throw new ConnectorError('Tool arguments do not match the connector schema.');if(this.sessions.get(id)!==session||row.revision!==expectedRevision||!tool.enabled)throw new ConnectorError('Connector tools changed. Review the current tools and try again.');
  try{const combined=AbortSignal.any([session.controller.signal,signal].filter(Boolean));combined.throwIfAborted();const result=await session.client.callTool({name,arguments:args},{signal:combined,timeout:this.requestTimeoutMs,toolDefinition:{name:tool.name,inputSchema:tool.inputSchema}});if(this.sessions.get(id)!==session||row.revision!==expectedRevision)throw new ConnectorError('Connector changed during the tool request.');boundedJSON(result,2*1024*1024,'Tool result');if(tool.outputSchema&&!result.isError){if(result.structuredContent===undefined||!await validateToolArguments(tool.outputSchema,result.structuredContent,{signal:combined}))throw new ConnectorError('Connector tool output does not match its declared schema.')}if(this.sessions.get(id)!==session||row.revision!==expectedRevision)throw new ConnectorError('Connector changed during the tool request.');return result}catch(error){const safe=session.controller.signal.aborted||signal?.aborted?new ConnectorError('Connector request cancelled or disconnected.'):safeError(error);if(error.needsSignIn||session.provider?.needsSignIn||error instanceof UnauthorizedError||/expired|authorization/.test(safe.message)){if(this.sessions.get(id)===session){await this.disconnect(id,{preserveIntent:true});row.status='error';row.error=safe.message;if(error.needsSignIn||session.provider?.needsSignIn)row.needsSignIn=true;this.emit()}}throw safe}
 }
 async close(){if(this.closed)return;this.closed=true;this.restoreEpoch++;const sessions=[...this.sessions.values()];this.sessions.clear();await Promise.all(sessions.map(s=>this.cleanup(s)))}
}
module.exports={ConnectorService};
