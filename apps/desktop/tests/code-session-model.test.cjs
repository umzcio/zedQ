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
