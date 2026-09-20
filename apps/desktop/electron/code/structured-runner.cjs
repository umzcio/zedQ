// Persistent protocol owner. This process lives inside tmux, independently of the app client.
const fs = require('node:fs'),
  net = require('node:net'),
  path = require('node:path')
const { spawn } = require('node:child_process')
const { timingSafeEqual, randomUUID } = require('node:crypto')
const { CodexProtocol } = require('./codex-protocol.cjs')
const { KimiProtocol } = require('./kimi-protocol.cjs')
const { ClaudeProtocol } = require('./claude-protocol.cjs')
const { atomic, privateRead } = require('./code-catalog.cjs')
const { fail } = require('./service-storage.cjs')
const { groupAbsent } = require('./process-ownership.cjs')
const endpoint = (root, id) =>
  path.join(
    root,
    'r-' + Buffer.from(id.replaceAll('-', ''), 'hex').toString('base64url')
  )
async function requestRunner(root, id, token, method, input = {}) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(endpoint(root, id))
    let buffer = '',
      settled = false
    const timer = setTimeout(() => {
      socket.destroy()
      reject(
        Object.assign(new Error('RUNNER_TIMEOUT'), { code: 'RUNNER_TIMEOUT' })
      )
    }, 2500)
    const finish = (err, value) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      socket.destroy()
      err ? reject(err) : resolve(value)
    }
    socket.setEncoding('utf8')
    socket.on('close', () =>
      finish(
        Object.assign(new Error('RUNNER_UNAVAILABLE'), {
          code: 'RUNNER_UNAVAILABLE'
        })
      )
    )
    socket.on('error', () =>
      finish(
        Object.assign(new Error('RUNNER_UNAVAILABLE'), {
          code: 'RUNNER_UNAVAILABLE'
        })
      )
    )
    socket.on('connect', () =>
      socket.write(JSON.stringify({ token, method, input }) + '\n')
    )
    socket.on('data', (data) => {
      buffer += data
      if (Buffer.byteLength(buffer) > 512 * 1024)
        return finish(new Error('PROTOCOL_TOO_LARGE'))
      if (buffer.includes('\n')) {
        try {
          const m = JSON.parse(buffer.slice(0, buffer.indexOf('\n')))
          finish(
            m.error
              ? Object.assign(new Error(m.error), { code: m.error })
              : null,
            m.result
          )
        } catch (e) {
          finish(e)
        }
      }
    })
  })
}
async function run(root, id) {
  process.umask(0o077)
  const config = privateRead(path.join(root, id + '.launch.json'))
  fs.unlinkSync(path.join(root, id + '.launch.json'))
  const token = fs.readFileSync(path.join(root, 'token'), 'utf8')
  const journalFile = path.join(root, id + '.events.json')
  let journal
  try {
    journal = privateRead(journalFile)
  } catch (e) {
    if (e.code !== 'ENOENT') throw e
    journal = { seq: 0, events: [] }
  }
  if (config.nativeReplay || ['kimi','codex'].includes(config.adapter)) journal = { seq: 0, events: [] } // ACP replays the native history, once.
  const pendingOld = new Set(
    journal.events
      .filter((e) => e.requestId && !e.resolved)
      .map((e) => e.requestId)
  )
  for (const e of journal.events)
    if (pendingOld.has(e.requestId)) e.resolved = true
  let child,
    ended = false,
    error = null,
    stopping = false,
    journalBlocked = false,
    receiptVerified = false
  const ownershipFile = path.join(root, id + '.ownership.json')
  atomic(ownershipFile, { state: 'launching', nonce: config.nonce })
  const eventSizes = new WeakMap()
  const eventBytes = e => {
    if (!eventSizes.has(e)) eventSizes.set(e, Buffer.byteLength(JSON.stringify(e)))
    return eventSizes.get(e)
  }
  let journalBytes = journal.events.reduce((sum, e) => sum + eventBytes(e), 0)
  let journalDirty = false, journalTimer
  function persistJournal() {
    clearTimeout(journalTimer)
    journalTimer = null
    if (!journalDirty || journalBlocked) return
    try {
      atomic(journalFile, journal)
      journalDirty = false
    } catch {
      journalBlocked = true
      error = 'STORAGE_UNAVAILABLE'
      protocol.state = 'error'
      signalChild()
    }
  }
  function event(e) {
    const safe = {
      ...e,
      seq: ++journal.seq,
      sessionId: id,
      profileId: config.profileId,
      at: Date.now()
    }
    if (Buffer.byteLength(JSON.stringify(safe)) > 40000) {
      delete safe.input
      safe.text = String(safe.text).slice(0, 8000)
    }
    if (safe.eventId) {
      const prior = journal.events.find(e => e.eventId === safe.eventId)
      if (prior) {
        if (!safe.toolName && prior.toolName) safe.toolName = prior.toolName
        if (!safe.input && prior.input) safe.input = prior.input
        journalBytes -= eventBytes(prior)
        journal.events = journal.events.filter(e => e.eventId !== safe.eventId)
      }
    }
    journal.events.push(safe)
    journalBytes += eventBytes(safe)
    // Account for commas and the envelope without serializing the entire
    // retained transcript for every message in a native history replay.
    while (journal.events.length > 256 || journalBytes + journal.events.length + 64 > 240000)
      journalBytes -= eventBytes(journal.events.shift())
    journalDirty = true
    if ((config.nativeReplay || ['kimi','codex'].includes(config.adapter)) && !protocol.initialized && safe.kind !== 'error') {
      // This is a replayable display cache; native Kimi owns durable history.
      // Batch replay writes, but flush before exposing a ready controller.
      journalTimer ||= setTimeout(persistJournal, 50)
    } else persistJournal()
  }

  const send = (m) => {
    if (
      journalBlocked ||
      ended ||
      !child?.stdin.writable ||
      child.stdin.writableLength > 65536
    )
      fail('RUNNER_UNAVAILABLE')
    child.stdin.write(JSON.stringify(m) + '\n')
  }
  const Protocol = config.adapter === 'codex' ? CodexProtocol : config.adapter === 'kimi' ? KimiProtocol : ClaudeProtocol
  const protocol = new Protocol({
    cwd: config.launch.cwd,
    nativeId: config.nativeId,
    send,
    event
  })
  function protocolError(code) {
    if (error) return
    error = code
    protocol.state = 'error'
    event({ kind: 'error', text: code })
    signalChild()
  }
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  child = spawn(config.launch.file, config.launch.args, {
    cwd: config.launch.cwd,
    env,
    detached: true,
    stdio: ['pipe', 'pipe', 'pipe']
  })
  if (child.pid) atomic(ownershipFile, { state: 'running', pid: child.pid, nonce: config.nonce })
  child.stdout.setEncoding('utf8')
  child.stdout.on('data', (data) => {
    if (error) return
    try {
      protocol.feed(data)
      if (protocol.initialized) persistJournal()
    } catch (e) {
      protocolError(
        [
          'IDENTITY_MISMATCH',
          'INVALID_PROTOCOL',
          'PROTOCOL_TOO_LARGE', 'KIMI_AUTH_REQUIRED', 'KIMI_LOAD_FAILED', 'KIMI_PROTOCOL_UNSUPPORTED', 'CODEX_LOAD_FAILED', 'NATIVE_SESSION_IN_USE'
        ].includes(e.code)
          ? e.code
          : 'PROTOCOL_FAILED'
      )
    }
  })
  // stderr may contain credential-bearing launcher diagnostics; never persist or relay it.
  child.stderr.resume()
  child.stdin.on('error', () => protocolError('AGENT_INPUT_CLOSED'))
  child.on('error', () => {
    ended = true
    atomic(ownershipFile, { state: 'exited', nonce: config.nonce })
    protocolError('AGENT_START_FAILED')
  })
  child.on('exit', () => {
    ended = true
    if (groupAbsent(child.pid)) atomic(ownershipFile, { state: 'exited', nonce: config.nonce })
    protocol.state = error ? 'error' : 'stopped'
    event({ kind: 'status', text: 'Agent stopped' })
    if (stopping) finishStop()
  })
  process.on('SIGHUP', stop)
  process.on('SIGTERM', stop)
  function signalChild() {
    if (child?.pid && !ended)
      try {
        process.kill(-child.pid, 'SIGTERM')
      } catch (e) {
        if (e.code !== 'ESRCH') throw e
      }
  }
  function finishStop() {
    if (!child?.pid) process.exit(0)
    let present = false
    try {
      process.kill(-child.pid, 0)
      present = true
    } catch (e) {
      if (e.code !== 'ESRCH') present = true
    }
    if (!present) { atomic(ownershipFile, { state: 'exited', nonce: config.nonce }); process.exit(0) }
    setTimeout(finishStop, 50)
  }
  function stop() {
    if (stopping) return
    stopping = true
    if (['kimi','codex'].includes(config.adapter) && !ended) {
      protocol.close(signalChild)
      // If graceful close stalls, ownership remains unconfirmed; the host will
      // not start a replacement. Do not kill an engine still flushing history.
    } else signalChild()
    if (ended) finishStop()
  }
  function verifyReceipt(required) {
    if (error) { if (required) fail(error); return }
    if (['kimi','codex'].includes(config.adapter)) {
      receiptVerified = protocol.verified && protocol.initialized
      if (required && (!receiptVerified || ended)) fail(error || 'SESSION_NOT_READY')
      return
    }
    if (!receiptVerified) {
      try {
        const r = privateRead(config.receipt)
        if (r.nativeId !== config.nativeId || r.cwd !== config.launch.cwd || r.nonce !== config.nonce
          || r.source !== (config.fresh ? 'startup' : 'resume')) fail('IDENTITY_MISMATCH')
        receiptVerified = true
        protocol.verified = true
        if (protocol.state === 'starting') protocol.state = 'ready'
      } catch (e) {
        if (e.code !== 'ENOENT') protocolError('IDENTITY_MISMATCH')
      }
    }
    if (required && (error || !receiptVerified || !protocol.initialized || ended)) fail(error || 'SESSION_NOT_READY')
  }
  const socketPath = endpoint(root, id)
  try {
    fs.unlinkSync(socketPath)
  } catch (e) {
    if (e.code !== 'ENOENT') throw e
  }
  const server = net.createServer((socket) => {
    let buffer = ''
    socket.setEncoding('utf8')
    const timer = setTimeout(() => socket.destroy(), 2500)
    socket.on('error', () => {})
    socket.on('close', () => clearTimeout(timer))
    socket.on('data', (data) => {
      buffer += data
      if (Buffer.byteLength(buffer) > 65536) return socket.destroy()
      if (!buffer.includes('\n')) return
      let response
      try {
        const m = JSON.parse(buffer.slice(0, buffer.indexOf('\n')))
        if (
          typeof m.token !== 'string' ||
          !/^[a-f0-9]{64}$/.test(m.token) ||
          !timingSafeEqual(Buffer.from(m.token), Buffer.from(token))
        )
          return socket.destroy()
        const input = m.input || {}
        let result
        if (['message','permission','interrupt','activated'].includes(m.method)) verifyReceipt(true)
        if (m.method === 'status') {
          verifyReceipt(false)
          result = {
            nativeId: receiptVerified && !error ? protocol.nativeId : null,
            state: error ? 'error' : receiptVerified && protocol.initialized ? protocol.state : 'starting',
            initialized: protocol.initialized,
            model: protocol.model || null,
            pid: child.pid,
            error,
            pending: protocol.pending.size,
            seq: journal.seq,
            ended
          }
        } else if (m.method === 'activated') {
          event({ kind: 'profile', text: 'Profile active in Chat' })
          result = { ok: true }
        } else if (m.method === 'events') {
          if (
            !Number.isSafeInteger(input.after) ||
            input.after < 0 ||
            input.after > journal.seq
          )
            fail('INVALID_REQUEST')
          result = {
            seq: journal.seq,
            truncated: input.after < (journal.events[0]?.seq || 1) - 1,
            events: journal.events.filter((e) => e.seq > input.after)
          }
        } else if (m.method === 'message') {
          if (
            typeof input.text !== 'string' ||
            !input.text.trim() ||
            input.text.length > 16000
          )
            fail('INVALID_REQUEST')
          protocol.message(input.text)
          result = { ok: true }
        } else if (m.method === 'permission') {
          if (typeof input.allow !== 'boolean') fail('INVALID_REQUEST')
          protocol.respond(input.requestId, input.allow, input.answers)
          result = { ok: true }
        } else if (m.method === 'interrupt') {
          protocol.interrupt()
          result = { ok: true }
        } else if (m.method === 'stop') {
          stop()
          result = { ok: true }
        } else fail('UNKNOWN_METHOD')
        response = { result }
      } catch (e) {
        response = { error: e.code || 'RUNNER_OPERATION_FAILED' }
      }
      socket.end(JSON.stringify(response) + '\n')
    })
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(socketPath, resolve)
  })
  if (config.nativeReplay) {
    if (config.nativeReplay.truncated) event({kind:'status',text:'Showing recent activity. Earlier history is retained by Claude.'})
    for (const item of config.nativeReplay.events) event(item)
    persistJournal()
  }
  protocol.initialize()
}
if (require.main === module)
  run(process.argv[2], process.argv[3]).catch(() => process.exit(1))
module.exports = { requestRunner, endpoint }
