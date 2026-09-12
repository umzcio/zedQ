const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createProvider}=require('../../../packages/providers/index.cjs');
const {streamHostedCore}=require('../../../packages/providers/hosted-core.cjs');
const event=value=>`data: ${JSON.stringify(value)}\n\n`;
const response=items=>({status:200,body:new ReadableStream({start(c){for(const item of items)c.enqueue(Buffer.from(typeof item==='string'?item:event(item)));c.close()}})});
const done=output=>({type:'response.completed',response:{status:'completed',output}});
const annotation=(url,title)=>({type:'url_citation',url,title,end_index:6});
const bases={openai:'https://api.openai.com/v1',anthropic:'https://api.anthropic.com/v1',google:'https://generativelanguage.googleapis.com/v1beta',xai:'https://api.x.ai/v1',openrouter:'https://openrouter.ai/api/v1',perplexity:'https://api.perplexity.ai'};
async function run(provider,items,extra={}){const snapshots=[],deltas=[];const request={baseUrl:bases[provider],model:provider==='xai'?'grok-4':provider==='perplexity'?'sonar':'fixture',messages:[{role:'user',content:'Search'}],tools:['web_search'],onDelta:d=>deltas.push(d.content),onTool(){},onSources:s=>snapshots.push(s),...extra};const config={apiKey:'fixture-secret',fetchImpl:async()=>response(items)};if(['openai','anthropic','google'].includes(provider))await streamHostedCore(provider,config,request);else await createProvider(provider,config).streamChat(request);return {sources:snapshots.at(-1),snapshots,text:deltas.join('')}}
test('OpenAI keeps trailing source titles after output item completion, deduplicates and rejects unsafe URLs',async()=>{
 const a=annotation('https://example.com/news','News');const msg={type:'message',id:'m1',content:[{type:'output_text',text:'Result',annotations:[a]}]};
 const result=await run('openai',[{type:'response.output_item.done',item:msg},{type:'response.output_text.annotation.added',item_id:'m1',annotation:annotation('https://example.org/late','Late title')},done([{...msg,content:[{...msg.content[0],annotations:[a,annotation('javascript:alert(1)','Bad'),annotation('https://user:password@example.net','Credentials')]}]}])]);
 assert.deepEqual(result.sources,[{id:'1',url:'https://example.com/news',title:'News'},{id:'2',url:'https://example.org/late',title:'Late title'}]);assert.match(result.text,/\[1\]\(<https:\/\/example.com\/news>\)/);
});
test('Anthropic exposes search result titles and streamed citations',async()=>{
 const result=await run('anthropic',[{type:'content_block_start',index:0,content_block:{type:'server_tool_use',id:'search1',name:'web_search',input:{query:'news'}}},{type:'content_block_stop',index:0},{type:'content_block_start',index:1,content_block:{type:'web_search_tool_result',tool_use_id:'search1',content:[{type:'web_search_result',url:'https://example.com/',title:'News site'}]}},{type:'content_block_stop',index:1},{type:'content_block_start',index:2,content_block:{type:'text',text:'Result'}},{type:'content_block_delta',index:2,delta:{type:'citations_delta',citation:{type:'web_search_result_location',url:'https://example.com/',title:'News site'}}},{type:'content_block_stop',index:2},{type:'message_delta',delta:{stop_reason:'end_turn'}},{type:'message_stop'}]);
 assert.deepEqual(result.sources,[{id:'1',url:'https://example.com/',title:'News site'}]);assert.match(result.text,/\[1\]/);
});
test('Google retains grounding chunk titles without interpreting returned HTML',async()=>{
 const result=await run('google',[{candidates:[{content:{parts:[{text:'Answer'}]},groundingMetadata:{groundingChunks:[{web:{uri:'https://example.com/',title:'Google source'}}],searchEntryPoint:{renderedContent:'<script>bad()</script>'}},finishReason:'STOP'}]}],{tools:['code_execution']});
 assert.deepEqual(result.sources,[{id:'1',url:'https://example.com/',title:'Google source'}]);assert.equal(result.text,'Answer');
});
test('xAI and OpenRouter retain native titles including trailing annotations',async()=>{
 const x=await run('xai',[done([{type:'web_search_call',id:'search1',status:'completed',action:{sources:[{url:'https://example.com/',title:'xAI source'}]}},{type:'message',content:[{type:'output_text',text:'Answer',annotations:[annotation('https://example.com/','xAI source')]}]}])]);
 assert.deepEqual(x.sources,[{id:'1',url:'https://example.com/',title:'xAI source'}]);
 const o=await run('openrouter',[{choices:[{delta:{content:'Answer'},finish_reason:'stop'}]},{choices:[],annotations:[{type:'url_citation',url_citation:{url:'https://example.org/',title:'Router source'}}]},'data: [DONE]\n\n']);
 assert.deepEqual(o.sources,[{id:'1',url:'https://example.org/',title:'Router source'}]);
});
test('Perplexity enriches citation numbers with trailing search titles and keeps reference links',async()=>{
 const result=await run('perplexity',[{choices:[{delta:{content:'Answer [1]'},finish_reason:'stop'}],citations:['https://example.com/','https://example.com/','javascript:bad']},{choices:[],search_results:[{url:'https://example.com/',title:'Sonar result'}]}],{tools:[]});
 assert.deepEqual(result.sources,[{id:'1',url:'https://example.com/',title:'Sonar result'}]);assert.match(result.text,/\[1\]: <https:\/\/example.com\/>/);
});
test('sources are bounded, immutable snapshots with stable IDs across title enrichment',()=>{
 const {createSources}=require('../../../packages/providers/sources.cjs');const snapshots=[];const collector=createSources(s=>snapshots.push(s));
 for(const bad of ['file:///tmp/a','javascript:alert(1)','https://user:secret@example.com','https://example.com/\nspoof','https://example.com/ white','https://example.com/'+ 'x'.repeat(8192)])assert.equal(collector.add(bad,'bad'),undefined);
 collector.add('https://example.com','');collector.add('https://example.com/','Readable title');
 for(let i=1;i<150;i++)collector.add(`https://example.com/${i}`,'🦆'.repeat(1000));
 assert.equal(collector.snapshot().length,100);assert.deepEqual(collector.snapshot()[0],{id:'1',url:'https://example.com/',title:'Readable title'});assert.equal(snapshots[0][0].title,'example.com');assert.ok(collector.snapshot().every(s=>Buffer.byteLength(s.title)<=1000));
 collector.add('https://example.com/','Updated title');assert.equal(collector.snapshot()[0].id,'1');assert.equal(collector.snapshot()[0].title,'Updated title');
});
test('completed search without returned source metadata emits an honest empty list',async()=>{
 const result=await run('openai',[done([{type:'web_search_call',id:'ws1',status:'completed'},{type:'message',id:'m1',content:[{type:'output_text',text:'No citations',annotations:[]}]}])]);assert.deepEqual(result.sources,[]);
});
