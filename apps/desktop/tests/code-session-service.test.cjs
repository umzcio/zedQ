const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const net = require('node:net')
const {randomUUID} = require('node:crypto')
const {execFileSync,execFile} = require('node:child_process')
const {connectCodeService} = require('../electron/code/session-client.cjs')
const tmuxPath = '/opt/homebrew/bin/tmux'
async function until(fn) {
  const end = Date.now()+10000
  while (Date.now()<end) {
    const value = await fn()
    if (value) return value
    await new Promise(resolve => setTimeout(resolve,30))
  }
  throw new Error('test deadline')
}
function setup(t, environment = {}) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'zq-persist-')))
  const clients = []
  const env = {...process.env,HOME:root,ZDOTDIR:root,...environment}
  delete env.TMUX
  const options = {root,tmuxPath,env}
  const tmux = args => execFileSync(tmuxPath,['-S',path.join(root,'tmux'),...args],{env,encoding:'utf8',stdio:['ignore','pipe','pipe']})
  t.after(() => {
    for (const client of clients) client.close()
    try {tmux(['kill-server'])} catch {}
    fs.rmSync(root,{recursive:true,force:true})
  })
  const connect = async () => {const client = await connectCodeService(options); clients.push(client); return client}
  const id = randomUUID()
  const launch = {file:process.execPath,args:[path.join(__dirname,'fixtures/code/interactive-agent.cjs'),
    'literal $(touch BAD) ; " \' $text'],cwd:root}
  return {root,options,connect,tmux,id,launch}
}
async function start(h,client) {
  await client.request('create',{id:h.id,launch:h.launch})
  return until(async () => {
    const snap = await client.request('snapshot',{id:h.id})
    return snap.output.includes('agent-ready') && snap
  })
}
test('desktop startup without a UTF-8 locale connects and retains session ownership',async t => {
  const h = setup(t,{LC_ALL:'C',LANG:'C',PATH:'/usr/bin:/bin:/usr/sbin:/sbin'})
  const client = await h.connect()
  const before = await start(h,client)
  const helper = await client.request('ping')
  client.close()
  const next = await h.connect()
  assert.equal((await next.request('ping')).pid,helper.pid)
  assert.equal((await next.request('snapshot',{id:h.id})).pid,before.pid)
  await next.request('claim',{id:h.id})
  await next.request('stop',{id:h.id})
})
test('client disconnect preserves process, screen and exclusive input ownership',async t => {
  const h = setup(t)
  const first = await h.connect()
  const before = await start(h,first)
  assert.ok(before.pid > 0)
  assert.match(before.output, /"runAsNode":null/)
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(h.root,'agent-args.json'),'utf8')),h.launch.args.slice(1))
  await first.request('claim',{id:h.id})
  const observer = await h.connect()
  for (const [method,params] of [['write',{data:'bad'}],['resize',{cols:90,rows:30}],['stop',{}]]) {
    await assert.rejects(observer.request(method,{id:h.id,...params}),{code:'LEASE_REQUIRED'})
  }
  await assert.rejects(observer.request('claim',{id:h.id}),{code:'LEASE_HELD'})
  first.close()
  await until(async () => {
    try {await observer.request('claim',{id:h.id}); return true}
    catch (error) {if (error.code !== 'LEASE_HELD') throw error}
  })
  await observer.request('write',{id:h.id,data:'after reconnect\r'})
  const after = await until(async () => {
    const snap = await observer.request('snapshot',{id:h.id})
    return snap.output.includes('echo:after reconnect') && snap
  })
  assert.equal(after.pid,before.pid)
  for (const literal of [';','abc;','\\;','abc\\;','é🦉']) {
    await observer.request('write',{id:h.id,data:literal})
    await observer.request('write',{id:h.id,data:'\r'})
    await until(async () => (await observer.request('snapshot',{id:h.id})).output.includes('echo:'+literal))
  }
  await observer.request('resize',{id:h.id,cols:90,rows:30})
  const sized = await observer.request('snapshot',{id:h.id})
  assert.equal(sized.cols,90)
  assert.equal(sized.rows,30)
  assert.equal((await observer.request('create',{id:h.id,launch:h.launch})).pid,before.pid)
  assert.equal(fs.existsSync(path.join(h.root,'BAD')),false)
  const catalog = fs.readFileSync(path.join(h.root,'catalog.json'),'utf8')
  assert.ok(!catalog.includes('literal'))
  assert.ok(!catalog.includes('after reconnect'))
  await observer.request('stop',{id:h.id})
  assert.equal((await observer.request('snapshot',{id:h.id})).state,'stopped')
})
test('service crash and concurrent reconnect retain one service and the same agent',async t => {
  const h = setup(t)
  const client = await h.connect()
  const before = await start(h,client)
  const oldService = await client.request('ping')
  await client.request('claim',{id:h.id})
  const cursor = (await client.request('events',{after:0})).seq
  h.tmux(['kill-session','-t','=zq-service'])
  await until(() => {try {process.kill(oldService.pid,0); return false} catch {return true}})
  const [a,b] = await Promise.all([h.connect(),h.connect()])
  assert.equal((await a.request('ping')).pid,(await b.request('ping')).pid)
  assert.notEqual((await a.request('ping')).pid,oldService.pid)
  assert.equal((await a.request('snapshot',{id:h.id})).pid,before.pid)
  await a.request('claim',{id:h.id})
  await a.request('write',{id:h.id,data:'survived crash\r'})
  await until(async () => (await a.request('snapshot',{id:h.id})).output.includes('echo:survived crash'))
  await a.request('stop',{id:h.id})
  const replay = await a.request('events',{after:cursor})
  assert.ok(replay.events.length > 0)
  assert.ok(replay.events.every(event => event.seq > cursor))
})
test('lost tmux server reports stopped and never silently respawns the agent',async t => {
  const h = setup(t)
  const client = await h.connect()
  await start(h,client)
  h.tmux(['kill-server'])
  await until(() => {try {h.tmux(['has-session','-t','=zq-service']); return false} catch {return true}})
  const next = await h.connect()
  const snapshot = await next.request('snapshot',{id:h.id})
  assert.equal(snapshot.state,'stopped')
  assert.equal(snapshot.pid,null)
  assert.equal((await next.request('create',{id:h.id,launch:h.launch})).state,'stopped')
})
test('rejects invalid protocol, credentials, oversized frames and foreign sessions',async t => {
  const h = setup(t)
  const client = await h.connect()
  const before = await start(h,client)
  const token = fs.readFileSync(path.join(h.root,'token'),'utf8')
  async function rejected(data) {
    const socket = net.createConnection(path.join(h.root,'ipc'))
    await new Promise((resolve,reject) => {
      const timer = setTimeout(() => {socket.destroy(); reject(new Error('socket not rejected'))},3000)
      socket.on('error',() => {})
      socket.on('close',() => {clearTimeout(timer); resolve()})
      socket.on('connect',() => socket.write(data))
      socket.resume()
    })
  }
  await rejected(JSON.stringify({version:2,token})+'\n')
  await rejected(JSON.stringify({version:1,token:'wrong'})+'\n')
  await rejected(JSON.stringify({version:1,token:'é'.repeat(64)})+'\n')
  await rejected('x'.repeat(128*1024))
  await assert.rejects(client.request('snapshot',{id:randomUUID()}),{code:'UNKNOWN_SESSION'})
  await client.request('claim',{id:h.id})
  await assert.rejects(client.request('write',{id:h.id,data:'x'.repeat(8193)}),{code:'INVALID_REQUEST'})
  assert.equal((await client.request('snapshot',{id:h.id})).pid,before.pid)
})

test('storage failure gates mutation before spawning and preserves existing session',async t => {
  const h = setup(t)
  const client = await h.connect()
  const before = await start(h,client)
  const file = path.join(h.root,'catalog.json')
  const prior = fs.readFileSync(file,'utf8')
  fs.chmodSync(file,0o644)
  await assert.rejects(client.request('create',{id:randomUUID(),launch:h.launch}),{code:'STORAGE_UNAVAILABLE'})
  assert.equal(fs.readFileSync(file,'utf8'),prior)
  await assert.rejects(client.request('list'),{code:'STORAGE_UNAVAILABLE'})
  fs.chmodSync(file,0o600)
  h.tmux(['kill-session','-t','=zq-service'])
  const next = await h.connect()
  assert.equal((await next.request('snapshot',{id:h.id})).pid,before.pid)
  assert.equal((await next.request('list')).length,1)
})

test('reconciles interrupted creation without replaying the launch',async t => {
  const h = setup(t)
  const client = await h.connect()
  const before = await start(h,client)
  h.tmux(['kill-session','-t','=zq-service'])
  const {prepareRoot,readCatalog,writeCatalog} = require('../electron/code/service-storage.cjs')
  const paths = prepareRoot(h.root), state = readCatalog(paths)
  state.sessions[0].state = 'starting'; state.sessions[0].pid = null
  writeCatalog(paths,state)
  const next = await h.connect()
  assert.equal((await next.request('create',{id:h.id,launch:h.launch})).pid,before.pid)
})

test('replay identifies truncated history and rejects future cursors',async t => {
  const h = setup(t)
  const {prepareRoot,writeCatalog} = require('../electron/code/service-storage.cjs')
  const events = Array.from({length:256},(_,i) => ({id:h.id,state:'stopped',seq:i+45,at:Date.now()}))
  writeCatalog(prepareRoot(h.root),{version:1,seq:300,
    sessions:[{id:h.id,cwd:h.root,state:'stopped',pid:null,createdAt:Date.now()}],events})
  const client = await h.connect()
  const replay = await client.request('events',{after:0})
  assert.equal(replay.truncated,true)
  assert.equal(replay.events.length,256)
  assert.equal((await client.request('events',{after:300})).events.length,0)
  await assert.rejects(client.request('events',{after:301}),{code:'INVALID_REQUEST'})
})

test('Stop remains unconfirmed while the owned process ignores hang-up',async t => {
  const h = setup(t)
  h.launch.args.push('--ignore-hup')
  const client = await h.connect()
  const before = await start(h,client)
  t.after(() => {try {process.kill(before.pid,'SIGKILL')} catch (error) {if (error.code !== 'ESRCH') throw error}})
  await client.request('claim',{id:h.id})
  await assert.rejects(client.request('stop',{id:h.id}),{code:'STOP_UNCONFIRMED'})
  const uncertain = await client.request('snapshot',{id:h.id})
  assert.equal(uncertain.state,'stopping')
  assert.equal(uncertain.pid,before.pid)
  process.kill(before.pid,'SIGKILL')
  await until(async () => (await client.request('snapshot',{id:h.id})).state === 'stopped')
})

test('entire client process can exit and another process resumes the same terminal',async t => {
  const h = setup(t)
  const before = await new Promise((resolve,reject) => execFile(process.execPath,
    [path.join(__dirname,'fixtures/code/service-client-process.cjs'),h.root,tmuxPath,h.id],
    {env:{...process.env,HOME:h.root,ZDOTDIR:h.root},encoding:'utf8',timeout:10000},
    (error,stdout) => {if (error) reject(error); else resolve(JSON.parse(stdout))}))
  const next = await h.connect()
  assert.equal((await next.request('snapshot',{id:h.id})).pid,before.pid)
  await next.request('claim',{id:h.id})
  await next.request('write',{id:h.id,data:'new client process\r'})
  await until(async () => (await next.request('snapshot',{id:h.id})).output.includes('echo:new client process'))
})
