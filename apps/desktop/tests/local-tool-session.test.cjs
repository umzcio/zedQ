const {test}=require('node:test'),assert=require('node:assert/strict');
const {createToolSession}=require('../../../packages/providers/local-tools.cjs');
const definitions=[{name:'read_document',description:'Read',parameters:{type:'object',properties:{id:{type:'string'}}}}];
test('local tool session rejects malformed/unknown calls before side effects and reuses identical call IDs',async()=>{
 let calls=0;const session=createToolSession(definitions,async()=>{calls++;return{ok:true}},()=>{});
 await assert.rejects(session.execute({id:'a',name:'shell',arguments:{}}));assert.equal(calls,0);
 await assert.rejects(session.execute({id:'a',name:'read_document',arguments:'{'}));assert.equal(calls,0);
 const input={id:'a',name:'read_document',arguments:{id:'doc'}};assert.equal(await session.execute(input),'{"ok":true}');assert.equal(await session.execute(input),'{"ok":true}');assert.equal(calls,1);
 await assert.rejects(session.execute({...input,arguments:{id:'other'}}));assert.equal(calls,1);
});
test('local tool session checks cancellation and limits calls and JSON sizes',async()=>{
 let stopped=false,calls=0;const session=createToolSession(definitions,async()=>{calls++;return{content:'ok'}},()=>{if(stopped)throw Error('Stopped')});
 for(let i=0;i<12;i++)await session.execute({id:String(i),name:'read_document',arguments:{}});
 await assert.rejects(session.execute({id:'13',name:'read_document',arguments:{}}),/limit/i);assert.equal(calls,12);
 stopped=true;await assert.rejects(session.execute({id:'0',name:'read_document',arguments:{}}),/Stopped/);
 const large=createToolSession(definitions,async()=>({content:'x'.repeat(130000)}),()=>{});await assert.rejects(large.execute({id:'big',name:'read_document',arguments:{}}),/limit|large|120/i);
});
test('local execution deadline and abort bound hung callbacks and redact callback errors',async()=>{
 const input={id:'a',name:'read_document',arguments:{}};
 const timeout=createToolSession(definitions,()=>new Promise(()=>{}),()=>{},{totalMs:15});
 await assert.rejects(timeout.execute(input),e=>e.code==='TOTAL_TIMEOUT');
 const c=new AbortController(),abort=createToolSession(definitions,()=>new Promise(()=>{}),()=>{},{signal:c.signal,totalMs:1000});
 const pending=abort.execute(input);c.abort();await assert.rejects(pending,e=>e.code==='ABORTED');
 const bad=createToolSession(definitions,()=>{throw Error('secret path API_KEY')});
 await assert.rejects(bad.execute(input),e=>!e.message.includes('API_KEY')&&e.code==='LOCAL_TOOL_ERROR');
});
