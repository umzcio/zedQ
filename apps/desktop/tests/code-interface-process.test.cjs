const test = require('node:test'),
  assert = require('node:assert/strict'),
  fs = require('node:fs'),
  path = require('node:path'),
  os = require('node:os')
const { execFileSync } = require('node:child_process')
const { CodeService } = require('../electron/code/code-service.cjs')
const tmux = '/opt/homebrew/bin/tmux'
const delay = (ms) => new Promise((r) => setTimeout(r, ms))
async function until(fn) {
  const end = Date.now() + 5000
  while (Date.now() < end) {
    const v = await fn()
    if (v) return v
    await delay(40)
  }
  throw Error('timeout')
}
function setup(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zqi-'))
  const launch = path.join(root, 'profile.zsh')
  fs.writeFileSync(
    launch,
    `claude-a() { exec '${process.execPath}' '${path.join(__dirname, 'fixtures/code/structured-agent.cjs')}' "$@"; }\nclaude-b() { exec '${process.execPath}' '${path.join(__dirname, 'fixtures/code/structured-agent.cjs')}' "$@"; }\n`
  )
  const clients = []
  const service = () => {
    const s = new CodeService({ directory: root, tmuxPath: tmux })
    clients.push(s)
    return s
  }
  t.after(() => {
    for (const c of clients) c.close()
    try {
      execFileSync(tmux, ['-S', path.join(root, 'tmux'), 'kill-server'], {
        stdio: 'ignore'
      })
    } catch {}
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
  })
  return { root, launch, service }
}
test('structured persistent session exact-ID profile/interface roundtrip, permission and reconnect', async (t) => {
  const h = setup(t),
    a = h.service()
  const project = await a.invoke('createProject', { name: 'Work', cwd: h.root })
  const profile = await a.invoke('createProfile', {
    name: 'A',
    launcherFile: h.launch,
    functionName: 'claude-a',
    sharedHistoryConfirmed: true
  })
  const b = await a.invoke('createProfile', {
    name: 'B',
    launcherFile: h.launch,
    functionName: 'claude-b',
    sharedHistoryConfirmed: true
  })
  const s = await a.invoke('createSession', {
    projectId: project.id,
    profileId: profile.id,
    mode: 'chat'
  })
  assert.equal(s.state, 'ready', JSON.stringify(s))
  assert.equal(s.nativeIdVerified, true)
  const observer = h.service()
  await assert.rejects(observer.invoke('claimSession', { id: s.id }), {
    code: 'LEASE_HELD'
  })
  await a.invoke('sendMessage', { id: s.id, text: 'permission' })
  await until(async () =>
    (await a.invoke('events', { id: s.id, after: 0 })).events.some(
      (e) => e.requestId === 'permission-1'
    )
  )
  a.close()
  await until(async () => {
    try {
      await observer.invoke('claimSession', { id: s.id })
      return true
    } catch (e) {
      if (e.code !== 'LEASE_HELD') throw e
    }
  })
  const again = (await observer.invoke('snapshot')).sessions.find(
    (r) => r.id === s.id
  )
  assert.equal(again.pid, s.pid)
  await observer.invoke('respondPermission', {
    id: s.id,
    requestId: 'permission-1',
    allow: false
  })
  await until(async () =>
    (await observer.invoke('events', { id: s.id, after: 0 })).events.some(
      (e) => e.text === 'decision:deny'
    )
  )
  const terminal = await observer.invoke('switchSession', {
    id: s.id,
    expectedRevision: again.revision,
    profileId: b.id,
    mode: 'terminal'
  })
  assert.equal(terminal.state, 'ready')
  assert.equal(terminal.nativeId, s.nativeId)
  assert.equal(terminal.profileId, b.id)
  const chat = await observer.invoke('switchSession', {
    id: s.id,
    expectedRevision: terminal.revision,
    profileId: profile.id,
    mode: 'chat'
  })
  assert.equal(chat.state, 'ready')
  assert.equal(chat.nativeId, s.nativeId)
  await observer.invoke('sendMessage', { id: s.id, text: 'after handoff' })
  const journal = await until(async () => {
    const j = await observer.invoke('events', { id: s.id, after: 0 })
    return j.events.some((e) => e.text === 'reply:after handoff') && j
  })
  assert.equal(
    journal.events.filter((e) => e.kind === 'user' && e.text === 'permission')
      .length,
    1
  )
  const stopped = await observer.invoke('stopSession', {
    id: s.id,
    expectedRevision: chat.revision
  })
  assert.equal(stopped.state, 'stopped')
  const resumed = await observer.invoke('resumeSession', {
    id: s.id,
    expectedRevision: stopped.revision
  })
  assert.equal(resumed.state, 'ready')
  assert.equal(resumed.nativeId, s.nativeId)
})
test('real PTY streams ANSI and closing client detaches owned terminal', async (t) => {
  const h = setup(t),
    a = h.service()
  let output = ''
  a.onTerminal = (c) => {
    output += c.data
  }
  const p = await a.invoke('createProject', { name: 'Work', cwd: h.root })
  const profile = await a.invoke('createProfile', {
    name: 'A',
    launcherFile: h.launch,
    functionName: 'claude-a'
  })
  const s = await a.invoke('createSession', {
    projectId: p.id,
    profileId: profile.id,
    mode: 'terminal'
  })
  assert.equal(s.state, 'ready')
  await a.invoke('attachTerminal', { id: s.id, cols: 90, rows: 25 })
  await until(() => output.includes('terminal:'))
  assert.ok(output.includes('\x1b['))
  await a.invoke('writeTerminal', { id: s.id, data: 'hello\r' })
  await until(() => output.includes('echo:hello'))
  await a.invoke('resizeTerminal', { id: s.id, cols: 110, rows: 35 })
  a.close()
  const b = h.service()
  await until(async () => {
    try {
      await b.invoke('claimSession', { id: s.id })
      return true
    } catch (e) {
      if (e.code !== 'LEASE_HELD') throw e
    }
  })
  assert.equal((await b.invoke('snapshot')).sessions[0].pid, s.pid)
  output = ''
  b.onTerminal = (c) => {
    output += c.data
  }
  await b.invoke('attachTerminal', { id: s.id, cols: 110, rows: 35 })
  await until(() => output.includes('terminal:'))
  assert.equal(
    (await b.invoke('stopSession', { id: s.id, expectedRevision: s.revision }))
      .state,
    'stopped'
  )
})
test('failed target retains original profile and native identity with recoverable state', async (t) => {
  const h = setup(t),
    a = h.service()
  fs.appendFileSync(h.launch, 'claude-fail() { return 1; }\n')
  const p = await a.invoke('createProject', { name: 'Work', cwd: h.root })
  const first = await a.invoke('createProfile', {
    name: 'A',
    launcherFile: h.launch,
    functionName: 'claude-a',
    sharedHistoryConfirmed: true
  })
  const bad = await a.invoke('createProfile', {
    name: 'Bad',
    launcherFile: h.launch,
    functionName: 'claude-fail',
    sharedHistoryConfirmed: true
  })
  const s = await a.invoke('createSession', {
    projectId: p.id,
    profileId: first.id,
    mode: 'chat'
  })
  const failed = await a.invoke('switchSession', {
    id: s.id,
    expectedRevision: s.revision,
    profileId: bad.id,
    mode: 'chat'
  })
  assert.equal(failed.state, 'recoverable')
  assert.equal(failed.profileId, first.id)
  assert.equal(failed.nativeId, s.nativeId)
  const recovered = await a.invoke('resumeSession', {
    id: s.id,
    expectedRevision: failed.revision
  })
  assert.equal(recovered.state, 'ready')
  assert.equal(recovered.nativeId, s.nativeId)
  assert.equal(recovered.recovery, undefined)
  assert.equal(recovered.error, null)
  const snapshot = (await a.invoke('snapshot')).sessions.find(row => row.id === s.id)
  assert.equal(snapshot.state, 'ready')
  assert.equal(snapshot.recovery, undefined)
  assert.equal(snapshot.error, null)
})
test('pending approvals block handoff until explicit interrupt; no decision or prompt is replayed', async (t) => {
  const h = setup(t),
    a = h.service()
  const p = await a.invoke('createProject', { name: 'Work', cwd: h.root })
  const profile = await a.invoke('createProfile', {
    name: 'A',
    launcherFile: h.launch,
    functionName: 'claude-a'
  })
  const s = await a.invoke('createSession', {
    projectId: p.id,
    profileId: profile.id,
    mode: 'chat'
  })
  await a.invoke('sendMessage', { id: s.id, text: 'permission' })
  await until(
    async () => (await a.invoke('snapshot')).sessions[0].state === 'approval'
  )
  await assert.rejects(
    a.invoke('switchSession', {
      id: s.id,
      expectedRevision: s.revision,
      profileId: profile.id,
      mode: 'terminal'
    }),
    { code: 'SESSION_BUSY' }
  )
  await a.invoke('interruptSession', { id: s.id })
  await until(
    async () => (await a.invoke('snapshot')).sessions[0].state === 'ready'
  )
  const switched = await a.invoke('switchSession', {
    id: s.id,
    expectedRevision: s.revision,
    profileId: profile.id,
    mode: 'terminal'
  })
  assert.equal(switched.state, 'ready')
  const chat = await a.invoke('switchSession', {
    id: s.id,
    expectedRevision: switched.revision,
    profileId: profile.id,
    mode: 'chat'
  })
  assert.equal(chat.state, 'ready')
  const journal = await a.invoke('events', { id: s.id, after: 0 })
  assert.equal(journal.events.filter((e) => e.kind === 'user').length, 1)
  assert.ok(!journal.events.some((e) => e.text.startsWith('decision:')))
  await assert.rejects(
    a.invoke('respondPermission', {
      id: s.id,
      requestId: 'permission-1',
      allow: true
    }),
    { code: 'UNKNOWN_PERMISSION' }
  )
})
test('unconfirmed child process exit prevents replacement', async (t) => {
  const h = setup(t),
    a = h.service()
  fs.appendFileSync(
    h.launch,
    `claude-stubborn() { export IGNORE_TERM=1; exec '${process.execPath}' '${path.join(__dirname, 'fixtures/code/structured-agent.cjs')}' "$@"; }\n`
  )
  const p = await a.invoke('createProject', { name: 'Work', cwd: h.root })
  const profile = await a.invoke('createProfile', {
    name: 'A',
    launcherFile: h.launch,
    functionName: 'claude-stubborn'
  })
  const s = await a.invoke('createSession', {
    projectId: p.id,
    profileId: profile.id,
    mode: 'chat'
  })
  const { requestRunner } = require('../electron/code/structured-runner.cjs')
  const status = await requestRunner(
    h.root,
    s.id,
    fs.readFileSync(path.join(h.root, 'token'), 'utf8'),
    'status'
  )
  t.after(() => {
    try {
      process.kill(-status.pid, 'SIGKILL')
    } catch {}
  })
  const next = await a.invoke('switchSession', {
    id: s.id,
    expectedRevision: s.revision,
    profileId: profile.id,
    mode: 'terminal'
  })
  assert.equal(next.state, 'switching')
  assert.equal(next.recovery.code, 'PROCESS_OWNERSHIP_UNKNOWN')
  assert.equal(next.mode, 'chat')
  assert.equal(next.pid, s.pid)
  await assert.rejects(
    a.invoke('sendMessage', { id: s.id, text: 'must not send' }),
    { code: 'RECONCILIATION_REQUIRED' }
  )
  process.kill(-status.pid, 'SIGKILL')
})
test('host service crash reconnects to the same structured runner without replay', async (t) => {
  const h = setup(t),
    a = h.service()
  const p = await a.invoke('createProject', { name: 'Work', cwd: h.root })
  const profile = await a.invoke('createProfile', {
    name: 'A',
    launcherFile: h.launch,
    functionName: 'claude-a'
  })
  const s = await a.invoke('createSession', {
    projectId: p.id,
    profileId: profile.id,
    mode: 'chat'
  })
  await a.invoke('sendMessage', { id: s.id, text: 'before crash' })
  await until(async () =>
    (await a.invoke('events', { id: s.id, after: 0 })).events.some(
      (e) => e.text === 'reply:before crash'
    )
  )
  execFileSync(tmux, [
    '-S',
    path.join(h.root, 'tmux'),
    'kill-session',
    '-t',
    '=zq-service'
  ])
  a.close()
  const b = h.service()
  const recovered = (await b.invoke('snapshot')).sessions[0]
  assert.equal(recovered.pid, s.pid)
  assert.equal(recovered.nativeId, s.nativeId)
  await b.invoke('claimSession', { id: s.id })
  await b.invoke('sendMessage', { id: s.id, text: 'after crash' })
  const journal = await until(async () => {
    const j = await b.invoke('events', { id: s.id, after: 0 })
    return j.events.some((e) => e.text === 'reply:after crash') && j
  })
  assert.equal(journal.events.filter((e) => e.kind === 'user').length, 2)
})
test('runner SIGKILL cannot mark a surviving detached controller stopped or resume it',async t=>{
 const h=setup(t),a=h.service()
 const project=await a.invoke('createProject',{name:'Work',cwd:h.root})
 const profile=await a.invoke('createProfile',{name:'A',launcherFile:h.launch,functionName:'claude-a'})
 const s=await a.invoke('createSession',{projectId:project.id,profileId:profile.id,mode:'chat'})
 const ownership=JSON.parse(fs.readFileSync(path.join(h.root,s.id+'.ownership.json')))
 t.after(()=>{try{process.kill(-ownership.pid,'SIGKILL')}catch{}})
 process.kill(s.pid,'SIGKILL')
 await delay(150)
 const current=(await a.invoke('snapshot')).sessions[0]
 assert.equal(current.state,'switching');assert.equal(current.error,'PROCESS_OWNERSHIP_UNKNOWN')
 process.kill(ownership.pid,0)
 await assert.rejects(a.invoke('resumeSession',{id:s.id,expectedRevision:current.revision}),{code:'RECONCILIATION_REQUIRED'})
 a.close()
 execFileSync(tmux,['-S',path.join(h.root,'tmux'),'kill-session','-t','=zq-service'])
 const b=h.service(),after=(await b.invoke('snapshot')).sessions[0]
 assert.equal(after.state,'switching');assert.equal(after.error,'PROCESS_OWNERSHIP_UNKNOWN')
})
test('wrong cwd identity stays rejected through polling and blocks all input',async t=>{
 const h=setup(t),a=h.service(),wrong=path.join(h.root,'wrong');fs.mkdirSync(wrong)
 fs.appendFileSync(h.launch,`claude-wrong() { cd '${wrong}'; exec '${process.execPath}' '${path.join(__dirname,'fixtures/code/structured-agent.cjs')}' "$@"; }\n`)
 const p=await a.invoke('createProject',{name:'Work',cwd:h.root})
 const profile=await a.invoke('createProfile',{name:'Wrong',launcherFile:h.launch,functionName:'claude-wrong'})
 const s=await a.invoke('createSession',{projectId:p.id,profileId:profile.id,mode:'chat'})
 assert.equal(s.nativeIdVerified,false);assert.equal(s.error,'IDENTITY_MISMATCH')
 const current=(await a.invoke('snapshot')).sessions[0]
 assert.notEqual(current.state,'ready');assert.equal(current.nativeIdVerified,false);assert.equal(current.error,s.error)
 await assert.rejects(a.invoke('sendMessage',{id:s.id,text:'must never send'}))
 const journal=await a.invoke('events',{id:s.id,after:0});assert.ok(!journal.events.some(e=>e.kind==='user'))
})
test('generic installed CLI is a persistent terminal with no injected Claude args or fake resume',async t=>{
 const h=setup(t),a=h.service();fs.appendFileSync(h.launch,`generic-cli() { printf '%s' "$#" > '${h.root}/argc'; exec /bin/cat; }\n`)
 const p=await a.invoke('createProject',{name:'Generic',cwd:h.root})
 const profile=await a.invoke('createProfile',{name:'Local model',launcherFile:h.launch,functionName:'generic-cli',adapter:'terminal'})
 assert.deepEqual(profile.modes,['terminal'])
 const s=await a.invoke('createSession',{projectId:p.id,profileId:profile.id,mode:'terminal'})
 assert.equal(s.state,'ready');assert.equal(s.nativeIdVerified,false);assert.equal(s.nativeId,'')
 await until(()=>fs.existsSync(path.join(h.root,'argc')));assert.equal(fs.readFileSync(path.join(h.root,'argc'),'utf8'),'0')
 a.close();const b=h.service();assert.equal((await b.invoke('snapshot')).sessions[0].pid,s.pid)
 await b.invoke('claimSession',{id:s.id});const stopped=await b.invoke('stopSession',{id:s.id,expectedRevision:0})
 assert.equal(stopped.state,'stopped');await assert.rejects(b.invoke('resumeSession',{id:s.id,expectedRevision:stopped.revision}),{code:'RESUME_UNSUPPORTED'})
})

test('missing receipt cannot be bypassed by ID-only protocol init',async t=>{
 const h=setup(t),a=h.service(),fixture=path.join(h.root,'missing.cjs')
 fs.writeFileSync(fixture,fs.readFileSync(path.join(__dirname,'fixtures/code/structured-agent.cjs'),'utf8').replace('execSync(hook, {','if (false) execSync(hook, {'))
 fs.appendFileSync(h.launch,`claude-missing() { exec '${process.execPath}' '${fixture}' "$@"; }\n`)
 const p=await a.invoke('createProject',{name:'Work',cwd:h.root})
 const profile=await a.invoke('createProfile',{name:'Missing',launcherFile:h.launch,functionName:'claude-missing'})
 const s=await a.invoke('createSession',{projectId:p.id,profileId:profile.id,mode:'chat'})
 assert.equal(s.nativeIdVerified,false);assert.equal(s.error,'IDENTITY_UNVERIFIED')
 const current=(await a.invoke('snapshot')).sessions[0]
 assert.notEqual(current.state,'ready');assert.equal(current.nativeIdVerified,false);assert.equal(current.error,s.error)
 await assert.rejects(a.invoke('sendMessage',{id:s.id,text:'must never send'}))
})

test('slow protocol initialization has time to become ready after a valid receipt',async t=>{
 const h=setup(t),a=h.service(),fixture=path.join(h.root,'slow.cjs')
 fs.writeFileSync(fixture,fs.readFileSync(path.join(__dirname,'fixtures/code/structured-agent.cjs'),'utf8').replace("const out = (m) => process.stdout.write(JSON.stringify(m) + '\\n')", "const out = (m) => { if (m.type === 'control_response') setTimeout(() => process.stdout.write(JSON.stringify(m) + '\\n'), 6000); else process.stdout.write(JSON.stringify(m) + '\\n') }") )
 fs.appendFileSync(h.launch,`claude-slow() { exec '${process.execPath}' '${fixture}' "$@"; }\n`)
 const p=await a.invoke('createProject',{name:'Work',cwd:h.root})
 const profile=await a.invoke('createProfile',{name:'Slow',launcherFile:h.launch,functionName:'claude-slow'})
 const started=Date.now(),s=await a.invoke('createSession',{projectId:p.id,profileId:profile.id,mode:'chat'})
 assert.equal(s.state,'ready');assert.ok(Date.now()-started>=6000);assert.equal(s.nativeIdVerified,true)
})
test('terminal detach/reconnect and stale cleanup after Chat handoff retain selected-session lease',async t=>{
 const h=setup(t),a=h.service(),observer=h.service()
 const p=await a.invoke('createProject',{name:'Work',cwd:h.root})
 const profile=await a.invoke('createProfile',{name:'A',launcherFile:h.launch,functionName:'claude-a'})
 const s=await a.invoke('createSession',{projectId:p.id,profileId:profile.id,mode:'terminal'})
 const first=await a.invoke('attachTerminal',{id:s.id,cols:80,rows:24})
 await a.invoke('detachTerminal',{id:s.id,attachmentId:first.attachmentId})
 await assert.rejects(observer.invoke('claimSession',{id:s.id}),{code:'LEASE_HELD'})
 const second=await a.invoke('attachTerminal',{id:s.id,cols:80,rows:24})
 await a.invoke('writeTerminal',{id:s.id,attachmentId:second.attachmentId,data:'still leased\r'})
 const chat=await a.invoke('switchSession',{id:s.id,expectedRevision:s.revision,profileId:profile.id,mode:'chat'})
 assert.equal(chat.state,'ready')
 await a.invoke('detachTerminal',{id:s.id,attachmentId:second.attachmentId})
 await a.invoke('sendMessage',{id:s.id,text:'same selected lease'})
 await until(async()=>(await a.invoke('events',{id:s.id,after:0})).events.some(e=>e.text==='reply:same selected lease'))
})
test('failed Terminal to Chat target cannot bypass durable native ownership using retained terminal mode',async t=>{
 const h=setup(t),a=h.service(),fixture=path.join(h.root,'never-init.cjs')
 fs.writeFileSync(fixture,"process.stdout.on('error',()=>{});\n"+fs.readFileSync(path.join(__dirname,'fixtures/code/structured-agent.cjs'),'utf8').replace("const out = (m) => process.stdout.write(JSON.stringify(m) + '\\n')", "const out = (m) => { if (m.type !== 'control_response') process.stdout.write(JSON.stringify(m) + '\\n') }"))
 fs.appendFileSync(h.launch,`claude-pending() { exec '${process.execPath}' '${fixture}' "$@"; }\n`)
 const p=await a.invoke('createProject',{name:'Work',cwd:h.root})
 const profile=await a.invoke('createProfile',{name:'Pending',launcherFile:h.launch,functionName:'claude-pending'})
 const s=await a.invoke('createSession',{projectId:p.id,profileId:profile.id,mode:'terminal'})
 const switching=a.invoke('switchSession',{id:s.id,expectedRevision:0,profileId:profile.id,mode:'chat'})
 let target
 await until(()=>{try{const controller=JSON.parse(fs.readFileSync(path.join(h.root,s.id+'.controller.json'))),ownership=JSON.parse(fs.readFileSync(path.join(h.root,s.id+'.ownership.json')));if(controller.mode==='chat'&&ownership.state==='running'){target={controller,ownership};return true}}catch{}})
 t.after(()=>{try{process.kill(-target.ownership.pid,'SIGKILL')}catch{}})
 process.kill(target.controller.pid,'SIGKILL')
 const failed=await switching
 assert.equal(failed.mode,'terminal');assert.equal(failed.state,'switching');assert.equal(failed.recovery.code,'PROCESS_OWNERSHIP_UNKNOWN')
 process.kill(target.ownership.pid,0)
 const current=(await a.invoke('snapshot')).sessions.find(r=>r.id===s.id)
 assert.equal(current.state,'switching')
 await assert.rejects(a.invoke('resumeSession',{id:s.id,expectedRevision:current.revision}),{code:'RECONCILIATION_REQUIRED'})
 assert.equal(JSON.parse(fs.readFileSync(path.join(h.root,s.id+'.ownership.json'))).pid,target.ownership.pid)
})
test('explicit profile setup is interactive without native claims and excludes active project controllers',async t=>{
 const h=setup(t),a=h.service()
 fs.appendFileSync(h.launch,`profile-setup() { printf '%s' "$#" > '${h.root}/setup-argc'; exec /bin/cat; }\n`)
 const p=await a.invoke('createProject',{name:'Work',cwd:h.root})
 const normal=await a.invoke('createProfile',{name:'Normal',launcherFile:h.launch,functionName:'claude-a'})
 const configured=await a.invoke('createProfile',{name:'Claude account',launcherFile:h.launch,functionName:'profile-setup'})
 const original=await a.invoke('createSession',{projectId:p.id,profileId:normal.id,mode:'chat'})
 await assert.rejects(a.invoke('createSetupSession',{projectId:p.id,profileId:configured.id}),{code:'PROJECT_SESSION_ACTIVE'})
 const stopped=await a.invoke('stopSession',{id:original.id,expectedRevision:original.revision})
 const profileCount=(await a.invoke('snapshot')).profiles.length
 const setupSession=await a.invoke('createSetupSession',{projectId:p.id,profileId:configured.id})
 assert.equal(setupSession.state,'ready');assert.equal(setupSession.mode,'terminal');assert.equal(setupSession.adapter,'terminal');assert.equal(setupSession.purpose,'profile-setup')
 assert.equal(setupSession.profileId,configured.id);assert.equal(setupSession.nativeId,'');assert.equal(setupSession.nativeIdVerified,false)
 await until(()=>fs.existsSync(path.join(h.root,'setup-argc')));assert.equal(fs.readFileSync(path.join(h.root,'setup-argc'),'utf8'),'0')
 assert.equal((await a.invoke('snapshot')).profiles.length,profileCount)
 await assert.rejects(a.invoke('resumeSession',{id:original.id,expectedRevision:stopped.revision}),{code:'PROJECT_SESSION_ACTIVE'})
 const attachment=await a.invoke('attachTerminal',{id:setupSession.id,cols:80,rows:24})
 await a.invoke('writeTerminal',{id:setupSession.id,attachmentId:attachment.attachmentId,data:'native setup remains user controlled\r'})
 const setupStopped=await a.invoke('stopSession',{id:setupSession.id,expectedRevision:setupSession.revision})
 await assert.rejects(a.invoke('resumeSession',{id:setupSession.id,expectedRevision:setupStopped.revision}),{code:'RESUME_UNSUPPORTED'})
 const resumed=await a.invoke('resumeSession',{id:original.id,expectedRevision:stopped.revision})
 assert.equal(resumed.state,'ready');assert.equal(resumed.nativeId,original.nativeId)
})
