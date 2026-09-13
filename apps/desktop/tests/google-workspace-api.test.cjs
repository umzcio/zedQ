'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createWorkspaceSession}=require('../electron/mcp/google-workspace.cjs');
async function fixture(t,catalogId,handler){const calls=[];const s=await createWorkspaceSession({catalogId,getToken:async()=> 'test-token',fetchImpl:async(url,init)=>{calls.push({url:new URL(url),init});assert.equal(new Headers(init.headers).get('authorization'),'Bearer test-token');assert.equal(init.redirect,'error');return handler(new URL(url),init)}});t.after(()=>s.close());return {...s,calls,call:async(name,args)=>s.client.callTool({name,arguments:args})}}
const output=r=>{assert.equal(r.isError,undefined,JSON.stringify(r));return JSON.parse(r.content[0].text)};
test('Calendar lists recurring instances in an explicit timezone-aware window with safe IDs and pagination',async t=>{
 const f=await fixture(t,'google-calendar',()=>Response.json({timeZone:'America/Chicago',nextPageToken:'more',items:[{id:'event1',summary:'Meeting',start:{dateTime:'2026-09-13T10:00:00-05:00'},end:{dateTime:'2026-09-13T11:00:00-05:00'}}]}));
 const result=output(await f.call('list_events',{calendarId:'person@example.test',timeMin:'2026-09-13T00:00:00-05:00',timeMax:'2026-09-14T00:00:00-05:00',pageToken:'opaque+/='}));assert.equal(result.items[0].summary,'Meeting');assert.equal(result.timeZone,'America/Chicago');assert.equal(result.nextPageToken,'more');assert.equal(f.calls[0].url.pathname,'/calendar/v3/calendars/person%40example.test/events');assert.equal(f.calls[0].url.searchParams.get('singleEvents'),'true');assert.equal(f.calls[0].url.searchParams.get('orderBy'),'startTime');assert.equal(f.calls[0].url.searchParams.get('pageToken'),'opaque+/=');
 assert.equal((await f.call('list_events',{calendarId:'../settings',timeMin:'2026-09-13'})).isError,true);assert.equal(f.calls.length,1);
 assert.equal((await f.call('list_events',{timeMin:'2026-09-14T00:00:00Z',timeMax:'2026-09-13T00:00:00Z'})).isError,true);assert.equal(f.calls.length,1);
 const tools=(await f.client.listTools()).tools;assert.ok(tools.every(t=>t.annotations.readOnlyHint));
});
test('Calendar availability uses freebusy without creating events',async t=>{
 const f=await fixture(t,'google-calendar',()=>Response.json({calendars:{primary:{busy:[]}}}));output(await f.call('free_busy',{calendarIds:['primary'],timeMin:'2026-09-13T00:00:00Z',timeMax:'2026-09-14T00:00:00Z'}));assert.equal(f.calls[0].url.pathname,'/calendar/v3/freeBusy');assert.deepEqual(JSON.parse(f.calls[0].init.body).items,[{id:'primary'}]);
});
test('Drive text search escapes query literals, follows pagination, and exports native documents as readable text',async t=>{
 const f=await fixture(t,'google-drive',url=>url.pathname.endsWith('/export')?new Response('Registration details',{headers:{'content-type':'text/plain'}}):url.pathname.endsWith('/files/doc1')?Response.json({id:'doc1',name:'Registration',mimeType:'application/vnd.google-apps.document'}):Response.json({files:[{id:'doc1',name:'Registration',webViewLink:'https://docs.google.com/document/d/doc1/edit'}],nextPageToken:'next'}));
 const data=output(await f.call('search_files',{query:"owner's registration",pageToken:'next+/='}));assert.equal(data.files[0].name,'Registration');assert.equal(f.calls[0].url.searchParams.get('q'),"trashed = false and fullText contains 'owner\\'s registration'");assert.equal(f.calls[0].url.searchParams.get('pageToken'),'next+/=');
 const read=output(await f.call('read_file',{fileId:'doc1'}));assert.equal(read.text,'Registration details');assert.equal(f.calls.at(-1).url.searchParams.get('mimeType'),'text/plain');assert.equal((await f.call('read_file',{fileId:'../other'})).isError,true);
});
test('Google API failures are sanitized and auth refresh retries only once',async t=>{
 let attempts=0;const f=await fixture(t,'google-drive',()=>++attempts===1?new Response(null,{status:401}):Response.json({error:{message:'secret server message'}},{status:403}));const result=await f.call('search_files',{query:'anything'});assert.equal(result.isError,true);assert.match(result.content[0].text,/Reconnect/);assert.ok(!JSON.stringify(result).includes('secret server'));assert.equal(attempts,2);
});
