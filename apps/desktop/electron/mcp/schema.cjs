'use strict';
const {Worker,isMainThread,parentPort,workerData}=require('node:worker_threads');
const DIALECTS=new Map([
 ['https://json-schema.org/draft/2020-12/schema','ajv/dist/2020'],
 ['https://json-schema.org/draft/2019-09/schema','ajv/dist/2019'],
 ['http://json-schema.org/draft-07/schema#','ajv'],
 ['https://json-schema.org/draft-07/schema','ajv'],
]);
function inspectToolSchema(schema){
 if(!schema||typeof schema!=='object'||Array.isArray(schema)||Buffer.byteLength(JSON.stringify(schema))>65536)throw Error('Unsupported connector schema.');
 let nodes=0;const visit=(value,depth)=>{if(++nodes>5000||depth>32)throw Error('Connector schema is too complex.');if(!value||typeof value!=='object')return;
 for(const [key,item] of Object.entries(value)){
  if(key==='$async'&&item)throw Error('Asynchronous connector schemas are unsupported.');
  if((key==='$ref'||key==='$dynamicRef'||key==='$recursiveRef')&&(typeof item!=='string'||!item.startsWith('#')))throw Error('External connector schema references are unsupported.');
  if(key==='$schema'&&!DIALECTS.has(item))throw Error('Unsupported connector schema dialect.');
  if(key==='$vocabulary')for(const [uri,required] of Object.entries(item??{}))if(required&&!/^https:\/\/json-schema.org\/draft\/(2020-12|2019-09)\/vocab\/(core|applicator|unevaluated|validation|meta-data|format-annotation|content)$/.test(uri))throw Error('Unsupported required connector schema vocabulary.');
  visit(item,depth+1);
 }};visit(schema,0);return schema;
}
async function validateToolArguments(schema,args,{signal,timeoutMs=2000}={}){
 inspectToolSchema(schema);signal?.throwIfAborted();
 return new Promise((resolve,reject)=>{
  const worker=new Worker(__filename,{workerData:{schema,args},resourceLimits:{maxOldGenerationSizeMb:128,maxYoungGenerationSizeMb:16,stackSizeMb:4}});
  let done=false;const finish=(error,value)=>{if(done)return;done=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);void worker.terminate();error?reject(error):resolve(value)};
  const abort=()=>finish(Error('Connector validation cancelled.'));
  const timer=setTimeout(()=>finish(Error('Connector schema validation exceeded its time limit.')),timeoutMs);
  signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
  worker.once('message',result=>result.error?finish(Error('Unsupported connector schema.')):finish(null,result.valid));
  worker.once('error',()=>finish(Error('Connector schema validation failed.')));
  worker.once('exit',()=>{if(!done)finish(Error('Connector schema validation stopped.'))});
 });
}
if(!isMainThread&&workerData){try{
 const Ajv=require(DIALECTS.get(workerData.schema.$schema)||'ajv/dist/2020');
 const ajv=new Ajv({strict:false,strictSchema:true,validateFormats:false,allErrors:false,addUsedSchema:false});
 // Google's MCP schemas annotate enum choices; this metadata adds no validation rule.
 // Register only the known annotation so unknown validation keywords still fail closed.
 ajv.addKeyword({keyword:'x-google-enum-descriptions',schemaType:'array',metaSchema:{type:'array',items:{type:'string'}}});
 const schema=structuredClone(workerData.schema);if(schema.$schema?.includes('draft-07'))schema.$schema='http://json-schema.org/draft-07/schema#';
 const validate=ajv.compile(schema);parentPort.postMessage({valid:!!validate(workerData.args)});
}catch{parentPort.postMessage({error:true})}}
module.exports={inspectToolSchema,validateToolArguments};
