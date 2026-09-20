const test = require('node:test'), assert = require('node:assert/strict')
const {NativeSessions} = require('../electron/code/native-sessions.cjs')
const id = '11111111-1111-4111-8111-111111111111'
test('native browser deduplicates shared Codex history and retains independent source failures', async () => {
  const profiles = ['primary','alternate','broken'].map(id => ({id,name:id,hostId:'local',adapter:'codex'}))
  const host = {catalog:{value:{profiles,sessions:[{id:'saved',hostId:'local',adapter:'codex',nativeId:id}]}},codex:{async list(profile){
    if(profile==='broken')throw Object.assign(Error(),{code:'CODEX_DISCOVERY_FAILED'})
    return {sessions:[{nativeId:id,cwd:'/tmp/fixture',title:'One conversation',updatedAt:10}],truncated:false}
  }}}
  const native = new NativeSessions(host), result = await native.list({agent:'codex'})
  assert.equal(result.sessions.length,1)
  assert.deepEqual(result.sessions[0].profileIds,['primary','alternate'])
  assert.equal(result.sessions[0].sessionId,'saved')
  assert.deepEqual(result.errors,[{source:'broken',code:'CODEX_DISCOVERY_FAILED'}])
  host.kimi = {async list(){return {sessions:[{nativeId:id,cwd:'/tmp/fixture',title:'Kimi conversation',updatedAt:20}]}}}
  await native.list({agent:'kimi'})
  assert.equal(native.rows.size,2,'progressive discovery preserves other agents')
})
test('invalid explicit Claude account cannot silently fall back to the default', async () => {
  const native = new NativeSessions({catalog:{value:{profiles:[{id:'default',functionName:'claude',adapter:'claude',hostId:'local'}],sessions:[]}}})
  await assert.rejects(native.open('owner',{agent:'claude',cwd:'/tmp',profileId:'missing'}),{code:'INVALID_PROFILE'})
})
