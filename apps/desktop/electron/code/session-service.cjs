// Launched only inside the dedicated tmux server's singleton zq-service session.
const fs = require('node:fs')
const net = require('node:net')
const {timingSafeEqual} = require('node:crypto')
const {prepareRoot,readCatalog,writeCatalog,uuid,fail} = require('./service-storage.cjs')
const {createTmux,shellCommand} = require('./tmux.cjs')
const {CodeHost} = require('./code-host.cjs')

async function startService(root,tmuxPath) {
  process.umask(0o077)
  const paths = prepareRoot(root)
  const tmux = createTmux({binary:tmuxPath,socket:paths.tmuxSocket})
  const owner = await tmux.inspect('zq-service')
  if (owner?.pid !== process.pid) fail('SERVICE_OWNER_REQUIRED')
  const catalog = readCatalog(paths)
  const codeHost = new CodeHost({paths,tmux})
  let blocked = false, queue = Promise.resolve(), queued = 0
  const sockets = new Set(), leases = new Map()
  const name = id => 'zq-'+id
  const processPresent = pid => {
    if (pid === null) return false
    try {process.kill(pid,0); return true}
    catch (error) {return error.code !== 'ESRCH'}
  }
  function commit(row,state,pid) {
    if (catalog.seq >= Number.MAX_SAFE_INTEGER) fail('STORAGE_UNAVAILABLE')
    row.state = state; row.pid = pid
    catalog.events.push({id:row.id,state,seq:++catalog.seq,at:Date.now()})
    catalog.events = catalog.events.slice(-256)
    try {writeCatalog(paths,catalog)} catch {blocked = true; fail('STORAGE_UNAVAILABLE')}
  }
  async function reconcile(row) {
    const live = await tmux.inspect(name(row.id))
    if (live && row.pid !== null && live.pid !== row.pid) fail('SESSION_IDENTITY_CHANGED')
    // A closed pane is not proof of process exit: programs may ignore SIGHUP.
    // Never signal a saved PID (it may have been reused after a host restart).
    // If it still exists, preserve uncertainty until an operator can reconcile it.
    if (!live && row.state !== 'stopped') {
      if (processPresent(row.pid)) {
        if (row.state !== 'stopping') commit(row,'stopping',row.pid)
      } else commit(row,'stopped',null)
    }
    else if (live && row.state === 'starting') commit(row,'running',live.pid)
    else if (live && row.state === 'stopped') fail('SESSION_IDENTITY_CHANGED')
    return live
  }
  async function dispatch(socket,method,params) {
    if (method.startsWith('code:')) return codeHost.dispatch(socket,method.slice(5),params)
    if (method === 'ping') return {version:1,pid:process.pid}
    if (blocked) fail('STORAGE_UNAVAILABLE')
    if (!params || typeof params !== 'object' || Array.isArray(params)) fail('INVALID_REQUEST')
    if (method === 'list') {
      for (const row of catalog.sessions) await reconcile(row)
      return catalog.sessions.map(row => ({...row}))
    }
    if (method === 'events') {
      if (!Number.isSafeInteger(params.after) || params.after < 0 || params.after > catalog.seq) fail('INVALID_REQUEST')
      return {seq:catalog.seq,truncated:params.after < (catalog.events[0]?.seq ?? 1)-1,
        events:catalog.events.filter(event => event.seq > params.after)}
    }
    const id = params.id
    if (!uuid(id)) fail('INVALID_REQUEST')
    let row = catalog.sessions.find(row => row.id === id)
    if (method === 'create') {
      if (row) {await reconcile(row); return {...row}}
      if (catalog.sessions.length >= 32) fail('SESSION_LIMIT')
      shellCommand(params.launch)
      if (!fs.statSync(params.launch.cwd).isDirectory()) fail('INVALID_REQUEST')
      row = {id,cwd:params.launch.cwd,state:'starting',pid:null,createdAt:Date.now()}
      catalog.sessions.push(row)
      commit(row,'starting',null)
      await tmux.launch(name(id),params.launch)
      await reconcile(row)
      return {...row}
    }
    if (!row) fail('UNKNOWN_SESSION')
    if (method === 'release') {
      if (leases.get(id) === socket) leases.delete(id)
      return {released:true}
    }
    const live = await reconcile(row)
    if (socket.destroyed) fail('INVALID_REQUEST')
    if (method === 'snapshot') {
      let output = ''
      if (live) {
        try {output = await tmux.capture(name(id))}
        catch (error) {if (error.code !== 'TMUX_SESSION_MISSING') throw error; await reconcile(row)}
      }
      return {...row,cols:live?.cols ?? null,rows:live?.rows ?? null,output,seq:catalog.seq}
    }
    if (method === 'claim') {
      if (leases.has(id) && leases.get(id) !== socket) fail('LEASE_HELD')
      leases.set(id,socket)
      return {claimed:true}
    }
    if (!['write','resize','stop'].includes(method)) fail('UNKNOWN_METHOD')
    if (leases.get(id) !== socket) fail('LEASE_REQUIRED')
    if (method === 'stop') {
      if (row.state === 'stopped') return {...row}
      commit(row,'stopping',row.pid)
      await tmux.stop(name(id))
      const deadline = Date.now()+500
      while (processPresent(row.pid) && Date.now()<deadline)
        await new Promise(resolve => setTimeout(resolve,25))
      await reconcile(row)
      if (row.state !== 'stopped') fail('STOP_UNCONFIRMED')
      return {...row}
    }
    if (row.state !== 'running') fail('SESSION_NOT_RUNNING')
    if (method === 'write') {
      if (typeof params.data !== 'string' || Buffer.byteLength(params.data) > 8192 || params.data.includes('\0')) fail('INVALID_REQUEST')
      await tmux.write(name(id),params.data)
    } else {
      if (!Number.isInteger(params.cols) || params.cols < 2 || params.cols > 512
        || !Number.isInteger(params.rows) || params.rows < 2 || params.rows > 200) fail('INVALID_REQUEST')
      await tmux.resize(name(id),params.cols,params.rows)
    }
    return {ok:true}
  }
  // Only tmux's singleton owner may remove a stale endpoint, and never a live one.
  if (fs.existsSync(paths.socket)) {
    if (!fs.lstatSync(paths.socket).isSocket()) fail('UNSAFE_SERVICE_PATH')
    await new Promise((resolve,reject) => {
      const probe = net.createConnection(paths.socket)
      const timer = setTimeout(() => {probe.destroy(); reject(new Error('SERVICE_SOCKET_BUSY'))},500)
      probe.on('connect',() => {clearTimeout(timer); probe.destroy(); reject(new Error('SERVICE_SOCKET_BUSY'))})
      probe.on('error',error => {
        clearTimeout(timer)
        if (!['ECONNREFUSED','ENOENT'].includes(error.code)) return reject(error)
        try {fs.unlinkSync(paths.socket)} catch (error) {if (error.code !== 'ENOENT') return reject(error)}
        resolve()
      })
    })
  }
  const server = net.createServer(socket => {
    if (sockets.size >= 16) {socket.destroy(); return}
    sockets.add(socket); socket.setEncoding('utf8')
    let authenticated = false, buffer = '', pending = 0
    const timer = setTimeout(() => socket.destroy(),2000)
    const send = value => {
      if (socket.destroyed) return
      if (socket.writableLength > 512*1024) {socket.destroy(); return}
      socket.write(JSON.stringify(value)+'\n')
    }
    socket.on('error',() => {})
    socket.on('close',() => {
      clearTimeout(timer); sockets.delete(socket); codeHost.release(socket)
      for (const [id,owner] of leases) if (owner === socket) leases.delete(id)
    })
    socket.on('data',data => {
      buffer += data
      if (Buffer.byteLength(buffer) > 65536) {socket.destroy(); return}
      let end
      while ((end = buffer.indexOf('\n')) >= 0) {
        let message
        try {message = JSON.parse(buffer.slice(0,end))} catch {socket.destroy(); return}
        buffer = buffer.slice(end+1)
        if (!authenticated) {
          if (message?.version !== 1 || typeof message.token !== 'string' || !/^[a-f0-9]{64}$/.test(message.token)
            || !timingSafeEqual(Buffer.from(message.token),Buffer.from(paths.token))) {socket.destroy(); return}
          authenticated = true; clearTimeout(timer); send({version:1,ready:true}); continue
        }
        if (!message || !Number.isSafeInteger(message.id) || typeof message.method !== 'string'
          || pending >= 16 || queued >= 64) {socket.destroy(); return}
        if (message.method.startsWith('code:') && !['code:snapshot','code:events','code:stopSession'].includes(message.method) && codeHost.inputBlocked(message.params?.id)) {send({id:message.id,error:'RECONCILIATION_REQUIRED'}); continue}
        pending++; queued++
        queue = queue.then(async () => {
          try {
            if (socket.destroyed) return
            const result = await dispatch(socket,message.method,message.params)
            send({id:message.id,result})
          } catch (error) {
            const allowed = ['INVALID_REQUEST','INVALID_MODEL','GIT_FETCH_FAILED','UNKNOWN_SESSION','LEASE_HELD','LEASE_REQUIRED','UNKNOWN_METHOD',
              'SESSION_LIMIT','SESSION_NOT_RUNNING','SESSION_IDENTITY_CHANGED','STORAGE_UNAVAILABLE',
              'TMUX_FAILED','TMUX_SESSION_MISSING','STOP_UNCONFIRMED','NOT_FOUND','PROJECT_HAS_SESSIONS','PROFILE_IN_USE','LIMIT_REACHED','MODE_UNSUPPORTED','STALE_REVISION','SESSION_NOT_STOPPED','SESSION_NOT_READY','RECONCILIATION_REQUIRED','SHARED_HISTORY_UNCONFIRMED','IDENTITY_UNVERIFIED','PREFLIGHT_FAILED','SESSION_BUSY','UNKNOWN_PERMISSION','RUNNER_UNAVAILABLE','SWITCH_IN_PROGRESS','RESUME_UNSUPPORTED','PROJECT_SESSION_ACTIVE','EXTERNAL_SESSION_OWNERSHIP','EXTERNAL_TERMINAL_IN_USE','ALREADY_ATTACHED','INVALID_PATH','SYMLINK_NOT_SUPPORTED','PATH_OUTSIDE_PROJECT','INVALID_FILE_TYPE','FILE_TOO_LARGE','BINARY_FILE','FILE_CONFLICT','HARDLINK_NOT_SUPPORTED','GIT_UNAVAILABLE','NOT_GIT_REPOSITORY','IDENTITY_MISMATCH','HOST_MISMATCH']
            send({id:message.id,error:allowed.includes(error.code) ? error.code : 'SERVICE_OPERATION_FAILED'})
          } finally {pending--; queued--}
        })
      }
    })
  })
  await new Promise((resolve,reject) => {server.once('error',reject); server.listen(paths.socket,resolve)})
  return server
}
if (require.main === module) startService(process.argv[2],process.argv[3]).catch(() => process.exit(1))
module.exports = {startService}
