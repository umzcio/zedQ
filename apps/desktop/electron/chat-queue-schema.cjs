'use strict';
const {validCatalog}=require('./skill-activation.cjs');
const {isAttachment,publicAttachment}=require('./attachment-schema.cjs');
const {validSkills,publicSkill}=require('./skill-schema.cjs');
const {skillBytes}=require('./skill-context.cjs');
const text=(value,max=4096)=>typeof value==='string'&&Buffer.byteLength(value)<=max&&!value.includes('\0')&&value.isWellFormed();
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const id=value=>text(value,256)&&value.length>0;
const stamp=value=>Number.isFinite(value)&&value>=0;
const unique=values=>new Set(values).size===values.length;
function projectContext(project){return project===null||object(project)&&id(project.id)&&text(project.name,256)&&project.name.trim()&&text(project.instructions,16000)&&Array.isArray(project.files)&&project.files.length<=10&&project.files.every(isAttachment)}
function queueContextBytes(item){return skillBytes(item.skillContext)+Buffer.byteLength(item.projectContext?.instructions??'')+(item.projectContext?.files??[]).reduce((sum,file)=>sum+Buffer.byteLength(file.text??''),0)+Buffer.byteLength(JSON.stringify(item.context))+item.attachments.reduce((sum,file)=>sum+Buffer.byteLength(file.text??''),0)}
function validQueuedMessage(item){
 return Boolean(object(item)&&Object.keys(item).every(key=>['id','text','createdAt','connectionId','connectionName','connectionUpdatedAt','model','tools','context','attachments','skillContext','skillCatalog','projectContext','artifactContext'].includes(key))&&id(item.id)&&text(item.text,64000)&&stamp(item.createdAt)&&id(item.connectionId)&&text(item.connectionName,256)&&stamp(item.connectionUpdatedAt)&&text(item.model,512)&&item.model.trim()&&Array.isArray(item.tools)&&item.tools.length<=3&&unique(item.tools)&&item.tools.every(tool=>['web_search','x_search','code_execution'].includes(tool))&&Array.isArray(item.context)&&item.context.length<=10&&item.context.every(note=>object(note)&&id(note.id)&&text(note.title)&&text(note.body,100000))&&unique(item.context.map(note=>note.id))&&Array.isArray(item.attachments)&&item.attachments.length+item.context.length<=10&&item.attachments.every(isAttachment)&&unique(item.attachments.map(file=>file.id))&&(item.text.trim()||item.attachments.length||item.context.length)&&validCatalog(item.skillCatalog)&&validSkills(item.skillContext,{max:10})&&projectContext(item.projectContext)&&(item.artifactContext===undefined||object(item.artifactContext)&&Object.keys(item.artifactContext).every(key=>['artifactId','versionId'].includes(key))&&[item.artifactContext.artifactId,item.artifactContext.versionId].every(value=>typeof value==='string'&&/^[a-f0-9-]{36}$/.test(value)))&&queueContextBytes(item)<=100000);
}
function validQueue(queue){return queue===undefined||Boolean(object(queue)&&Object.keys(queue).every(key=>['items','paused','error'].includes(key))&&Array.isArray(queue.items)&&queue.items.length<=20&&queue.items.every(validQueuedMessage)&&unique(queue.items.map(item=>item.id))&&typeof queue.paused==='boolean'&&text(queue.error))}
function publicQueue(queue){if(queue===undefined)return undefined;const visible=structuredClone(queue);for(const item of visible.items){delete item.skillCatalog;item.attachments=item.attachments.map(publicAttachment);item.skillContext=item.skillContext.map(publicSkill);if(item.projectContext)item.projectContext.files=item.projectContext.files.map(publicAttachment)}return visible}
module.exports={validQueue,validQueuedMessage,publicQueue,queueContextBytes};
