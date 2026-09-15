const test = require('node:test')
const assert = require('node:assert/strict')
const {createHandoffCoordinator} = require('../electron/code/handoff.cjs')
const nativeId = '4dab1c34-d7d7-4e77-8a6c-42d1bb5b8c59'
const target = {profile:{id:'b',hostId:'local',launcherFile:'/tmp/profiles.zsh',
  functionName:'claude-team',modes:['chat','terminal']},mode:'terminal'}
const request = {sessionId:'s1',expectedRevision:0,target}
const error = code => Object.assign(new Error('PRIVATE DETAIL'),{code})
function harness(overrides = {}, patch = {}) {
  let row = {id:'s1',hostId:'local',cwd:'/tmp/work',nativeId,profileId:'a',mode:'terminal',
    revision:0,state:'ready',...patch}
  const events = []
  const ports = {
    load:async () => structuredClone(row),
    save:async value => { row = structuredClone(value); events.push(value.state) },
    preflight:async () => { events.push('preflight') },
    stopSource:async () => { events.push('stop') },
    start:async () => { events.push('start'); return {id:'target'} },
    ready:async () => ({nativeId}),
    stopTarget:async () => { events.push('cleanup') },...overrides,
  }
  return {coordinator:createHandoffCoordinator(ports),events,row:() => row,ports}
}

test('commits profile only after source exit and exact native acknowledgement',async () => {
  const h = harness()
  const next = await h.coordinator.switchController(request)
  assert.deepEqual(h.events,['preflight','switching','stop','start','ready'])
  assert.deepEqual(next,{id:'s1',hostId:'local',cwd:'/tmp/work',nativeId,profileId:'b',
    mode:'terminal',revision:2,state:'ready'})
})
test('mode handoff keeps conversation and accepts subsequent profile switch',async () => {
  const h = harness()
  const next = await h.coordinator.switchController({...request,target:{...target,mode:'chat'}})
  assert.equal(next.mode,'chat')
  const again = await h.coordinator.switchController({...request,expectedRevision:2})
  assert.equal(again.mode,'terminal')
  assert.equal(again.nativeId,nativeId)
})
for (const [name,patch,change,code] of [
  ['stale revision',{}, {expectedRevision:1},'STALE_REVISION'],
  ['unknown ownership',{state:'switching'}, {},'RECONCILIATION_REQUIRED'],
  ['unknown conversation',{nativeId:''}, {},'INVALID_SESSION'],
  ['wrong loaded session',{id:'other'}, {},'INVALID_SESSION'],
  ['malformed revision',{revision:-1}, {},'INVALID_SESSION'],
  ['wrong host',{}, {target:{...target,profile:{...target.profile,hostId:'remote'}}},'HOST_MISMATCH'],
]) test(`rejects ${name} without stopping source`,async () => {
  const h = harness({},patch)
  await assert.rejects(h.coordinator.switchController({...request,...change}),{code})
  assert.deepEqual(h.events,[])
})
test('preflight failure leaves source and saved state unchanged',async () => {
  const h = harness({preflight:async () => {throw error('AUTH_REQUIRED')}})
  await assert.rejects(h.coordinator.switchController(request),{code:'PREFLIGHT_FAILED'})
  assert.deepEqual(h.events,[])
  assert.equal(h.row().revision,0)
})
test('unconfirmed source exit never starts target and requires reconciliation',async () => {
  const h = harness({stopSource:async () => {throw error('TIMEOUT')}})
  const next = await h.coordinator.switchController(request)
  assert.equal(next.state,'switching')
  assert.equal(next.recovery.code,'PROCESS_OWNERSHIP_UNKNOWN')
  assert.ok(!h.events.includes('start'))
  await assert.rejects(h.coordinator.switchController({...request,expectedRevision:2}),{code:'RECONCILIATION_REQUIRED'})
})
test('failed target readiness cleans up and retry retains conversation',async () => {
  const h = harness({ready:async () => {throw error('AUTH_REQUIRED')}})
  const failed = await h.coordinator.switchController(request)
  assert.equal(failed.state,'recoverable')
  assert.equal(failed.profileId,'a')
  assert.equal(failed.recovery.code,'TARGET_NOT_READY')
  assert.ok(h.events.includes('cleanup'))
  assert.ok(!JSON.stringify(failed).includes('PRIVATE'))
  h.ports.ready = async () => ({nativeId})
  const next = await h.coordinator.switchController({...request,expectedRevision:2})
  assert.equal(next.nativeId,nativeId)
  assert.equal(next.profileId,'b')
  assert.equal(next.recovery,undefined)
})
test('wrong native acknowledgement cannot commit profile',async () => {
  const h = harness({ready:async () => ({nativeId:'another'})})
  const next = await h.coordinator.switchController(request)
  assert.equal(next.recovery.code,'IDENTITY_MISMATCH')
  assert.equal(next.profileId,'a')
  assert.ok(h.events.includes('cleanup'))
})
test('failed target cleanup remains gated',async () => {
  const h = harness({ready:async () => {throw error('AUTH_REQUIRED')},
    stopTarget:async () => {throw error('TIMEOUT')}})
  const next = await h.coordinator.switchController(request)
  assert.equal(next.state,'switching')
  assert.equal(next.recovery.code,'PROCESS_OWNERSHIP_UNKNOWN')
})
test('startup rejection is conservatively gated because no handle confirms cleanup',async () => {
  const h = harness({start:async () => {throw error('SPAWN_FAILED')}})
  const next = await h.coordinator.switchController(request)
  assert.equal(next.state,'switching')
  assert.ok(!h.events.includes('cleanup'))
})
test('initial persistence failure never stops source',async () => {
  const h = harness({save:async () => {throw error('DISK_FULL')}})
  await assert.rejects(h.coordinator.switchController(request),{code:'PERSISTENCE_FAILED'})
  assert.deepEqual(h.events,['preflight'])
  await assert.rejects(h.coordinator.switchController(request),{code:'RECONCILIATION_REQUIRED'})
})
test('failed success commit stops target and saves recoverable old profile',async () => {
  const h = harness()
  const save = h.ports.save
  h.ports.save = async row => {if (row.state === 'ready') throw error('DISK_FULL'); await save(row)}
  const next = await h.coordinator.switchController(request)
  assert.equal(next.state,'recoverable')
  assert.equal(next.profileId,'a')
  assert.equal(next.recovery.code,'PERSISTENCE_FAILED')
  assert.ok(h.events.includes('cleanup'))
})
test('failed recovery save blocks retry even if storage returns stale ready state',async () => {
  const h = harness({ready:async () => {throw error('AUTH_REQUIRED')}})
  const save = h.ports.save
  h.ports.save = async row => {if (row.revision === 2) throw error('DISK_FULL'); await save(row)}
  await assert.rejects(h.coordinator.switchController(request),{code:'PERSISTENCE_FAILED'})
  h.ports.load = async () => ({id:'s1',state:'ready',revision:0})
  await assert.rejects(h.coordinator.switchController(request),{code:'RECONCILIATION_REQUIRED'})
  assert.ok(h.events.includes('cleanup'))
})
test('competing switch is rejected while the first is awaiting preflight',async () => {
  const gate = Promise.withResolvers()
  const h = harness({preflight:() => gate.promise})
  const first = h.coordinator.switchController(request)
  await assert.rejects(h.coordinator.switchController(request),{code:'SWITCH_IN_PROGRESS'})
  gate.resolve()
  assert.equal((await first).profileId,'b')
})
test('captures target by value before awaiting so caller cannot change launch identity',async () => {
  const gate = Promise.withResolvers()
  const h = harness({preflight:() => gate.promise})
  const mutable = structuredClone(request)
  const first = h.coordinator.switchController(mutable)
  mutable.target.profile.id = 'wrong'
  gate.resolve()
  assert.equal((await first).profileId,'b')
})
test('different sessions can hand off concurrently',async () => {
  const gate = Promise.withResolvers()
  const h = harness()
  h.ports.load = async id => ({...h.row(),id})
  h.ports.preflight = async row => {if (row.id === 's1') await gate.promise}
  const first = h.coordinator.switchController(request)
  const second = await h.coordinator.switchController({...request,sessionId:'s2'})
  assert.equal(second.id,'s2')
  gate.resolve()
  await first
})

test('folder trust gates retain the old conversation and expose the native setup requirement',async()=>{
 const h=harness({ready:async()=>{throw error('PROJECT_TRUST_REQUIRED')}},{model:'sonnet'});
 const next=await h.coordinator.switchController({...request,target:{...target,model:'opus'}});
 assert.equal(next.state,'recoverable');assert.equal(next.recovery.code,'PROJECT_TRUST_REQUIRED');
 assert.equal(next.nativeId,nativeId);assert.equal(next.profileId,'a');assert.equal(next.model,'sonnet');
 assert.ok(h.events.includes('cleanup'));
});
