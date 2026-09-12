const {test}=require('node:test'),assert=require('node:assert/strict');
const {createProvider,PROVIDERS}=require('@zq/providers');
const localTools=[{name:'read_document',description:'Read',parameters:{type:'object',properties:{}}}];
const wire=(...items)=>new Response(items.map(p=>'data: '+(typeof p==='string'?p:JSON.stringify(p))+'\n\n').join(''));
const end={type:'response.completed',response:{status:'completed',output:[]}};
test('native providers expose conservative function gates including Gemini mixed-tool limitation',async()=>{
 for(const [provider,model,expected,tools=[]] of [
 ['openai','gpt-6-astra',true],['openai','gpt-4.1',true],['openai','gpt-3.5-turbo',true],['openai','o1-mini',false],['openai','gpt-image-1',false],['openai','future-model',false],
 ['anthropic','claude-sonnet-4-6',true],['anthropic','claude-fable-5-1',true],['anthropic','future-model',false],
 ['google','gemini-2.5-pro',true],['google','gemini-2.5-pro',false,['code_execution']],['google','gemini-3.8-flash',true,['code_execution']],['google','gemini-3.1-flash-image-preview',false],
 ['xai','grok-3',false],['xai','grok-4.6',true],['xai','grok-imagine',false],['perplexity','sonar-pro',false],['groq','groq/compound',false],['groq','llama-3.3-70b-versatile',true]]){
 const p=createProvider(provider,{apiKey:'fixture-secret',fetchImpl:()=>{throw Error('not needed')}});assert.equal(await p.supportsLocalTools?.(PROVIDERS[provider].baseUrl,model,{tools})??false,expected,provider+' '+model);
 }
});
test('OpenRouter and vLLM require explicit catalog tool capabilities; canceled discovery does not continue',async()=>{
 for(const provider of ['openrouter','vllm'])for(const enabled of [false,true]){
 const p=createProvider(provider,{apiKey:'fixture-secret',fetchImpl:async url=>new Response(JSON.stringify(url.endsWith('/key')?{data:{}}:{data:[{id:'custom',architecture:{input_modalities:['text'],output_modalities:['text']},supported_parameters:enabled?['tools']:[],capabilities:enabled?['chat','tool_calling']:['chat']}]}))});
 assert.equal(await p.supportsLocalTools(PROVIDERS[provider].baseUrl,'custom'),enabled);
 }
 const c=new AbortController();c.abort();let fetches=0;const p=createProvider('openrouter',{apiKey:'fixture-secret',fetchImpl:()=>{fetches++}});await assert.rejects(p.supportsLocalTools(PROVIDERS.openrouter.baseUrl,'custom',{signal:c.signal}),e=>e.code==='ABORTED');assert.equal(fetches,0);
});
test('native local-only requests route to Responses or legacy Chat with original output caps',async()=>{
 for(const model of ['gpt-4.1','gpt-3.5-turbo']){
 const bodies=[],urls=[];let calls=0;
 const p=createProvider('openai',{apiKey:'fixture-secret',fetchImpl:async(url,o)=>{urls.push(url);bodies.push(JSON.parse(o.body));return model==='gpt-4.1'?wire(end):wire({choices:[{index:0,delta:{content:'Answer'},finish_reason:'stop'}]},'[DONE]')}});
 await p.streamChat({baseUrl:PROVIDERS.openai.baseUrl,model,messages:[{role:'user',content:'Hi'}],onDelta:()=>{},localTools,onLocalTool:()=>{calls++;return{}}});
 assert.ok(urls[0].endsWith(model==='gpt-4.1'?'/responses':'/chat/completions'));assert.equal(bodies[0].tools.length,1);assert.equal(bodies[0].max_output_tokens??bodies[0].max_tokens,model==='gpt-4.1'?8192:4096);assert.equal(calls,0);
 }
});
test('unsupported native models reject requested local tools before transmitting',async()=>{
 let fetches=0;const p=createProvider('openai',{apiKey:'fixture-secret',fetchImpl:()=>{fetches++}});
 await assert.rejects(p.streamChat({baseUrl:PROVIDERS.openai.baseUrl,model:'o1-mini',messages:[{role:'user',content:'Hi'}],onDelta:()=>{},localTools,onLocalTool:()=>{}}),e=>e.code==='UNSUPPORTED_TOOL');assert.equal(fetches,0);
});
test('OpenRouter local tools retain discovered output caps',async()=>{
 const bodies=[];
 const p=createProvider('openrouter',{apiKey:'fixture-secret',fetchImpl:async(url,o)=>{
  if(url.endsWith('/key'))return new Response(JSON.stringify({data:{}}));
  if(url.endsWith('/models'))return new Response(JSON.stringify({data:[{id:'custom',architecture:{input_modalities:['text'],output_modalities:['text']},supported_parameters:['tools'],top_provider:{max_completion_tokens:1024}}]}));
  bodies.push(JSON.parse(o.body));return wire({choices:[{index:0,delta:{content:'Answer'},finish_reason:'stop'}]},'[DONE]');
 }});
 await p.streamChat({baseUrl:PROVIDERS.openrouter.baseUrl,model:'custom',messages:[{role:'user',content:'Hi'}],localTools,onLocalTool:()=>({}),onDelta:()=>{}});
 assert.equal(bodies[0].max_tokens,1024);
});
