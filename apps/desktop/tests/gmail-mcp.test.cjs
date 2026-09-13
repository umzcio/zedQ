'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createGmailSession}=require('../electron/mcp/gmail.cjs');
const message={id:'abc123',threadId:'def456',snippet:'Concert tickets',labelIds:['INBOX'],payload:{mimeType:'multipart/alternative',headers:[{name:'Subject',value:'Concert tickets'},{name:'From',value:'tickets@example.test'}],parts:[{mimeType:'text/plain',body:{data:Buffer.from('Your concert tickets are ready.').toString('base64url')}},{mimeType:'text/html',body:{data:Buffer.from('<p>Tickets</p>').toString('base64url')}}]}};
async function fixture(t,handler){const calls=[];const session=await createGmailSession({getToken:async()=> 'fixture-token',fetchImpl:async(url,init)=>{calls.push({url:new URL(url),init});assert.equal(new Headers(init.headers).get('authorization'),'Bearer fixture-token');assert.equal(init.redirect,'error');return handler(new URL(url),init,calls.length)}});t.after(()=>session.close());return {...session,calls,call:async(name,args)=>session.client.callTool({name,arguments:args})}}
const output=r=>{assert.equal(r.isError,undefined,JSON.stringify(r));return JSON.parse(r.content[0].text)};
test('Gmail search uses standard API query and pagination and returns readable thread metadata',async t=>{
 const f=await fixture(t,url=>url.pathname.endsWith('/threads')?Response.json({threads:[{id:'def456'}],nextPageToken:'next-page',resultSizeEstimate:2}):Response.json({id:'def456',messages:[message]}));
 const result=output(await f.call('search_threads',{query:'concert',pageSize:5,pageToken:'opaque+/='}));
 assert.equal(f.calls[0].url.origin,'https://gmail.googleapis.com');assert.equal(f.calls[0].url.pathname,'/gmail/v1/users/me/threads');assert.equal(f.calls[0].url.searchParams.get('q'),'concert');assert.equal(f.calls[0].url.searchParams.get('pageToken'),'opaque+/=');assert.equal(f.calls[0].url.searchParams.get('maxResults'),'5');assert.equal(result.nextPageToken,'next-page');assert.equal(result.threads[0].messages[0].subject,'Concert tickets');assert.equal(result.threads[0].messages[0].body,undefined);
 const read=output(await f.call('get_thread',{threadId:'def456'}));assert.equal(read.messages[0].body,'Your concert tickets are ready.');assert.ok(!JSON.stringify(read).includes('<p>'));assert.ok(!JSON.stringify(read).includes('fixture-token'));
});
test('creating a Gmail draft never sends email',async t=>{
 const f=await fixture(t,()=>Response.json({id:'draft1',message:{id:'abc123',threadId:'def456'}}));
 const tools=(await f.client.listTools()).tools;assert.ok(!tools.some(t=>/trash|delete/.test(t.name)));assert.equal(tools.find(t=>t.name==='create_draft').annotations.readOnlyHint,false);
 const result=output(await f.call('create_draft',{to:['test@example.test'],subject:'Hello 🌎',body:'A draft\nTwo lines'}));assert.equal(result.id,'draft1');assert.equal(f.calls.length,1);assert.equal(f.calls[0].url.pathname,'/gmail/v1/users/me/drafts');assert.equal(f.calls[0].init.method,'POST');const mime=Buffer.from(JSON.parse(f.calls[0].init.body).message.raw,'base64url').toString();assert.match(mime,/To: test@example.test/);assert.match(mime,/Content-Transfer-Encoding: base64/);assert.ok(mime.includes(Buffer.from('A draft\nTwo lines').toString('base64')));
 const rejected=await f.call('create_draft',{to:['test@example.test\r\nBcc: stolen@example.test'],body:'no'});assert.equal(rejected.isError,true);assert.equal(f.calls.length,1);
});
test('Gmail rejects unsafe IDs and returns actionable API failures without leaking server data',async t=>{
 const f=await fixture(t,()=>Response.json({error:{message:'private-token-and-mail',errors:[{reason:'accessNotConfigured'}]}},{status:403}));
 assert.equal((await f.call('get_message',{messageId:'../../settings'})).isError,true);assert.equal(f.calls.length,0);
 const result=await f.call('search_threads',{query:'concert'});assert.equal(result.isError,true);assert.match(result.content[0].text,/enable.*Gmail API/i);assert.ok(!JSON.stringify(result).includes('private-token'));
});
test('Gmail refreshes once on rejected auth, cancels requests, and does not retry ambiguous draft writes',async t=>{
 let tokens=[];const s=await createGmailSession({getToken:async force=>{tokens.push(!!force);return force?'new-token':'old-token'},fetchImpl:async(_,init)=>new Headers(init.headers).get('authorization')==='Bearer old-token'?new Response(null,{status:401}):Response.json({labels:[]})});t.after(()=>s.close());assert.equal((await s.client.callTool({name:'list_labels',arguments:{}})).isError,undefined);assert.deepEqual(tokens,[false,true]);
 const f=await fixture(t,()=>{throw Error('socket reset')});assert.equal((await f.call('create_draft',{body:'draft'})).isError,true);assert.equal(f.calls.length,1);
 const controller=new AbortController();const cancel=await createGmailSession({signal:controller.signal,getToken:async()=> 'token',fetchImpl:(_,init)=>new Promise((_,reject)=>init.signal.addEventListener('abort',()=>reject(init.signal.reason),{once:true}))});t.after(()=>cancel.close());const pending=cancel.client.callTool({name:'list_labels',arguments:{}});const rejected=assert.rejects(pending);controller.abort();await rejected;
});

test('large Gmail conversations remain bounded and disclose omitted content',async t=>{
 const long={...message,payload:{...message.payload,mimeType:'text/plain',parts:undefined,body:{data:Buffer.from('x'.repeat(30000)).toString('base64url')}}};
 const f=await fixture(t,()=>Response.json({id:'def456',messages:Array.from({length:20},()=>long)}));const result=await f.call('get_thread',{threadId:'def456'});const data=output(result);assert.equal(data.messagesTruncated,true);assert.equal(data.totalMessages,20);assert.ok(data.messages.every(m=>m.bodyTruncated));assert.ok(Buffer.byteLength(JSON.stringify(result))<90000);
});

test('sending requires a reviewed snapshot, sends that exact MIME once, and rejects changed drafts',async t=>{
 const draftMessage={...message,payload:{mimeType:'text/plain',headers:[{name:'To',value:'friend@example.test'},{name:'Bcc',value:'copy@example.test'},{name:'Subject',value:'Poem'}],body:{data:Buffer.from('Hello friend').toString('base64url')}}};let raw=Buffer.from('To: friend@example.test\r\nSubject: Poem\r\n\r\nHello friend').toString('base64url');
 const f=await fixture(t,(url,init)=>init.method==='POST'?Response.json({id:'sent1',threadId:'def456'}):Response.json({id:'draft1',message:{...draftMessage,...(url.searchParams.get('format')==='raw'?{raw}:{})}}));
 assert.equal(typeof f.prepareSend,'function');
 assert.equal((await f.call('send_draft',{draftId:'draft1'})).isError,true);assert.equal(f.calls.length,0);
 const review=await f.prepareSend('draft1');assert.match(review.detail,/friend@example.test/);assert.match(review.detail,/Bcc: copy@example.test/);assert.match(review.detail,/Hello friend/);
 const result=output(await f.call('send_draft',review.arguments));assert.equal(result.id,'sent1');const sent=f.calls.filter(c=>c.init.method==='POST');assert.equal(sent.length,1);assert.equal(sent[0].url.pathname,'/gmail/v1/users/me/drafts/send');assert.deepEqual(JSON.parse(sent[0].init.body),{id:'draft1',message:{raw}});
 assert.equal((await f.call('send_draft',review.arguments)).isError,true);assert.equal(f.calls.filter(c=>c.init.method==='POST').length,1);
 const changed=await f.prepareSend('draft1');raw=Buffer.from('changed').toString('base64url');assert.match((await f.call('send_draft',changed.arguments)).content[0].text,/changed/i);assert.equal(f.calls.filter(c=>c.init.method==='POST').length,1);
});
test('an uncertain send is not retried and directs the user to Sent',async t=>{
 const f=await fixture(t,(url,init)=>{if(init.method==='POST')throw Error('socket reset');return Response.json({id:'draft1',message:{...message,raw:'aGVsbG8'}})});
 assert.equal(typeof f.prepareSend,'function');const review=await f.prepareSend('draft1');const result=await f.call('send_draft',review.arguments);assert.equal(result.isError,true);assert.match(result.content[0].text,/Sent/);assert.equal((await f.call('send_draft',review.arguments)).isError,true);assert.equal(f.calls.filter(c=>c.init.method==='POST').length,1);
});
