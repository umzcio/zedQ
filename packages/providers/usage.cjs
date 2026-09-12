'use strict';
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const count=value=>Number.isSafeInteger(value)&&value>=0;
const fields=['inputTokens','outputTokens','cachedInputTokens','reasoningTokens'];
const modelID=value=>typeof value==='string'&&value.length>0&&Buffer.byteLength(value)<=512&&!/[\s\x00-\x1f\x7f]/.test(value)&&Buffer.from(value).toString('utf8')===value;
function normalized(kind,usage){
 if(!object(usage))return {};
 let candidate;
 if(kind==='responses')candidate={inputTokens:usage.input_tokens,outputTokens:usage.output_tokens,cachedInputTokens:usage.input_tokens_details?.cached_tokens,reasoningTokens:usage.output_tokens_details?.reasoning_tokens};
 else if(kind==='anthropic')candidate={inputTokens:count(usage.input_tokens)?usage.input_tokens+(count(usage.cache_creation_input_tokens)?usage.cache_creation_input_tokens:0)+(count(usage.cache_read_input_tokens)?usage.cache_read_input_tokens:0):undefined,outputTokens:usage.output_tokens,cachedInputTokens:usage.cache_read_input_tokens};
 else if(kind==='google')candidate={inputTokens:usage.promptTokenCount,outputTokens:count(usage.candidatesTokenCount)?usage.candidatesTokenCount+(count(usage.thoughtsTokenCount)?usage.thoughtsTokenCount:0):undefined,cachedInputTokens:usage.cachedContentTokenCount,reasoningTokens:usage.thoughtsTokenCount};
 else if(kind==='ollama')candidate={inputTokens:usage.prompt_eval_count,outputTokens:usage.eval_count};
 else if(kind==='bedrock')candidate={inputTokens:count(usage.inputTokens)?usage.inputTokens+(count(usage.cacheReadInputTokens)?usage.cacheReadInputTokens:0)+(count(usage.cacheWriteInputTokens)?usage.cacheWriteInputTokens:0):undefined,outputTokens:usage.outputTokens,cachedInputTokens:usage.cacheReadInputTokens};
 else candidate={inputTokens:usage.prompt_tokens,outputTokens:usage.completion_tokens,cachedInputTokens:usage.prompt_tokens_details?.cached_tokens,reasoningTokens:usage.completion_tokens_details?.reasoning_tokens};
 return Object.fromEntries(Object.entries(candidate).filter(([,value])=>count(value)));
}
// Each stream reports cumulative snapshots; only separate hosted continuation
// requests are added together. Optional telemetry cannot manufacture counts from
// text lengths or the selected model. Unknown/invalid fields are ignored.
function createTelemetry({onUsage,onModel}={}){
 let rounds=[],current={},raw={},lastUsage='',lastModel;
 const nextRound=()=>{if(Object.keys(current).length)rounds.push(current);current={};raw={}};
 const usage=(kind,value)=>{
  if(!object(value))return;
  if(kind==='anthropic'||kind==='google'){for(const [key,n] of Object.entries(value))if(count(n))raw[key]=n;value=raw}
  const next=normalized(kind,value);if(!Object.keys(next).length)return;
  current={...current,...next};const total={};
  for(const key of fields){const reported=[...rounds,current].map(row=>row[key]).filter(count);if(reported.length){const sum=reported.reduce((a,b)=>a+b,0);if(count(sum))total[key]=sum}}
  const wire=JSON.stringify(total);if(Object.keys(total).length&&wire!==lastUsage){lastUsage=wire;if(typeof onUsage==='function')onUsage({...total})}
 };
 const model=value=>{if(modelID(value)&&value!==lastModel){lastModel=value;if(typeof onModel==='function')onModel(value)}};
 const observe=(kind,p)=>{
  if(!object(p))return;
  if(kind==='openai'||kind==='responses'){model(p.response?.model);usage('responses',p.response?.usage)}
  else if(kind==='anthropic'){if(p.type==='message_start'){model(p.message?.model);usage(kind,p.message?.usage)}else if(p.type==='message_delta')usage(kind,p.usage)}
  else if(kind==='google'){model(p.modelVersion);usage(kind,p.usageMetadata)}
  else if(kind==='ollama'){model(p.model);if(p.done)usage(kind,p)}
  else if(kind==='bedrock'){model(p.trace?.promptRouter?.invokedModelId);usage(kind,p.usage)}
  else{model(p.model);usage('chat',p.usage??p.x_groq?.usage)}
 };
 return{observe,nextRound};
}
module.exports={createTelemetry};
