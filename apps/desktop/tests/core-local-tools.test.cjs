const {test}=require('node:test'),assert=require('node:assert/strict');
const {streamHostedCore}=require('../../../packages/providers/hosted-core.cjs');
const BASE={openai:'https://api.openai.com/v1',anthropic:'https://api.anthropic.com/v1',google:'https://generativelanguage.googleapis.com/v1beta'};
const definitions=[{name:'read_document',description:'Read a document',parameters:{type:'object',properties:{artifactId:{type:'string'}},required:['artifactId'],additionalProperties:false}}];
const sse=(...items)=>new Response(items.map(p=>'data: '+JSON.stringify(p)+'\n\n').join(''),{headers:{'Content-Type':'text/event-stream'}});
const done=output=>({type:'response.completed',response:{status:'completed',output}});
const acall=(blocks,reason='tool_use')=>blocks.flatMap((b,index)=>[{type:'content_block_start',index,content_block:b},{type:'content_block_stop',index}]).concat([{type:'message_delta',delta:{stop_reason:reason}},{type:'message_stop'}]);
async function run(provider,responses,extra={}){
 const bodies=[],calls=[],text=[],replacements=[];
 await streamHostedCore(provider,{apiKey:'fixture-secret',fetchImpl:async(url,o)=>{bodies.push(JSON.parse(o.body));assert.ok(responses.length,'unexpected continuation');return responses.shift()}},{baseUrl:BASE[provider],model:provider==='google'?'gemini-3.8-flash':'fixture-model',messages:[{role:'user',content:'Read the document'}],tools:[],localTools:definitions,onLocalTool:async c=>{calls.push(c);return{content:'Original document'}},onDelta:d=>text.push(d.content),onTool:()=>{},onReplace:s=>replacements.push(s),...extra});
 return{bodies,calls,text,replacements};
}
test('OpenAI local functions preserve encrypted reasoning and hosted search across continuation',async()=>{
 const output=[{type:'reasoning',id:'r1',summary:[],encrypted_content:'opaque'}, {type:'web_search_call',id:'s1',status:'completed',action:{query:'docs',sources:[{url:'https://example.com',title:'Example'}]}},{type:'function_call',id:'fc1',call_id:'call1',name:'read_document',arguments:'{"artifactId":"doc"}',status:'completed'}];
 const result=await run('openai',[sse({type:'response.output_item.added',output_index:2,item:{...output[2],arguments:''}},{type:'response.function_call_arguments.delta',item_id:'fc1',output_index:2,delta:'{"artifactId":"doc"}'},done(output)),sse(done([{type:'message',id:'m1',content:[{type:'output_text',text:'Read it.',annotations:[]}]}]))],{tools:['web_search']});
 assert.equal(result.calls.length,1);assert.deepEqual(result.bodies[1].input.slice(1,4),output);assert.equal(result.bodies[1].input[4].call_id,'call1');assert.equal(result.bodies[0].tools[1].name,'read_document');assert.equal(result.bodies[0].tools[1].strict,false);assert.ok(result.bodies[0].include.includes('reasoning.encrypted_content'));assert.equal(result.replacements.at(-1),'Read it.');
});
test('Anthropic preserves signed thinking and streams local arguments before matching tool_result',async()=>{
 const thinking={type:'thinking',thinking:'Plan',signature:'signed'},redacted={type:'redacted_thinking',data:'opaque'};
 const events=acall([thinking,redacted]);events.splice(-2);
 events.push({type:'content_block_start',index:2,content_block:{type:'tool_use',id:'tool1',name:'read_document',input:{}}},{type:'content_block_delta',index:2,delta:{type:'input_json_delta',partial_json:'{"artifactId":"doc"}'}},{type:'content_block_stop',index:2},{type:'message_delta',delta:{stop_reason:'tool_use'}},{type:'message_stop'});
 const result=await run('anthropic',[sse(...events),sse(...acall([{type:'text',text:'Read it.'}],'end_turn'))]);
 assert.equal(result.calls.length,1);assert.deepEqual(result.bodies[1].messages[1].content.slice(0,2),[thinking,redacted]);assert.equal(result.bodies[1].messages[2].content[0].tool_use_id,'tool1');assert.deepEqual(result.bodies[0].tools[0].input_schema,definitions[0].parameters);assert.equal(result.replacements.at(-1),'Read it.');
});
test('Gemini preserves every signed part and matches function response ID alongside code',async()=>{
 const parts=[{text:'Plan',thought:true,thoughtSignature:'signed1'},{executableCode:{id:'code1',language:'PYTHON',code:'print(1)'},thoughtSignature:'signed2'},{codeExecutionResult:{id:'code1',outcome:'OUTCOME_OK',output:'1'},thoughtSignature:'signed3'},{functionCall:{id:'fn1',name:'read_document',args:{artifactId:'doc'}},thoughtSignature:'signed4'}];
 const result=await run('google',[sse({candidates:[{index:0,content:{role:'model',parts},finishReason:'STOP'}]}),sse({candidates:[{index:0,content:{parts:[{text:'Read it.'}]},finishReason:'STOP'}]})],{tools:['code_execution']});
 assert.equal(result.calls.length,1);assert.deepEqual(result.bodies[1].contents[1].parts,parts);assert.equal(result.bodies[1].contents[2].parts[0].functionResponse.id,'fn1');assert.deepEqual(result.bodies[0].tools[1].functionDeclarations[0].parametersJsonSchema,definitions[0].parameters);assert.equal(result.replacements.at(-1),'Read it.');
});
test('incomplete or malformed tool batches never execute a local mutation',async()=>{
 for(const [provider,response] of [
 ['openai',sse({type:'response.output_item.done',item:{type:'function_call',id:'fc1',call_id:'call1',name:'read_document',arguments:'{"artifactId":"doc"}'}})],
 ['openai',sse(done([{type:'function_call',call_id:'a',name:'read_document',arguments:'{}'},{type:'function_call',call_id:'b',name:'shell',arguments:'{}'}]))],
 ['anthropic',sse(...acall([{type:'tool_use',id:'a',name:'read_document',input:{}}],'max_tokens'))],
 ['google',sse({candidates:[{content:{parts:[{functionCall:{name:'read_document',args:{}}}]},finishReason:'MAX_TOKENS'}]})]
 ]){let calls=0;await assert.rejects(run(provider,[response],{onLocalTool:()=>{calls++;return{}}}));assert.equal(calls,0,provider)}
});
test('OpenAI rejects explicitly unfinished tool calls in a completed response',async()=>{
 let calls=0;await assert.rejects(run('openai',[sse(done([{type:'function_call',id:'fc',call_id:'a',name:'read_document',arguments:'{}',status:'in_progress'}]))],{onLocalTool:()=>{calls++;return{}}}));assert.equal(calls,0);
});
test('a changed historical ID invalidates the whole next tool batch before any new execution',async()=>{
 const call=(id,args)=>({type:'function_call',id:'fc_'+id,call_id:id,name:'read_document',arguments:JSON.stringify(args)});let calls=0;
 await assert.rejects(run('openai',[sse(done([call('a',{artifactId:'doc'})])),sse(done([call('b',{artifactId:'doc'}),call('a',{artifactId:'other'})]))],{onLocalTool:()=>{calls++;return{}}}));assert.equal(calls,1);
});
