const test = require('node:test')
const assert = require('node:assert/strict')

const load = () => import('../src/module-recovery.ts')
const record = (version, source = 'installed') => ({manifest:{id:'zq.chat',version},source})

test('execution failures in current and previous packages reach the bundled fallback', async () => {
  const {loadWithRecovery} = await load()
  const current=record('1.0.2'), previous=record('1.0.1'), bundled=record('1.0.0','bundled')
  const attempted=[]
  const result=await loadWithRecovery(current, async candidate => {
    attempted.push(candidate)
    if(candidate.source!=='bundled')throw Error('Broken module code')
    return 'working component'
  }, async failed => failed===current ? previous : bundled)
  assert.deepEqual(attempted,[current,previous,bundled])
  assert.equal(result.record,bundled)
  assert.equal(result.component,'working component')
})

test('a failing bundled module stops when recovery repeats the same package', async () => {
  const {loadWithRecovery} = await load()
  const bundled=record('1.0.0','bundled')
  let executions=0,recoveries=0
  await assert.rejects(loadWithRecovery(bundled,async()=>{executions++;throw Error('Bundled failure')},async()=>{recoveries++;return {...bundled}}),/Bundled failure/)
  assert.equal(executions,1)
  assert.equal(recoveries,1)
})

test('successful execution never changes the selected package through recovery', async () => {
  const {loadWithRecovery} = await load()
  const current=record('1.0.2')
  const result=await loadWithRecovery(current,async()=>42,async()=>{throw Error('Recovery should not run')})
  assert.deepEqual(result,{record:current,component:42})
})

test('same-version bundled code is distinct from an installed artifact', async () => {
  const {loadWithRecovery} = await load()
  const installed=record('1.0.0'), bundled=record('1.0.0','bundled')
  const result=await loadWithRecovery(installed,async candidate=>{
    if(candidate.source==='installed')throw Error('Installed failure')
    return 'bundled component'
  },async()=>bundled)
  assert.equal(result.record,bundled)
})

test('recovery has a fixed attempt limit even when every response has a new version', async () => {
  const {loadWithRecovery} = await load()
  let executions=0
  await assert.rejects(loadWithRecovery(record('1.0.0'),async()=>{executions++;throw Error('Still broken')},async()=>record(`1.0.${executions}`)),/Still broken/)
  assert.equal(executions,3)
})
