'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createWorkspaceSession}=require('../electron/mcp/google-workspace.cjs');
const original={id:'event1',etag:'"version1"',summary:'Design meeting',organizer:{self:true,email:'me@example.test'},start:{dateTime:'2026-09-14T10:00:00-05:00',timeZone:'America/Chicago'},end:{dateTime:'2026-09-14T11:00:00-05:00',timeZone:'America/Chicago'},attendees:[{email:'friend@example.test'}],location:'Office'};
const times={start:{dateTime:'2026-09-15T14:00:00-05:00',timeZone:'America/Chicago'},end:{dateTime:'2026-09-15T15:00:00-05:00',timeZone:'America/Chicago'}};
async function fixture(t,{write=true,event=original,role='owner',mutate}={}){
 const calls=[];const s=await createWorkspaceSession({catalogId:'google-calendar',calendarWriteAccess:()=>write,getToken:async()=> 'test-token',fetchImpl:async(raw,init)=>{const url=new URL(raw);calls.push({url,init});
  if(init.method!=='GET')return mutate?mutate(url,init):init.method==='DELETE'?new Response(null,{status:204}):Response.json({...event,...JSON.parse(init.body),htmlLink:'https://calendar.google.com/calendar/event?eid=fixture'});
  if(url.pathname.includes('/calendarList/'))return Response.json({id:'me@example.test',summary:'Personal',timeZone:'America/Chicago',accessRole:role});
  return Response.json(event);
 }});t.after(()=>s.close());return {...s,calls,call:(name,args)=>s.client.callTool({name,arguments:args}),prepare:(name,args)=>s.prepareCalendarAction(name,args)};
}
test('Calendar creates only the reviewed event, with guest notifications and a single-use native approval',async t=>{
 const f=await fixture(t),args={summary:'Planning',...times,attendees:['friend@example.test'],description:'Review plan',location:'Office'};
 const tools=(await f.client.listTools()).tools;assert.ok(tools.find(t=>t.name==='create_event')?.annotations.readOnlyHint===false);
 const denied=await f.call('create_event',args);assert.equal(denied.isError,true);assert.equal(f.calls.length,0);
 const review=await f.prepare('create_event',args);assert.match(review.detail,/Personal/);assert.match(review.detail,/America\/Chicago/);assert.match(review.detail,/friend@example.test/);assert.match(review.detail,/Notifications:.*all guests/);assert.equal(review.approvalAction,'create_event');assert.ok(f.calls.every(c=>c.init.method==='GET'));
 const result=await f.call('create_event',review.arguments);assert.equal(result.isError,undefined);const write=f.calls.find(c=>c.init.method==='POST');assert.equal(write.url.searchParams.get('sendUpdates'),'all');const body=JSON.parse(write.init.body);assert.equal(body.summary,'Planning');assert.deepEqual(body.attendees,[{email:'friend@example.test'}]);assert.match(body.id,/^[a-f0-9]{32}$/);
 assert.equal((await f.call('create_event',review.arguments)).isError,true);assert.equal(f.calls.filter(c=>c.init.method==='POST').length,1);
});
test('rescheduling changes only start/end and protects the reviewed version with If-Match',async t=>{
 const f=await fixture(t),review=await f.prepare('reschedule_event',{eventId:'event1',...times});assert.match(review.detail,/Before/);assert.match(review.detail,/After/);assert.match(review.detail,/Design meeting/);
 assert.equal((await f.call('reschedule_event',review.arguments)).isError,undefined);const write=f.calls.find(c=>c.init.method==='PATCH');assert.equal(new Headers(write.init.headers).get('if-match'),'"version1"');assert.deepEqual(JSON.parse(write.init.body),times);assert.equal(write.url.searchParams.get('sendUpdates'),'all');
});
test('cancel only deletes the reviewed occurrence; changed versions require a new review',async t=>{
 const f=await fixture(t,{event:{...original,recurringEventId:'series1'},mutate:()=>new Response(null,{status:412})});const review=await f.prepare('cancel_event',{eventId:'event1'});assert.match(review.detail,/Only this occurrence/);
 const result=await f.call('cancel_event',review.arguments);assert.equal(result.isError,true);assert.match(result.content[0].text,/changed after review/);assert.equal(f.calls.at(-1).init.method,'DELETE');assert.equal(new Headers(f.calls.at(-1).init.headers).get('if-match'),'"version1"');
});
test('Calendar handles all-day exclusive end dates and rejects invalid dates, windows, and zones',async t=>{
 const f=await fixture(t),review=await f.prepare('create_event',{summary:'Vacation',start:{date:'2026-09-20'},end:{date:'2026-09-23'}});assert.match(review.detail,/2026-09-20/);assert.match(review.detail,/2026-09-22/);assert.match(review.detail,/All day/);
 for(const change of [
 {start:{date:'2026-02-30'},end:{date:'2026-03-01'}},
 {start:{date:'2026-09-20'},end:{date:'2026-09-20'}},
 {start:{date:'2026-09-20'},end:times.end},
 {start:{dateTime:'2026-09-20T10:00:00'},end:times.end},
 {start:{...times.start,timeZone:'Mars/Olympus'},end:times.end},
 ])await assert.rejects(f.prepare('create_event',{summary:'Invalid',...change}));
 assert.ok(f.calls.every(c=>c.init.method==='GET'));
});
test('read-only grants, calendars and unsupported series never reach a mutation',async t=>{
 for(const options of [{write:false},{role:'reader'},{event:{...original,recurrence:['RRULE:FREQ=WEEKLY']}},{event:{...original,organizer:{self:false}}},{event:{...original,attendeesOmitted:true}},{event:{...original,eventType:'outOfOffice'}}]){
  const f=await fixture(t,options);await assert.rejects(f.prepare('cancel_event',{eventId:'event1'}));assert.ok(f.calls.every(c=>c.init.method==='GET'));
 }
});
test('a reviewed action cannot be changed or used for a different operation',async t=>{
 const f=await fixture(t),review=await f.prepare('create_event',{summary:'Approved',...times});assert.equal((await f.call('create_event',{...review.arguments,summary:'Substituted'})).isError,true);assert.ok(f.calls.every(c=>c.init.method==='GET'));
 const another=await f.prepare('reschedule_event',{eventId:'event1',...times});assert.equal((await f.call('cancel_event',{calendarId:'primary',eventId:'event1',reviewToken:another.arguments.reviewToken})).isError,true);assert.ok(f.calls.every(c=>c.init.method==='GET'));
});
test('uncertain calendar writes are not retried and direct approved cancellation accepts an empty 204 response',async t=>{
 const f=await fixture(t,{mutate:()=>{throw Error('Connection dropped')}}),review=await f.prepare('create_event',{summary:'Uncertain',...times});const result=await f.call('create_event',review.arguments);assert.equal(result.isError,true);assert.match(result.content[0].text,/Check Google Calendar.*Do not retry/i);assert.equal(f.calls.filter(c=>c.init.method==='POST').length,1);
 const good=await fixture(t),cancel=await good.prepare('cancel_event',{eventId:'event1'});const deleted=await good.call('cancel_event',cancel.arguments);assert.equal(deleted.isError,undefined);assert.match(deleted.content[0].text,/cancelled/);
});

test('Calendar does not claim success when a write response cannot identify the approved event',async t=>{
 const f=await fixture(t,{mutate:()=>Response.json({})}),review=await f.prepare('create_event',{summary:'Planning',...times});const result=await f.call('create_event',review.arguments);assert.equal(result.isError,true);assert.match(result.content[0].text,/could not be confirmed/);
});
