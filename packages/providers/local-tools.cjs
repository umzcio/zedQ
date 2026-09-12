'use strict';
const {failure,object}=require('./transport.cjs');
const {createActiveClock}=require('./active-clock.cjs');
const JSON_LIMIT=120*1024,MAX_CALLS=12;
const trusted=new WeakSet();
function fail(code,message){const error=failure(code,message);trusted.add(error);return error}
function encode(value){let json;try{json=JSON.stringify(value)}catch{}if(typeof json!=='string'||Buffer.byteLength(json)>JSON_LIMIT)throw fail('RESPONSE_LIMIT','Local tool JSON exceeds the 120 KiB limit.');return json}
function createToolSession(localTools=[],onLocalTool,check=()=>{},{signal,totalMs=600000}={}){
 const clock=createActiveClock(onLocalTool?.userWait);
 if(!Number.isFinite(totalMs)||totalMs<=0)throw fail('INVALID_REQUEST','Provide a positive local tool deadline.');
 const guard=()=>{check();if(signal?.aborted)throw fail('ABORTED','The provider request was stopped.');if(clock.elapsedMs()>=totalMs)throw fail('TOTAL_TIMEOUT','The provider exceeded the request time limit.');};
 const wait=promise=>new Promise((resolve,reject)=>{
  let cancelTimer=()=>{},settled=false;const abort=()=>finish(fail('ABORTED','The provider request was stopped.'));
  const finish=(error,value)=>{if(settled)return;settled=true;cancelTimer();signal?.removeEventListener('abort',abort);error?reject(error):resolve(value)};
  cancelTimer=clock.timeout(()=>finish(fail('TOTAL_TIMEOUT','The provider exceeded the request time limit.')),Math.max(1,totalMs-clock.elapsedMs()));
  signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
  promise.then(value=>finish(null,value),error=>finish(error));
 });
 if(!Array.isArray(localTools)||localTools.length>16||!localTools.every(t=>object(t)&&typeof t.name==='string'&&/^[a-zA-Z0-9_-]{1,64}$/.test(t.name)&&typeof t.description==='string'&&t.description.length<=8000&&object(t.parameters)&&t.parameters.type==='object')||new Set(localTools.map(t=>t.name)).size!==localTools.length)throw fail('INVALID_REQUEST','Provide valid local function definitions.');
 const definitions=JSON.parse(encode(localTools)),allowed=new Set(definitions.map(t=>t.name));
 if(definitions.length&&typeof onLocalTool!=='function')throw fail('INVALID_REQUEST','Local tools require an execution callback.');
 const calls=new Map();
 const preflight=batch=>{
  guard();const planned=new Map([...calls].map(([id,call])=>[id,call.key]));
  if(!Array.isArray(batch)||batch.length>MAX_CALLS)throw fail('TOOL_LIMIT','The provider reached the local tool call limit.');
  for(const call of batch){
   const {id,name,arguments:args}=call??{};
   if(typeof id!=='string'||!id||id.length>512||/[\x00-\x1f\x7f]/.test(id)||!allowed.has(name)||!object(args))throw fail('INVALID_RESPONSE','The provider returned an unknown or malformed local tool call.');
   const key=encode({name,arguments:args});
   if(planned.has(id)&&planned.get(id)!==key)throw fail('INVALID_RESPONSE','The provider reused a tool call ID with different arguments.');
   planned.set(id,key);
  }
  if(planned.size>MAX_CALLS)throw fail('TOOL_LIMIT','The provider reached the local tool call limit.');
 };
 return {enabled:!!definitions.length,definitions,has:name=>allowed.has(name),preflight,async execute({id,name,arguments:args}){
  preflight([{id,name,arguments:args}]);
  if(typeof id!=='string'||!id||id.length>512||/[\x00-\x1f\x7f]/.test(id)||!allowed.has(name)||!object(args))throw fail('INVALID_RESPONSE','The provider returned an unknown or malformed local tool call.');
  const key=encode({name,arguments:args}),prior=calls.get(id);
  if(prior){if(prior.key!==key)throw fail('INVALID_RESPONSE','The provider reused a tool call ID with different arguments.');const result=await prior.result;guard();return result}
  if(calls.size>=MAX_CALLS)throw fail('TOOL_LIMIT','The provider reached the local tool call limit.');
  const result=wait(Promise.resolve().then(async()=>{guard();try{return await onLocalTool({name,arguments:JSON.parse(JSON.stringify(args))})}catch(error){guard();if(trusted.has(error))throw error;throw fail('LOCAL_TOOL_ERROR','The local document tool could not complete. Check the selected document and try again.');}}).then(value=>{guard();return encode(value)}));
  calls.set(id,{key,result});return result;
 }};
}
module.exports={createToolSession,isLocalToolError:error=>trusted.has(error),JSON_LIMIT,MAX_CALLS};
