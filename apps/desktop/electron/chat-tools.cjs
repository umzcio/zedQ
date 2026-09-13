'use strict';
const {randomUUID}=require('node:crypto');
const KINDS=['web_search','x_search','code_execution'];
const FILE_LIMIT=4*1024*1024, FILE_TOTAL=8*1024*1024;
const bounded=(s,n)=>typeof s==='string'&&!/[\0]/.test(s)&&Buffer.byteLength(s)<=n&&Buffer.from(s).toString('utf8')===s;
const object=v=>v&&typeof v==='object'&&!Array.isArray(v);
function selectedTools(value=[]){
 if(!Array.isArray(value)||value.length>3||new Set(value).size!==value.length||!value.every(v=>KINDS.includes(v)))throw Error('Choose valid, unique provider tools.');
 return [...value];
}
function validActivity(v){return object(v)&&bounded(v.id,256)&&!!v.id&&[...KINDS,'create_document','mcp'].includes(v.kind)&&['running','complete','error','stopped','interrupted'].includes(v.status)&&(v.detail===undefined||bounded(v.detail,4000))&&Object.keys(v).every(k=>['id','kind','status','detail'].includes(k))}
function validFile(v){return object(v)&&bounded(v.id,256)&&!!v.id&&bounded(v.name,256)&&!!v.name&&!/[\\/\x00-\x1f\x7f]/.test(v.name)&&bounded(v.mime,128)&&/^[\w.+-]+\/[\w.+-]+$/.test(v.mime)&&Number.isInteger(v.size)&&v.size>=0&&v.size<=FILE_LIMIT&&typeof v.data==='string'&&v.data.length<=Math.ceil(FILE_LIMIT/3)*4&&Buffer.from(v.data,'base64').toString('base64')===v.data&&Buffer.byteLength(v.data,'base64')===v.size&&Object.keys(v).every(k=>['id','name','mime','size','data'].includes(k))}
function validSources(s){return Array.isArray(s)&&s.length<=100&&new Set(s.map(v=>v.id)).size===s.length&&s.every(v=>object(v)&&bounded(v.id,128)&&!!v.id&&bounded(v.title,1024)&&bounded(v.url,8192)&&(()=>{try{return externalURL(v.url)===v.url}catch{return false}})())}
function recordSources(reply,sources){if(!validSources(sources))throw Error("The provider returned invalid web sources.");reply.sources=structuredClone(sources)}
function validToolMessage(m){
 if(m.sources!==undefined&&!validSources(m.sources))return false;
 try{if(m.tools!==undefined)selectedTools(m.tools)}catch{return false}
 if(m.toolActivity!==undefined&&(!Array.isArray(m.toolActivity)||m.toolActivity.length>40||!m.toolActivity.every(validActivity)||new Set(m.toolActivity.map(t=>t.id)).size!==m.toolActivity.length))return false;
 if(m.generatedFiles!==undefined&&(!Array.isArray(m.generatedFiles)||m.generatedFiles.length>10||!m.generatedFiles.every(validFile)||new Set(m.generatedFiles.map(f=>f.id)).size!==m.generatedFiles.length||m.generatedFiles.reduce((n,f)=>n+f.size,0)>FILE_TOTAL))return false;
 return true;
}
function recordActivity(reply,event,allowed){
 if(!validActivity(event)||!['running','complete','error'].includes(event.status)||!allowed.includes(event.kind))throw Error('The provider returned invalid tool activity.');
 const list=reply.toolActivity??=[],old=list.find(t=>t.id===event.id);
 if(old){if(old.kind!==event.kind||old.status!=='running'&&event.status==='running')throw Error('The provider returned an invalid tool transition.');Object.assign(old,event)}
 else {if(list.length>=40)throw Error('The response exceeded the tool activity limit.');list.push({...event})}
 reply.toolActivity=list;
}
function recordArtifact(reply,input,allowed){
 if(!allowed.some(k=>['code_execution','create_document','mcp'].includes(k))||!object(input))throw Error('The provider returned an unrequested generated file.');
 const name=typeof input.name==='string'?input.name.split(/[\\/]/).at(-1).replace(/[\x00-\x1f\x7f]/g,'').replace(/^\.+/,''):'';
 const file={id:randomUUID(),name,mime:input.mime,size:typeof input.data==='string'?Buffer.byteLength(input.data,'base64'):-1,data:input.data};
 if(!validFile(file))throw Error('The generated file is invalid or exceeds 4 MB.');
 const list=reply.generatedFiles??=[];
 if(list.length>=10||list.reduce((n,f)=>n+f.size,0)+file.size>FILE_TOTAL)throw Error('Generated files exceeded the 8 MB response limit.');
 reply.generatedFiles=[...list,file];return file;
}
function settleTools(reply,status){for(const t of reply.toolActivity??[])if(t.status==='running')t.status=status==='complete'?'error':status}
function publicGeneratedFile({data,...file}){return file}
function externalURL(value){
 if(typeof value!=='string'||value.length>8192||/[\x00-\x20\x7f]/.test(value))throw Error('This link is not a valid web address.');
 let url;try{url=new URL(value)}catch{throw Error('This link is not a valid web address.')}
 if(!['https:','http:'].includes(url.protocol)||url.username||url.password)throw Error('Only HTTP and HTTPS links can be opened.');
 return url.href;
}
module.exports={recordSources,selectedTools,validToolMessage,recordActivity,recordArtifact,settleTools,publicGeneratedFile,externalURL};
