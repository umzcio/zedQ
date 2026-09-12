const {isIP}=require('node:net');
const MAX_BYTES=128*1024;
function publicDomain(value){
 if(typeof value!=='string'||value.length>8192)return null;
 try{const url=new URL(value),host=url.hostname;if(!['https:','http:'].includes(url.protocol)||url.username||url.password||isIP(host)||host.includes(':')||host.length>253||!host.includes('.')||!host.split('.').every(s=>/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(s))||/\.(?:local|localhost|internal|lan|home|test|invalid|ts|onion)$/i.test(host))return null;return host}catch{return null}
}
function normalizeIcon(nativeImage,bytes){
 const image=nativeImage.createFromBuffer(bytes);if(image.isEmpty())return null;
 const {width,height}=image.getSize();if(width<1||height<1||width>256||height>256)return null;
 return image.resize({width:32,height:32,quality:'good'}).toDataURL();
}
function createSourceIconService({fetch=globalThis.fetch,normalize,now=Date.now}={}){
 const cache=new Map(),pending=new Map(),queue=[];let running=0;
 function schedule(task){return new Promise(resolve=>{queue.push({task,resolve});drain()})}
 function drain(){while(running<4&&queue.length){const {task,resolve}=queue.shift();running++;Promise.resolve().then(task).then(resolve,()=>resolve(null)).finally(()=>{running--;drain()})}}
 async function download(host){
  const signal=AbortSignal.timeout(5000);let url=new URL('https://www.google.com/s2/favicons');url.searchParams.set('domain',host);url.searchParams.set('sz','32');
  try{for(let redirect=0;redirect<4;redirect++){
   const response=await fetch(url.href,{signal,redirect:'manual',credentials:'omit',headers:{Accept:'image/png,image/x-icon,image/vnd.microsoft.icon,image/jpeg,image/webp'}});
   if([301,302,303,307,308].includes(response.status)){
    const next=new URL(response.headers.get('location'),url);await response.body?.cancel();
    if(next.protocol!=='https:'||next.username||next.password||next.port||!/^t[0-3]\.gstatic\.com$/.test(next.hostname)||next.pathname!=='/faviconV2')return null;
    url=next;continue;
   }
   if(!response.ok||!/^image\/(?:png|x-icon|vnd.microsoft.icon|jpeg|webp)(?:;|$)/i.test(response.headers.get('content-type')??'')||Number(response.headers.get('content-length'))>MAX_BYTES){await response.body?.cancel();return null}
   if(!response.body)return null;const reader=response.body.getReader(),chunks=[];let total=0;
   try{for(;;){const {value,done}=await reader.read();if(done)break;total+=value.length;if(total>MAX_BYTES){await reader.cancel();return null}chunks.push(Buffer.from(value))}}finally{reader.releaseLock()}
   return normalize(Buffer.concat(chunks));
  }}catch{return null}return null;
 }
 return async function sourceIcon(value){
  const host=publicDomain(value);if(!host)return null;
  const saved=cache.get(host);if(saved&&saved.expires>now()){cache.delete(host);cache.set(host,saved);return saved.value}
  if(pending.has(host))return pending.get(host);
  if(pending.size>=100)return null;
  const task=schedule(()=>download(host)).then(value=>{cache.delete(host);cache.set(host,{value,expires:now()+(value?86400000:600000)});while(cache.size>256)cache.delete(cache.keys().next().value);return value}).finally(()=>pending.delete(host));
  pending.set(host,task);return task;
 }
}
module.exports={createSourceIconService,normalizeIcon};
