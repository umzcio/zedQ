const {validConnectorIds}=require('./chat-connectors.cjs');
const {validCatalog,validUsage}=require('./skill-activation.cjs');
'use strict';
const fs=require('node:fs'),path=require('node:path');
const {randomUUID}=require('node:crypto');
const appearance=require('./project-appearance.json');
const {validSkills,validSkillIds}=require('./skill-schema.cjs');
const {isAttachment}=require('./attachment-schema.cjs');
const {validToolMessage}=require('./chat-tools.cjs');
const {validQueue}=require('./chat-queue-schema.cjs');
const {validInteractions}=require('./chat-interactions.cjs');
const MAX=32*1024*1024;
const text=(v,max=4096)=>typeof v==='string'&&Buffer.byteLength(v)<=max&&!v.includes('\0')&&Buffer.from(v).toString('utf8')===v;
const id=v=>text(v,256)&&v.length>0;
const modelId=v=>text(v,512)&&v.trim().length>0;
const modelList=v=>Array.isArray(v)&&v.length<=1000&&v.every(modelId)&&new Set(v).size===v.length;
const modelLabel=v=>text(v,320)&&v.trim().length>0&&Array.from(v).length<=80&&!/[\r\n\t]/.test(v);
const obj=v=>v&&typeof v==='object'&&!Array.isArray(v);
const optionalFlag=v=>v===undefined||typeof v==='boolean';
const optionalStamp=v=>v===undefined||v===null||Number.isFinite(v)&&v>=0;
const toolList=v=>v===undefined||Array.isArray(v)&&v.length<=3&&new Set(v).size===v.length&&v.every(k=>['web_search','x_search','code_execution'].includes(k));
const choice=v=>v===undefined||v===null||obj(v)&&id(v.connectionId)&&modelId(v.model);
const stamp=v=>Number.isFinite(v)&&v>=0;
function valid(state){
 if(!obj(state)||!Array.isArray(state.connections)||state.connections.length>50||!Array.isArray(state.conversations)||state.conversations.length>2000)return false;
 const unique=items=>new Set(items.map(i=>i.id)).size===items.length;
 if(!unique(state.connections)||!unique(state.conversations))return false;
 if(state.skills!==undefined&&!validSkills(state.skills))return false;
 const projects=state.projects??[];
 if(!Array.isArray(projects)||projects.length>100||!unique(projects))return false;
 const projectContext=p=>obj(p)&&id(p.id)&&text(p.name,256)&&p.name.trim()&&text(p.instructions,16000)&&Array.isArray(p.files)&&p.files.length<=10&&p.files.every(isAttachment)&&(p.icon===undefined||appearance.icons.includes(p.icon))&&(p.color===undefined||appearance.colors.some(c=>c.id===p.color));
 if(!projects.every(p=>projectContext(p)&&validConnectorIds(p.connectorIds)&&validSkillIds(p.skillIds)&&optionalFlag(p.pinned)&&choice(p.defaultModel)&&toolList(p.defaultTools)))return false;
 if(state.pendingCredentialDeletes!==undefined&&(!Array.isArray(state.pendingCredentialDeletes)||state.pendingCredentialDeletes.length>200||!state.pendingCredentialDeletes.every(id)||new Set(state.pendingCredentialDeletes).size!==state.pendingCredentialDeletes.length))return false;
 for(const c of state.connections){if(!obj(c)||!id(c.id)||!text(c.name,256)||!c.name.trim()||!['ollama','vllm','openai','anthropic','google','xai','perplexity','openrouter','groq','bedrock'].includes(c.provider)||!text(c.baseUrl,2048))return false;if(Object.keys(c).some(k=>!['id','name','provider','baseUrl','credentialRef','updatedAt','enabledModels','favoriteModels','modelLabels'].includes(k))||(c.credentialRef!==undefined&&!id(c.credentialRef))||(c.updatedAt!==undefined&&!stamp(c.updatedAt)))return false;try{const normalized=require('@zq/providers').normalizeConnection(c);if(!['ollama','vllm'].includes(c.provider)&&normalized.baseUrl!==c.baseUrl||normalized.provider!==c.provider)return false;const u=new URL(c.baseUrl);if(!['http:','https:'].includes(u.protocol)||u.username||u.password||u.search||u.hash)return false}catch{return false}}
 for(const c of state.connections){
  if(c.modelLabels!==undefined&&(!obj(c.modelLabels)||Object.keys(c.modelLabels).length>1000||!Object.entries(c.modelLabels).every(([key,value])=>modelId(key)&&modelLabel(value))))return false;
  if(c.enabledModels!==undefined&&!modelList(c.enabledModels))return false;
  if(c.favoriteModels!==undefined&&(!modelList(c.favoriteModels)||!c.favoriteModels.every(m=>c.enabledModels?.includes(m))))return false;
 }
 if(state.defaultModel!==undefined&&state.defaultModel!==null){const d=state.defaultModel;if(!obj(d)||Object.keys(d).some(k=>!['connectionId','model'].includes(k))||!id(d.connectionId)||!modelId(d.model)||!state.connections.some(c=>c.id===d.connectionId&&c.enabledModels?.includes(d.model)))return false}
 for(const c of state.conversations){
  if(!obj(c)||!id(c.id)||!text(c.title)||!(c.connectionId===null||state.connections.some(x=>x.id===c.connectionId))||!text(c.model,512)||!stamp(c.createdAt)||!stamp(c.updatedAt)||!Array.isArray(c.messages)||c.messages.length>1000||!unique(c.messages))return false;
  if(c.projectId!=null&&!projects.some(p=>p.id===c.projectId))return false;
  if(!validConnectorIds(c.connectorIds,{nullable:true})||!validSkillIds(c.skillIds,{nullable:true})||!optionalFlag(c.pinned)||!optionalStamp(c.archivedAt)||!optionalStamp(c.deletedAt))return false;
  if(!validQueue(c.queue))return false;
  if(c.approvalMode!==undefined&&!['auto','ask'].includes(c.approvalMode))return false;
  if(c.branches!==undefined&&(!Array.isArray(c.branches)||c.branches.length>200||!unique(c.branches)||!c.branches.every(b=>obj(b)&&id(b.id)&&id(b.anchorId)&&Array.isArray(b.messages)&&b.messages.length>0&&b.messages.length<=1000&&unique(b.messages)&&b.messages[0].id===b.anchorId&&(b.messages[0].versionId??b.messages[0].id)===b.id)))return false;
  if(c.titleEdited!==undefined&&typeof c.titleEdited!=='boolean')return false;
  const messages=[...c.messages,...(c.branches??[]).flatMap(b=>b.messages)];if(messages.length>10000)return false;
  for(const m of messages){
   if(!obj(m)||!id(m.id)||!['user','assistant'].includes(m.role)||!text(m.content,2*1024*1024)||!text(m.thinking,2*1024*1024)||!['complete','streaming','stopped','error','interrupted'].includes(m.status)||!stamp(m.createdAt)||!text(m.error)||!Array.isArray(m.context)||m.context.length>10)return false;
   if(m.versionId!==undefined&&!id(m.versionId)||m.model!==undefined&&!text(m.model,512)||m.connectionId!==undefined&&!id(m.connectionId)||m.connectionName!==undefined&&!text(m.connectionName,256)||!optionalStamp(m.finishedAt))return false;
   if(m.reportedModel!==undefined&&!text(m.reportedModel,512)||m.usage!==undefined&&(!obj(m.usage)||!Object.entries(m.usage).every(([k,v])=>['inputTokens','outputTokens','cachedInputTokens','reasoningTokens'].includes(k)&&Number.isSafeInteger(v)&&v>=0)))return false;
   if(!validConnectorIds(m.connectorIds)||!validCatalog(m.skillCatalog)||!validUsage(m.skillUsage)||!validToolMessage(m)||!validInteractions(m.interactions)||m.skillContext!==undefined&&!validSkills(m.skillContext,{max:10}))return false;
   if(m.artifactContext!==undefined&&(!obj(m.artifactContext)||Object.keys(m.artifactContext).some(k=>!['artifactId','versionId'].includes(k))||![m.artifactContext.artifactId,m.artifactContext.versionId].every(v=>typeof v==='string'&&/^[a-f0-9-]{36}$/.test(v))))return false;
   if(m.projectContext!==undefined&&!projectContext(m.projectContext))return false;
   if(m.attachments!==undefined&&(!Array.isArray(m.attachments)||m.attachments.length>10||!m.attachments.every(isAttachment)))return false;
   if(!m.context.every(n=>obj(n)&&id(n.id)&&text(n.title)&&text(n.body,100000)))return false;
  }
 }
 if(state.drafts!==undefined&&(!obj(state.drafts)||Object.keys(state.drafts).length>2100||!Object.entries(state.drafts).every(([key,d])=>id(key)&&obj(d)&&require('./research/schema.cjs').validDraft(d.research)&&validConnectorIds(d.connectorIds,{nullable:true})&&validSkillIds(d.skillIds,{nullable:true})&&text(d.text,64000)&&Array.isArray(d.noteIds)&&d.noteIds.length<=10&&d.noteIds.every(id)&&toolList(d.tools)&&Array.isArray(d.attachments)&&d.attachments.length+d.noteIds.length<=10&&d.attachments.every(isAttachment))))return false;
 if(state.chatView!==undefined){const v=state.chatView;if(!obj(v)||!text(v.selected,256)||!(v.projectId===null||id(v.projectId))||typeof v.projectHome!=='boolean'||!obj(v.positions)||Object.keys(v.positions).length>2000||!Object.entries(v.positions).every(([key,p])=>id(key)&&stamp(p)))return false}
 return true;
}
class ChatStore{
 constructor(directory){this.directory=path.resolve(directory);this.path=path.join(this.directory,'chat.json')}
 load(){let fd;try{
  fd=fs.openSync(this.path,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);const stat=fs.fstatSync(fd);if(!stat.isFile()||stat.size>MAX)throw Error('Invalid store');
  const value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(fs.readFileSync(fd)));if(value.version!==1||!valid(value.state))throw Error('Invalid schema');
  // Migrate in memory; reading never rewrites the original file or consults a provider.
  for(const c of value.state.connections){c.enabledModels??=[...new Set(value.state.conversations.filter(chat=>chat.connectionId===c.id&&modelId(chat.model)).map(chat=>chat.model))].slice(0,1000);c.favoriteModels??=[];c.modelLabels??={}}
  value.state.defaultModel??=null;return value.state;
 }catch(e){if(e.code==='ENOENT')return null;throw Object.assign(Error('Chat storage could not be read safely; the original is preserved.'),{code:'CORRUPT_CHAT_STORE'})}finally{if(fd!==undefined)fs.closeSync(fd)}}
 save(state){
  if(!valid(state))throw Error('Invalid chat data or chat limits exceeded.');const body=JSON.stringify({version:1,state});if(Buffer.byteLength(body)>MAX)throw Error('Chat storage is full.');this.load();
  fs.mkdirSync(this.directory,{recursive:true,mode:0o700});const temp=path.join(this.directory,`.chat-${randomUUID()}.tmp`);let fd,committed=false;
  try{
   try{fd=fs.openSync(temp,'wx',0o600);fs.writeFileSync(fd,body);fs.fsyncSync(fd);fs.closeSync(fd);fd=undefined;fs.renameSync(temp,this.path);committed=true;const d=fs.openSync(this.directory,'r');try{fs.fsyncSync(d)}finally{fs.closeSync(d)}}finally{if(fd!==undefined)fs.closeSync(fd);try{fs.unlinkSync(temp)}catch(e){if(e.code!=='ENOENT')throw e}}
  }catch(e){if(committed)throw Object.assign(Error('Chat changes were saved, but the final disk flush or cleanup failed. Keep zQ open and check available storage.'),{committed:true,cause:e});throw e}
 }
}
module.exports={ChatStore,text,modelId,modelList,modelLabel};
