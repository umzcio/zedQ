const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const {spawn} = require('node:child_process')
const {buildClaudeResume} = require('../electron/code/claude-launch.cjs')
const {createHandoffCoordinator} = require('../electron/code/handoff.cjs')
const nativeId = '4dab1c34-d7d7-4e77-8a6c-42d1bb5b8c59'
const fixture = path.join(__dirname,'fixtures/code/fake-agent.cjs')

function isAlive(pid) {
  try { process.kill(-pid,0); return true }
  catch (error) { if (error.code === 'ESRCH') return false; throw error }
}
function until(promise, ms) {
  let timer
  return Promise.race([promise,new Promise((_,reject) => {
    timer = setTimeout(() => reject(new Error('test process deadline')),ms)
  })]).finally(() => clearTimeout(timer))
}
async function sandbox(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'zq-code-handoff-')))
  const work = path.join(root,'work \' " $dollar\nfolder')
  fs.mkdirSync(work)
  const launcherFile = path.join(root,'profiles $(touch BAD) \' "\n.zsh')
  fs.writeFileSync(launcherFile, `claude-a() { ZQ_TEST_PROFILE=a exec "$ZQ_TEST_NODE" "$ZQ_TEST_AGENT" "$@"; }
claude-b() { ZQ_TEST_PROFILE=b exec "$ZQ_TEST_NODE" "$ZQ_TEST_AGENT" "$@"; }
`)
  const workFile = path.join(work,'edit.txt')
  const memoryFile = path.join(root,'shared-memory.txt')
  fs.writeFileSync(workFile,'keep this edit')
  fs.writeFileSync(memoryFile,'shared configuration marker')
  const lock = path.join(root,'agent.lock')
  const children = new Map()
  let nextId = 0
  const env = {...process.env,HOME:root,ZDOTDIR:root,ZQ_TEST_NODE:process.execPath,
    ZQ_TEST_AGENT:fixture,ZQ_TEST_LOCK:lock}
  delete env.ZQ_TEST_PROFILE
  const profile = id => ({id,hostId:'local',launcherFile,functionName:`claude-${id}`,
    modes:['chat','terminal']})
  let row = {id:path.basename(root),hostId:'local',cwd:work,nativeId,profileId:'a',
    mode:'terminal',revision:0,state:'ready'}
  let source
  let fault = ''
  function start(session,target) {
    const launch = buildClaudeResume({session,profile:target.profile,mode:target.mode})
    const child = spawn(launch.file,launch.args,{cwd:launch.cwd,
      env:{...env,ZQ_TEST_FAULT:fault},detached:true,stdio:['ignore','pipe','pipe']})
    const id = String(++nextId)
    let closed = false
    const close = new Promise(resolve => child.once('close',() => {closed = true; resolve()}))
    const ready = new Promise((resolve,reject) => {
      let output = ''
      const timer = setTimeout(() => reject(new Error('readiness timeout')),5000)
      child.once('error',reject)
      child.once('close',() => {clearTimeout(timer); reject(new Error('agent exited before readiness'))})
      child.stdout.on('data',data => {
        output += data.toString('utf8')
        if (output.length > 8192) { clearTimeout(timer); reject(new Error('oversized readiness')); return }
        const newline = output.indexOf('\n')
        if (newline >= 0) {
          clearTimeout(timer)
          try {resolve(JSON.parse(output.slice(0,newline)))} catch (error) {reject(error)}
        }
      })
    })
    ready.catch(() => {}) // rejection may arrive before the coordinator asks ready()
    child.stderr.resume()
    children.set(id,{child,ready,close,isClosed:() => closed})
    return {id}
  }
  async function stop(handle) {
    if (!handle) return
    const record = children.get(handle.id)
    if (!record || record.isClosed()) return
    try { process.kill(-record.child.pid,'SIGTERM') }
    catch (error) {if (error.code !== 'ESRCH') throw error}
    try { await until(record.close,1500) }
    catch {
      try {process.kill(-record.child.pid,'SIGKILL')} catch (error) {if (error.code !== 'ESRCH') throw error}
      await until(record.close,1500)
    }
    assert.equal(isAlive(record.child.pid),false)
  }
  t.after(async () => {
    try { await Promise.all([...children.keys()].map(id => stop({id}))) }
    finally {fs.rmSync(root,{recursive:true,force:true})}
  })
  source = start(row,{profile:profile('a'),mode:'terminal'})
  const before = await children.get(source.id).ready
  const coordinator = createHandoffCoordinator({
    load:async () => structuredClone(row),
    save:async value => {row = structuredClone(value)},
    preflight:async () => {},
    stopSource:async () => stop(source),
    start:async (session,target) => {source = start(session,target); return source},
    ready:async handle => children.get(handle.id).ready,
    stopTarget:stop,
  })
  return {before,root,workFile,memoryFile,lock,children,
    setFault:value => {fault = value},
    switch:async (id = 'b',mode = 'terminal') => coordinator.switchController({sessionId:row.id,
      expectedRevision:row.revision,target:{profile:profile(id),mode}}),
    current:async () => children.get(source.id).ready,
    stop:async () => stop(source),
  }
}

test('real process handoff retains identity, edits and literal shell-sensitive paths',async t => {
  const original = process.env.ZQ_TEST_PROFILE
  const h = await sandbox(t)
  const next = await h.switch()
  const after = await h.current()
  assert.equal(next.state,'ready')
  assert.equal(after.nativeId,h.before.nativeId)
  assert.equal(after.cwd,h.before.cwd)
  assert.equal(h.before.profile,'a')
  assert.equal(after.profile,'b')
  assert.deepEqual(after.args,['--resume',nativeId])
  assert.equal(fs.readFileSync(h.workFile,'utf8'),'keep this edit')
  assert.equal(fs.readFileSync(h.memoryFile,'utf8'),'shared configuration marker')
  assert.equal(fs.existsSync(path.join(h.before.cwd,'BAD')),false)
  assert.equal(process.env.ZQ_TEST_PROFILE,original)
  assert.equal([...h.children.values()].filter(record => !record.isClosed()).length,1)
  await h.switch('a','chat')
  const back = await h.current()
  assert.equal(back.nativeId,nativeId)
  assert.equal(back.profile,'a')
  assert.ok(back.args.includes('stream-json'))
  await h.stop()
  assert.equal(fs.existsSync(h.lock),false)
})
for (const fault of ['startup','identity']) test(`cleans failed ${fault} target and retries without a new conversation`,async t => {
  const h = await sandbox(t)
  h.setFault(fault)
  const failed = await h.switch()
  assert.equal(failed.state,'recoverable')
  assert.equal(failed.profileId,'a')
  assert.equal(failed.nativeId,nativeId)
  assert.equal(fs.existsSync(h.lock),false)
  assert.equal([...h.children.values()].filter(record => !record.isClosed()).length,0)
  h.setFault('')
  assert.equal((await h.switch()).state,'ready')
  assert.equal((await h.current()).nativeId,nativeId)
})
test('concurrent sessions keep process environments and ownership separate',async t => {
  const [a,b] = await Promise.all([sandbox(t),sandbox(t)])
  await Promise.all([a.switch('b'),b.switch('a')])
  const [first,second] = await Promise.all([a.current(),b.current()])
  assert.equal(first.profile,'b')
  assert.equal(second.profile,'a')
  assert.notEqual(first.cwd,second.cwd)
  assert.notEqual(a.lock,b.lock)
})
