const test = require('node:test')
const assert = require('node:assert/strict')
const {buildClaudeResume} = require('../electron/code/claude-launch.cjs')
const nativeId = '4dab1c34-d7d7-4e77-8a6c-42d1bb5b8c59'
const session = {id:'s1', hostId:'local', cwd:'/tmp/code workspace', nativeId,
  profileId:'a', mode:'terminal', revision:0, state:'ready'}
const profile = {id:'b', hostId:'local', launcherFile:'/tmp/profiles $(touch BAD).zsh',
  functionName:'claude-team', modes:['chat','terminal']}

test('resumes the exact conversation through the selected launcher', () => {
  const launch = buildClaudeResume({profile, session, mode:'terminal'})
  assert.equal(launch.file, '/bin/zsh')
  assert.equal(launch.cwd, session.cwd)
  assert.deepEqual(launch.args.slice(3), [session.cwd, profile.launcherFile, 'claude-team', '--resume', nativeId])
  assert.ok(!launch.args[1].includes(profile.launcherFile))
  assert.equal(launch.env, undefined)
})
test('chat uses the same native identity and structured input/output', () => {
  const launch = buildClaudeResume({profile, session, mode:'chat'})
  assert.deepEqual(launch.args.slice(6), ['--resume',nativeId,'-p','--input-format','stream-json',
    '--output-format','stream-json','--verbose','--include-partial-messages'])
})
for (const [name, change, code] of [
  ['relative launcher', {profile:{launcherFile:'profiles.zsh'}}, 'INVALID_PROFILE'],
  ['empty profile', {profile:{id:''}}, 'INVALID_PROFILE'],
  ['injected function', {profile:{functionName:'claude; false'}}, 'INVALID_PROFILE'],
  ['NUL launcher', {profile:{launcherFile:'/tmp/secret\0'}}, 'INVALID_PROFILE'],
  ['relative cwd', {session:{cwd:'work'}}, 'INVALID_SESSION'],
  ['NUL cwd', {session:{cwd:'/tmp/secret\0'}}, 'INVALID_SESSION'],
  ['empty session', {session:{id:''}}, 'INVALID_SESSION'],
  ['unknown conversation', {session:{nativeId:'latest'}}, 'INVALID_SESSION'],
  ['different host', {profile:{hostId:'remote'}}, 'HOST_MISMATCH'],
  ['unsupported chat', {profile:{modes:['terminal']}, mode:'chat'}, 'MODE_UNSUPPORTED'],
  ['unknown mode', {mode:'other'}, 'MODE_UNSUPPORTED'],
]) test(`rejects ${name} before launch`, () => {
  assert.throws(() => buildClaudeResume({profile:{...profile,...change.profile},
    session:{...session,...change.session}, mode:change.mode || 'terminal'}), error => {
    assert.equal(error.code, code)
    assert.ok(!error.message.includes('secret'))
    return true
  })
})

test('explicit models are positional CLI arguments in both interfaces; default preserves launcher configuration',()=>{
 for(const mode of ['chat','terminal']) {
  const args=buildClaudeResume({profile,session:{...session,model:'opus'},mode}).args;
  assert.equal(args[args.indexOf('--model')+1],'opus');
  assert.equal(buildClaudeResume({profile,session:{...session,model:'default'},mode}).args.includes('--model'),false);
 }
 for(const model of ['', '--evil','a; touch /tmp/bad','x\nsecret']) assert.throws(()=>buildClaudeResume({profile,session:{...session,model},mode:'chat'}),{code:'INVALID_MODEL'});
});
