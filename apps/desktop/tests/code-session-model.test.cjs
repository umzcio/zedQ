const test=require('node:test')
const assert=require('node:assert/strict')
const {mergeEvents,canSwitch,canWrite}=require('../../../modules/code/session-model.ts')
test('replayed events replace prior updates and keep order without duplicates',()=>{
 const a={seq:1,text:'first'},b={seq:2,text:'pending'}
 assert.deepEqual(mergeEvents([a,b],[{...b,text:'answered'},{seq:3,text:'next'}]).map(x=>x.text),['first','answered','next'])
 assert.deepEqual(mergeEvents([a],[b],true),[b])
})
test('session controls do not accept writes or handoffs during uncertain ownership',()=>{
 for(const state of ['switching','disconnected','starting','stopped','error'])assert.equal(canWrite({state}),false)
 assert.equal(canSwitch({state:'busy',nativeIdVerified:true}),false)
 assert.equal(canSwitch({state:'ready',nativeIdVerified:false}),false)
 assert.equal(canSwitch({state:'ready',nativeIdVerified:true}),true)
})
test('a resolution event collapses the original permission after incremental replay',()=>{
 const pending={seq:1,kind:'permission',requestId:'p',text:'Allow?'}
 const result=mergeEvents([pending],[{seq:2,kind:'status',requestId:'p',resolved:true,text:'Allowed'}])
 assert.equal(result[0].resolved,true)
 assert.equal(pending.resolved,undefined)
})

test('idle polls preserve the transcript and streaming preserves completed event identity',()=>{
 const original=[{seq:1,eventId:'old',kind:'assistant',text:'Completed Markdown'},{seq:2,eventId:'live',kind:'assistant',text:'Hello'}]
 assert.equal(mergeEvents(original,[]),original)
 const updated=mergeEvents(original,[{seq:3,eventId:'live',kind:'assistant',text:'Hello world'}])
 assert.equal(updated[0],original[0])
 assert.equal(updated.length,2)
 assert.equal(updated[1].text,'Hello world')
})
