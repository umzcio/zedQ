'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createArxivSession}=require('../electron/mcp/arxiv.cjs');
const atom=(entries='')=>`<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom" xmlns:opensearch="http://a9.com/-/spec/opensearch/1.1/"><opensearch:totalResults>2</opensearch:totalResults>${entries}</feed>`;
const paper=(id='2401.12345v2')=>`<entry><id>http://arxiv.org/abs/${id}</id><title>Quantum &amp; gravity</title><summary>A paper\n about gravity &lt;and&gt; light.</summary><author><name>Ada Example</name></author><published>2024-01-23T00:00:00Z</published><updated>2024-02-01T00:00:00Z</updated><category term="gr-qc"/><link href="https://evil.example/steal" title="pdf"/></entry>`;
const response=body=>new Response(body,{headers:{'content-type':'application/atom+xml'}});
async function session(t,fetchImpl,options={}){const s=await createArxivSession({...options,fetchImpl});t.after(()=>s.close());await s.client.listTools();return s;}
const data=result=>JSON.parse(result.content.find(c=>c.type==='text').text);
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(fn){for(let n=0;n<120;n++){if(fn())return;await delay(50)}throw Error('Expected adapter state did not arrive');}

test('arXiv MCP searches with escaped queries and returns abstract metadata and official links',async t=>{
 let requested,init;const s=await session(t,async(url,options)=>{requested=new URL(url);init=options;return response(atom(paper()))});
 const definitions=(await s.client.listTools()).tools;assert.deepEqual(definitions.map(x=>x.name).sort(),['get_paper','search_papers']);assert.ok(definitions.every(x=>x.annotations.readOnlyHint));
 const result=await s.client.callTool({name:'search_papers',arguments:{query:'ti:"quantum & gravity"',maxResults:2,start:10}});
 assert.equal(result.isError,undefined);assert.equal(requested.origin+requested.pathname,'https://export.arxiv.org/api/query');assert.equal(requested.searchParams.get('search_query'),'ti:"quantum & gravity"');assert.equal(requested.searchParams.get('max_results'),'2');assert.equal(requested.searchParams.get('start'),'10');assert.equal(init.redirect,'error');assert.equal(new Headers(init.headers).has('authorization'),false);
 const output=data(result);assert.equal(output.papers[0].id,'2401.12345v2');assert.equal(output.papers[0].title,'Quantum & gravity');assert.equal(output.papers[0].abstract,'A paper about gravity <and> light.');assert.deepEqual(output.papers[0].authors,['Ada Example']);assert.deepEqual(output.papers[0].categories,['gr-qc']);assert.equal(output.totalResults,2);
 assert.deepEqual(result.content.filter(c=>c.type==='resource_link').map(c=>c.uri),['https://arxiv.org/abs/2401.12345v2','https://arxiv.org/pdf/2401.12345v2']);assert.doesNotMatch(JSON.stringify(result),/evil\.example/);
});

test('get_paper supports modern and legacy identifiers with versions',async t=>{
 const ids=[];const s=await session(t,async url=>{const id=new URL(url).searchParams.get('id_list');ids.push(id);return response(atom(paper(id).replace('Quantum &amp; gravity','x'+'🦉'.repeat(180))))});
 for(const id of ['0704.0001','hep-th/9901001v3']){const result=await s.client.callTool({name:'get_paper',arguments:{id}});assert.equal(result.isError,undefined);assert.equal(data(result).papers[0].id,id);assert.ok(result.content.filter(c=>c.type==='resource_link').every(c=>c.title.isWellFormed()&&Buffer.byteLength(c.title)<=1024))}
 assert.deepEqual(ids,['0704.0001','hep-th/9901001v3']);
});

test('invalid identifiers, excessive pages and blank queries never reach arXiv',async t=>{
 let calls=0;const s=await session(t,async()=>{calls++;throw Error('Unexpected fetch')});
 for(const args of [{query:' '},{query:'x',maxResults:11},{query:'x',start:-1},{query:'x',start:30000},{query:'x',maxResults:1.5},{query:'x',extra:true},{query:'x'.repeat(1025)},{query:'x\0'}]){const result=await s.client.callTool({name:'search_papers',arguments:args});assert.equal(result.isError,true)}
 for(const id of ['https://evil.example/x','../../private','2400.12345','2413.12345','2401.12345v0','hep-th/9913001'])assert.equal((await s.client.callTool({name:'get_paper',arguments:{id}})).isError,true);
 assert.equal(calls,0);
});

test('malformed, hostile and excessive XML produces a bounded error without echoing response bodies',async t=>{
 for(const body of ['<feed>unfinished','<!DOCTYPE feed [<!ENTITY secret SYSTEM "file:///private">]><feed>&secret;</feed>',atom(paper().replace('http://arxiv.org/abs/2401.12345v2','https://evil.example/2401.12345v2')),'<html>upstream-secret</html>','x'.repeat(1024*1024+1)]){
  const s=await session(t,async()=>response(body));const result=await s.client.callTool({name:'search_papers',arguments:{query:'gravity'}});assert.equal(result.isError,true);assert.ok(JSON.stringify(result).length<1000);assert.doesNotMatch(JSON.stringify(result),/upstream-secret|file:\/\/|evil\.example/);await s.close();
 }
});

test('rate limit spans independent sessions and a cancelled queued request never fetches',async t=>{
 const starts=[];const fetchImpl=async()=>{starts.push(Date.now());return response(atom(paper()))};const a=await session(t,fetchImpl),b=await session(t,fetchImpl);
 await a.client.callTool({name:'search_papers',arguments:{query:'first'}});
 const controller=new AbortController();const cancelled=b.client.callTool({name:'search_papers',arguments:{query:'cancelled'}},{signal:controller.signal});controller.abort();await assert.rejects(cancelled);await delay(50);
 await b.client.callTool({name:'search_papers',arguments:{query:'second'}});assert.equal(starts.length,2);assert.ok(starts[1]-starts[0]>=2900,`Requests were only ${starts[1]-starts[0]} ms apart`);
});

test('closing a session aborts outstanding arXiv HTTP work and closes the MCP client',async t=>{
 let requestSignal;const s=await session(t,async(_url,{signal})=>{requestSignal=signal;return new Promise((_resolve,reject)=>{signal.addEventListener('abort',()=>reject(Error('private upstream failure')),{once:true})})});
 const pending=s.client.callTool({name:'search_papers',arguments:{query:'gravity'}});const rejected=assert.rejects(pending);await until(()=>requestSignal);await s.close();await rejected;assert.equal(requestSignal.aborted,true);await assert.rejects(s.client.callTool({name:'search_papers',arguments:{query:'after close'}}));
});

test('excessive streamed response is cancelled and bounded before XML parsing',async t=>{
 let cancelled=false;
 const s=await session(t,async()=>new Response(new ReadableStream({pull(controller){controller.enqueue(new Uint8Array(600000))},cancel(){cancelled=true}})));
 const result=await s.client.callTool({name:'search_papers',arguments:{query:'gravity'}});assert.equal(result.isError,true);assert.equal(cancelled,true);assert.ok(JSON.stringify(result).length<1000);
});

test('request cancellation stops an incomplete response body',async t=>{
 let reading=false,cancelled=false;
 const s=await session(t,async()=>new Response(new ReadableStream({pull(){reading=true},cancel(){cancelled=true}})));
 const controller=new AbortController(),pending=s.client.callTool({name:'search_papers',arguments:{query:'gravity'}},{signal:controller.signal});const rejected=assert.rejects(pending);
 await until(()=>reading);controller.abort();await rejected;await until(()=>cancelled);assert.equal(cancelled,true);
});

test('unresponsive HTTP fetch reaches a bounded deadline even when it ignores abort',async t=>{
 let calls=0,requestSignal;const s=await session(t,async(_url,{signal})=>{calls++;requestSignal=signal;return new Promise(()=>{})});
 const started=Date.now();const result=await s.client.callTool({name:'search_papers',arguments:{query:'gravity'}});
 assert.equal(result.isError,true);assert.match(result.content[0].text,/timed out/i);assert.equal(calls,1);assert.equal(requestSignal.aborted,true);assert.ok(Date.now()-started<25000);
});
