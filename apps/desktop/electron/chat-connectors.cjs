'use strict';
const {createHash,randomUUID}=require('node:crypto');
const {inspectToolSchema,validateToolArguments}=require('./mcp/schema.cjs');
const {recordActivity,recordSources,recordArtifact,externalURL}=require('./chat-tools.cjs');
const {isBundledGmail}=require('./mcp/catalog.cjs');
const MAX_SELECTED=10;
function validConnectorIds(value,{nullable=false}={}){return value===undefined||nullable&&value===null||Array.isArray(value)&&value.length<=MAX_SELECTED&&new Set(value).size===value.length&&value.every(id=>typeof id==='string'&&/^[a-zA-Z0-9_-]{1,128}$/.test(id))}
function selectedConnectors(service,value,project){
 if(!validConnectorIds(value,{nullable:true}))throw Error('Choose up to ten unique connectors.');
 const ids=value??project?.connectorIds??[];
 if(!validConnectorIds(ids))throw Error('Invalid project connectors.');
 if(ids.length&&!service)throw Error('Connectors are unavailable.');
 const available=service?.list()??[];
 for(const id of ids)if(!available.some(row=>row.id===id))throw Error('A selected connector was removed. Update the connectors for this chat.');
 return [...ids];
}
function digest(value){return createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0,32)}
function connectorTools(service,ids){
 const entries=[];const rows=service?.list()??[];
 for(const id of ids){
  const row=rows.find(r=>r.id===id);if(!row)throw Error('A selected connector was removed. Update this chat’s connectors.');
  if(row.status!=='connected')throw Error(`Connect ${row.name} in Settings → Connectors before using it.`);
  const enabledTools=row.tools.filter(t=>t.enabled);
  if(!enabledTools.length)throw Error(`${row.name} has no tools enabled. Open Settings → Connectors → Manage tools and enable the tools you want to use.`);
  for(const tool of enabledTools){
   const schema=tool.inputSchema;
   if(!schema||typeof schema!=='object'||schema.type!=='object'||Buffer.byteLength(JSON.stringify(schema))>24000)throw Error(`The ${tool.name} tool has an unsupported input schema.`);
   try{inspectToolSchema(schema)}catch{throw Error(`The ${tool.name} tool uses an unsupported input schema.`)}
   const name='mcp_'+digest([row.id,tool.name]);
   entries.push({name,row:structuredClone(row),tool:structuredClone(tool),definition:{name,description:`${row.name}: ${tool.title||tool.name}. ${tool.description}`.slice(0,8000),parameters:structuredClone(schema)}});
  }
 }
 if(entries.length>48||Buffer.byteLength(JSON.stringify(entries.map(e=>e.definition)))>80000)throw Error('Too many connector tools are enabled. Choose fewer tools in Settings → Connectors.');
 return entries;
}
function createConnectorExecutor({service,entries,interactions,conversationId,run,check,update}){
 const byName=new Map(entries.map(e=>[e.name,e]));const uncertain=new Set();
 return {definitions:entries.map(e=>e.definition),has:name=>byName.has(name),async execute(call){
  check();const entry=byName.get(call.name);if(!entry)throw Error('Unknown connector tool.');
  const {row,tool}=entry;
  const current=()=>{check();const active=service.list().find(r=>r.id===row.id);const enabled=active?.tools.find(t=>t.name===tool.name&&t.enabled);if(!active||active.status!=='connected'||active.revision!==row.revision||!enabled||digest(enabled.inputSchema)!==digest(tool.inputSchema))throw Error('The connector or its tools changed. Send a new request.');};
  current();
  if(uncertain.has(call.name))return {isError:true,error:'The previous action result could not be confirmed or displayed. Do not repeat this tool in this request.'};
  if(!await validateToolArguments(tool.inputSchema,call.arguments,{signal:run.controller.signal}))return {isError:true,error:'The connector tool arguments do not match its input schema.'};
  if(run.actionsDenied)return {isError:true,error:'The user denied tool actions for this request. Do not retry.'};
  // MCP annotations are untrusted hints. Require a real grant for external tools,
  // bound to this connector revision; subsequent calls reuse the chat grant.
  const grant='mcp:'+digest([row.id,row.revision,tool.name,tool.inputSchema]);
  const sending=isBundledGmail(row)&&tool.name==='send_draft';
  let prepared;try{if(sending)prepared=await service.prepareGmailSend(row.id,call.arguments.draftId,{signal:run.controller.signal,expectedRevision:row.revision})}catch(error){return {isError:true,error:error.message}}
  current();
  const detail=prepared?.detail??`${row.name} · ${tool.title||tool.name}\n${JSON.stringify(call.arguments).slice(0,1600)}`;
  if(!await interactions.approve(conversationId,run,grant,detail,{required:true,onceOnly:sending,question:sending?'Send this email?':`Allow ${row.name} to run ${tool.title||tool.name}?`}))return {isError:true,error:'The user denied this connector action. Do not retry it.'};
  current();const id=randomUUID(),label=`${row.name} · ${tool.title||tool.name}`;
  update(reply=>recordActivity(reply,{id,kind:'mcp',status:'running',detail:label},['mcp']));
  let received=false;
  try{
   const result=await service.callTool(row.id,tool.name,prepared?.arguments??call.arguments,{signal:run.controller.signal,expectedRevision:row.revision});
   received=true;current();
   const clean=structuredClone(result);if(sending&&clean.isError)uncertain.add(call.name);const sources=[],files=[];
   for(const content of clean.content??[]){
    if(content.type==='resource_link'&&typeof content.uri==='string'){try{sources.push({id:'mcp-'+digest(content.uri),url:externalURL(content.uri),title:String(content.title||content.name||content.uri).slice(0,1024)})}catch{}}
    if(content.type==='resource'&&content.resource?.blob&&typeof content.resource.blob==='string'){
     const resource=content.resource;let name='Connector file';try{name=decodeURIComponent(new URL(resource.uri).pathname.split('/').at(-1))||name}catch{}
     files.push({name,mime:resource.mimeType||'application/octet-stream',data:resource.blob});
     content.resource={uri:resource.uri,mimeType:resource.mimeType,text:'File attached to this response: '+name};
    }
   }
   // Provider tool results are bounded too; never feed base64 files into its context.
   if(Buffer.byteLength(JSON.stringify(clean))>100000)throw Error('The connector response is too large. Ask for a smaller result.');
   update(reply=>{recordActivity(reply,{id,kind:'mcp',status:clean.isError?'error':'complete',detail:label},['mcp']);if(sources.length){const unique=new Map([...(reply.sources??[]),...sources].map(s=>[s.url,s]));recordSources(reply,[...unique.values()].slice(0,100))}for(const file of files)recordArtifact(reply,file,['mcp'])});
   return clean;
  }catch(error){
   check();update(reply=>recordActivity(reply,{id,kind:'mcp',status:'error',detail:label},['mcp']));
   uncertain.add(call.name);
   return {isError:true,error:received?'The connector returned a result, but zQ could not display it. The action may already be complete. Do not repeat the action.':'zQ could not confirm the connector’s result. The action may have completed. Do not retry it automatically; check the connected service.'};
  }
 }};
}
module.exports={validConnectorIds,selectedConnectors,connectorTools,createConnectorExecutor};
