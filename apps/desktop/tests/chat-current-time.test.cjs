const test=require('node:test'),assert=require('node:assert/strict');
const {ChatService}=require('../electron/chat-service.cjs');
test('each prompt uses the live clock instead of stale dates from conversation history',t=>{
 t.mock.timers.enable({apis:['Date'],now:new Date('2026-09-13T18:30:00Z')});
 const prompt=()=>ChatService.prototype.prompt.call({},[{role:'user',content:'What is on my calendar today?',context:[]}],null);
 assert.match(prompt()[0].content,/2026-09-13T18:30:00.000Z/);assert.ok(prompt()[0].content.includes(Intl.DateTimeFormat().resolvedOptions().timeZone));
 t.mock.timers.tick(86400000);assert.match(prompt()[0].content,/2026-09-14T18:30:00.000Z/);
});
