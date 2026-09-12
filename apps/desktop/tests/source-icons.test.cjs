const {test}=require('node:test'),assert=require('node:assert/strict');
const {createSourceIconService}=require('../electron/source-icons.cjs');
const png=Buffer.from([137,80,78,71,13,10,26,10,1]);
const response=()=>new Response(png,{headers:{'content-type':'image/png'}});
test('favicon requests send only the domain and reuse in-flight and cached results',async()=>{
 const calls=[];const icon=createSourceIconService({fetch:async(url,options)=>{calls.push([url,options]);return response()},normalize:()=> 'data:image/png;base64,aWNvbg=='});
 const values=await Promise.all([icon('https://www.example.com/private?token=secret'),icon('https://www.example.com/other')]);
 assert.deepEqual(values,['data:image/png;base64,aWNvbg==','data:image/png;base64,aWNvbg==']);
 assert.equal(await icon('https://www.example.com/third'),values[0]);assert.equal(calls.length,1);
 const url=new URL(calls[0][0]);assert.equal(url.hostname,'www.google.com');assert.equal(url.searchParams.get('domain'),'www.example.com');assert.ok(!url.href.includes('secret'));assert.equal(calls[0][1].credentials,'omit');
});
test('invalid and private domain inputs never trigger network requests',async()=>{
 let calls=0;const icon=createSourceIconService({fetch:async()=>{calls++;return response()},normalize:()=> 'image'});
 for(const url of [null,{},'file:///etc/passwd','https://user:password@example.com','http://127.0.0.1','http://[::1]','https://printer.local','https://umzorb.ts','http://localhost','https://a.internal'])assert.equal(await icon(url),null);
 assert.equal(calls,0);
});
test('favicon redirects stay on the image service and reject unexpected destinations',async()=>{
 const calls=[];const icon=createSourceIconService({fetch:async url=>{calls.push(String(url));return calls.length===1?new Response(null,{status:302,headers:{location:'https://t3.gstatic.com/faviconV2?url=http://example.com'}}):response()},normalize:()=> 'icon'});
 assert.equal(await icon('https://example.com'),'icon');assert.equal(calls.length,2);
 let blocked=0;const unsafe=createSourceIconService({fetch:async()=>{blocked++;return new Response(null,{status:302,headers:{location:'http://127.0.0.1/private'}})},normalize:()=> 'icon'});
 assert.equal(await unsafe('https://example.com'),null);assert.equal(blocked,1);
});
test('missing, oversized, unsupported and undecodable icons fall back quietly and cache failures briefly',async()=>{
 for(const reply of [()=>new Response('missing',{status:404}),()=>new Response('<svg/>',{headers:{'content-type':'image/svg+xml'}}),()=>new Response(new Uint8Array(131073),{headers:{'content-type':'image/png'}}),()=>{throw Error('offline')}]){
  let calls=0;const icon=createSourceIconService({fetch:async()=>{calls++;return reply()},normalize:()=> 'icon'});assert.equal(await icon('https://example.com'),null);assert.equal(await icon('https://example.com'),null);assert.equal(calls,1);
 }
 const icon=createSourceIconService({fetch:async()=>response(),normalize:()=>null});assert.equal(await icon('https://example.com'),null);
});
