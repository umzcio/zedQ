const {test}=require('node:test'),assert=require('node:assert/strict');
const {Readable}=require('node:stream');
const {EventStreamCodec}=require('@smithy/core/event-streams');
const {createProvider,PROVIDERS}=require('@zq/providers');
const {createToolSession}=require('../../../packages/providers/local-tools.cjs');
const definitions=[{name:'ask_user',description:'Ask the user',parameters:{type:'object',properties:{}}}];
function humanWait(){
 let accumulated=5000,started=null;const listeners=new Set();
 const notify=()=>{for(const listener of listeners)listener()};
 return {subscribe(listener){listeners.add(listener);return()=>listeners.delete(listener)},elapsedMs:()=>accumulated+(started===null?0:Date.now()-started),isWaiting:()=>started!==null,
  enter(){started=Date.now();notify()},leave(){accumulated+=Date.now()-started;started=null;notify()},listeners};
}
function sse(events){return new Response(events.map(event=>'data: '+(typeof event==='string'?event:JSON.stringify(event))+'\n\n').join(''))}
function response(provider,first){
 if(provider==='anthropic')return sse([{type:'content_block_start',index:0,content_block:first?{type:'tool_use',id:'call1',name:'ask_user',input:{}}:{type:'text',text:'Done'}},{type:'content_block_stop',index:0},{type:'message_delta',delta:{stop_reason:first?'tool_use':'end_turn'}},{type:'message_stop'}]);
 if(provider==='xai')return sse([{type:'response.completed',response:{status:'completed',output:first?[{type:'function_call',id:'fc1',call_id:'call1',name:'ask_user',arguments:'{}',status:'completed'}]:[{type:'message',id:'m1',content:[{type:'output_text',text:'Done',annotations:[]}]}]}}]);
 if(provider==='groq')return sse([{choices:[{index:0,delta:first?{tool_calls:[{index:0,id:'call1',type:'function',function:{name:'ask_user',arguments:'{}'}}]}:{content:'Done'},finish_reason:first?'tool_calls':'stop'}]},'[DONE]']);
 if(provider==='ollama')return new Response(JSON.stringify({message:{role:'assistant',content:first?'':'Done',...(first?{tool_calls:[{function:{name:'ask_user',arguments:{}}}]}:{})},done:true,done_reason:'stop'})+'\n');
 const events=first?[{messageStart:{role:'assistant'}},{contentBlockStart:{contentBlockIndex:0,start:{toolUse:{toolUseId:'call1',name:'ask_user'}}}},{contentBlockDelta:{contentBlockIndex:0,delta:{toolUse:{input:'{}'}}}},{contentBlockStop:{contentBlockIndex:0}},{messageStop:{stopReason:'tool_use'}}]:[{messageStart:{role:'assistant'}},{contentBlockDelta:{contentBlockIndex:0,delta:{text:'Done'}}},{contentBlockStop:{contentBlockIndex:0}},{messageStop:{stopReason:'end_turn'}}];
 const codec=new EventStreamCodec(bytes=>Buffer.from(bytes).toString('utf8'),text=>Buffer.from(text));
 const wire=Buffer.concat(events.map(event=>{const [type,payload]=Object.entries(event)[0];return Buffer.from(codec.encode({headers:{':message-type':{type:'string',value:'event'},':event-type':{type:'string',value:type},':content-type':{type:'string',value:'application/json'}},body:Buffer.from(JSON.stringify(payload))}))}));
 return {response:{statusCode:200,headers:{'content-type':'application/vnd.amazon.eventstream'},body:Readable.from([wire])}};
}
const models={anthropic:'claude-sonnet-5',xai:'grok-4.6',groq:'llama-3.3-70b-versatile',ollama:'fixture',bedrock:'us.anthropic.claude-sonnet-4-6'};
for(const provider of Object.keys(models)){
 for(const scenario of ['resume','abort','stall'])test(`${provider} discounts explicit human waits but preserves ${scenario==='resume'?'continuation':scenario==='abort'?'immediate abort':'ordinary execution deadlines'}`,async t=>{
  t.mock.timers.enable({apis:['Date','setTimeout']});
  let requests=0,release,entered;const started=new Promise(resolve=>entered=resolve),human=humanWait(),controller=new AbortController();
  const callback=()=>{if(scenario!=='stall')human.enter();entered();return new Promise(resolve=>release=()=>resolve({answer:'Continue'}))};callback.userWait=human;
  const options={apiKey:'fixture-only',idleMs:40,totalMs:80,fetchImpl:async()=>response(provider,++requests===1),requestHandler:{handle:async()=>response(provider,++requests===1),destroy(){}}};
  const adapter=createProvider(provider,options);
  let settled=false;const pending=adapter.streamChat({baseUrl:PROVIDERS[provider].baseUrl,model:models[provider],messages:[{role:'user',content:'Ask me'}],localTools:definitions,onLocalTool:callback,signal:controller.signal,onDelta(){}});
  const observed=pending.then(()=>{settled=true;return null},error=>{settled=true;return error});
  await started;t.mock.timers.tick(1000);await Promise.resolve();await Promise.resolve();
  if(scenario==='stall'){const error=await observed;assert.match(error?.code??'',/^(IDLE|TOTAL)_TIMEOUT$/);assert.equal(requests,1);release()}
  else if(scenario==='abort'){controller.abort();assert.equal((await observed)?.code,'ABORTED');assert.equal(requests,1);human.leave();release()}
  else {assert.equal(settled,false,'A human wait must outlive provider deadlines');human.leave();release();const error=await observed;assert.equal(error,null,error?.message);assert.equal(requests,2)}
  assert.equal(human.listeners.size,0,'Operation listeners must be released');
 });
}
test('local session excludes only new human wait time and retains consumed execution budget',async t=>{
 t.mock.timers.enable({apis:['Date','setTimeout']});const human=humanWait();let release,entered;
 const started=new Promise(resolve=>entered=resolve),callback=()=>{human.enter();entered();return new Promise(resolve=>release=resolve)};callback.userWait=human;
 const session=createToolSession(definitions,callback,()=>{},{totalMs:80});t.mock.timers.tick(20);
 const pending=session.execute({id:'one',name:'ask_user',arguments:{}});pending.catch(()=>{});await started;t.mock.timers.tick(1000);human.leave();release({answer:'Yes'});
 assert.equal(await pending,'{"answer":"Yes"}');t.mock.timers.tick(61);
 await assert.rejects(session.execute({id:'two',name:'ask_user',arguments:{}}),{code:'TOTAL_TIMEOUT'});assert.equal(human.listeners.size,0);
});
