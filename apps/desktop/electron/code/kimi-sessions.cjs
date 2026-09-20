const fs = require('node:fs'), path = require('node:path'), os = require('node:os')
const { execFile } = require('node:child_process')
const { promisify } = require('node:util')
const { randomUUID } = require('node:crypto')
const { atomic, privateRead, keys, text } = require('./code-catalog.cjs')
const { fail } = require('./service-storage.cjs')
const { requestRunner } = require('./structured-runner.cjs')
const { validNativeId } = require('./kimi-protocol.cjs')
const { groupAbsent } = require('./process-ownership.cjs')
const exec = promisify(execFile)
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
// Native CLIs do not participate in zQ's leases. Catch an already-open CLI
// before taking control; never signal a process zQ did not launch.
async function assertNoNativeCLI(session, agent = 'kimi') {
  let output
  try { output = (await exec('/bin/ps', ['-axo', 'pid=,command='], {timeout: 3000, maxBuffer: 4 * 1024 * 1024})).stdout }
  catch { fail('NATIVE_OWNERSHIP_UNAVAILABLE') }
  for (const line of output.split('\n')) {
    const match = line.trim().match(new RegExp('^(\\d+)\\s+(\\S*\\b' + agent + ')\\s*(.*)$'))
    if (!match) continue
    const args = match[3].split(/\s+/)
    if (['web', 'server', 'app-server', 'session', 'export', '--version', '--help'].includes(args[0])) continue
    if (session.nativeId && args.includes(session.nativeId)) fail('NATIVE_SESSION_IN_USE')
    // Bare `kimi` and `kimi --continue` select their session after launch.
    // The process cwd is the conservative boundary for these invocations.
    try {
      const cwd = process.platform === 'linux' ? fs.readlinkSync(`/proc/${match[1]}/cwd`)
        : (await exec('/usr/sbin/lsof', ['-a', '-p', match[1], '-d', 'cwd', '-Fn'], {timeout: 3000})).stdout.split('\n').find(l => l.startsWith('n'))?.slice(1)
      if (cwd && fs.realpathSync(cwd) === fs.realpathSync(session.cwd)) fail('NATIVE_SESSION_IN_USE')
    } catch (e) { if (e.code === 'NATIVE_SESSION_IN_USE') throw e }
  }
}
function binary() {
  const candidates = [process.env.ZQ_KIMI_BINARY, path.join(os.homedir(), '.kimi-code/bin/kimi'),
    ...(process.env.PATH || '').split(path.delimiter).filter(Boolean).map(p => path.join(p, 'kimi'))]
  for (const candidate of candidates.filter(Boolean)) {
    try { if (path.isAbsolute(candidate) && fs.statSync(candidate).isFile()) { fs.accessSync(candidate, fs.constants.X_OK); return candidate } } catch {}
  }
  fail('KIMI_NOT_INSTALLED')
}
class KimiSessions {
  constructor(host, adapter = 'kimi') { this.host = host; this.adapter = adapter; this.opening = new Set(); this.switching = new Set() }
  async resolveNative(nativeId, profileId) { return (this.lastDiscovery && Date.now() - this.lastDiscovery.at < 30000 ? this.lastDiscovery.result : await this.list(profileId)).sessions.find(s => s.nativeId === nativeId) }
  profileId(value) { if (value) fail('INVALID_PROFILE'); return '' }
  launch(s, mode) { return { file: binary(), args: mode === 'chat' ? ['acp'] : ['--session', s.nativeId], cwd: s.cwd } }
  async validateProfile(s, id) { if (id && id !== s.profileId) fail('RESUME_UNSUPPORTED') }
  async list() {
    // Concurrent picker refreshes share one native discovery process. Explicit
    // refresh always reads the CLI; opening a just-listed row reuses its metadata.
    if (this.discovery) return this.discovery
    this.discovery = this.discover()
    try { return await this.discovery } finally { this.discovery = null }
  }
  async discover() {
    let output
    try { output = await exec(binary(), ['session', 'list', '--all', '--limit', '201', '--json'], { timeout: 15000, maxBuffer: 2 * 1024 * 1024, env: { ...process.env, ELECTRON_RUN_AS_NODE: '' } }) }
    catch (e) { fail(e.code === 'KIMI_NOT_INSTALLED' ? e.code : 'KIMI_DISCOVERY_FAILED') }
    let rows
    try { rows = JSON.parse(output.stdout) } catch { fail('KIMI_PROTOCOL_UNSUPPORTED') }
    if (!Array.isArray(rows)) fail('KIMI_PROTOCOL_UNSUPPORTED')
    const result = { truncated: rows.length > 200, sessions: rows.slice(0, 200).filter(r => validNativeId(r.id) && text(r.workDir) && path.isAbsolute(r.workDir)).map(r => ({
      nativeId: r.id, cwd: r.workDir, title: String(r.title || r.lastPrompt || 'Kimi session').slice(0, 200), updatedAt: Number(r.updatedAt) || 0
    })) }
    this.lastDiscovery = { result, at: Date.now() }
    return result
  }
  async open(owner, input, fresh = false) {
    keys(input, fresh ? ['cwd', 'profileId', 'mode'] : ['nativeId', 'profileId', 'mode'])
    if (input.mode && !['chat','terminal'].includes(input.mode)) fail('MODE_UNSUPPORTED')
    const profileId = this.profileId(input.profileId)
    if (fresh ? !text(input.cwd) || !path.isAbsolute(input.cwd) : !validNativeId(input.nativeId)) fail('INVALID_REQUEST')
    const key = input.nativeId || input.cwd
    if (this.opening.has(key)) fail('SWITCH_IN_PROGRESS')
    this.opening.add(key)
    try {
      const h = this.host
      let s = !fresh && h.catalog.value.sessions.find(s => s.adapter === this.adapter && s.nativeId === input.nativeId)
      if (s) {
        s.archivedAt = null
        h.catalog.save()
        // Navigation never starts a second controller. Resume remains explicit.
        return s
      }
      const native = fresh ? { cwd: input.cwd, title: this.adapter === 'codex' ? 'New Codex session' : 'New Kimi session', nativeId: '' } : await this.resolveNative(input.nativeId, profileId)
      if (!native) fail((this.adapter.toUpperCase() + '_SESSION_NOT_FOUND'))
      if (!fs.statSync(native.cwd).isDirectory()) fail('WORKSPACE_UNAVAILABLE')
      if (h.catalog.value.sessions.length >= 128) fail('LIMIT_REACHED')
      const project = h.catalog.value.projects.find(p => p.hostId === 'local' && p.cwd === native.cwd)
      s = { id: randomUUID(), hostId: 'local', projectId: project?.id || '', cwd: native.cwd, profileId,
        adapter: this.adapter, nativeId: native.nativeId, nativeIdVerified: false, ownership: 'owned', mode: 'chat',
        state: 'starting', revision: 0, title: native.title, createdAt: Date.now(), updatedAt: Date.now(), archivedAt: null, pid: null, error: null }
      h.catalog.value.sessions.push(s); h.catalog.save(); h.leases.set(s.id, owner)
      try { await this.start(s, 'chat'); if (input.mode === 'terminal') { await this.stop(s); await this.start(s, 'terminal') } }
      catch (e) { s.state = 'error'; s.error = e.code || (this.adapter.toUpperCase() + '_START_FAILED'); h.catalog.save() }
      return s
    } finally { this.opening.delete(key) }
  }
  async start(s, mode) {
    const h = this.host
    if (await h.tmux.inspect(h.name(s.id))) fail('PROCESS_OWNERSHIP_UNKNOWN')
    // An earlier controller must have positively exited before replacement.
    try {
      const old = privateRead(path.join(h.paths.root, s.id + '.ownership.json'))
      if (old.state !== 'exited' || (old.pid && !groupAbsent(old.pid))) fail('PROCESS_OWNERSHIP_UNKNOWN')
    } catch (e) { if (e.code !== 'ENOENT') throw e }
    await assertNoNativeCLI(s, this.adapter)
    const nonce = randomUUID()
    const launch = this.launch(s, mode)
    if (mode === 'terminal' && !validNativeId(s.nativeId)) fail('IDENTITY_UNVERIFIED')
    atomic(path.join(h.paths.root, s.id + '.launch.json'), { adapter: this.adapter, launch, nativeId: s.nativeId, profileId: s.profileId, nonce })
    atomic(path.join(h.paths.root, s.id + '.ownership.json'), { state: 'launching', nonce })
    await h.tmux.launch(h.name(s.id), { file: h.nodePath, args: [path.join(__dirname, mode === 'chat' ? 'structured-runner.cjs' : 'kimi-terminal.cjs'), h.paths.root, s.id], cwd: s.cwd }, 100, 30, true)
    s.pid = (await h.tmux.inspect(h.name(s.id)))?.pid || null
    s.mode = mode; s.state = 'starting'; s.error = null; h.catalog.save()
    const deadline = Date.now() + 30000
    while (Date.now() < deadline) {
      if (!await h.tmux.inspect(h.name(s.id))) fail((this.adapter.toUpperCase() + '_START_FAILED'))
      if (mode === 'chat') {
        try {
          const state = await requestRunner(h.paths.root, s.id, h.paths.token, 'status')
          if (state.error || state.ended) fail(state.error || (this.adapter.toUpperCase() + '_START_FAILED'))
          if (state.initialized && state.nativeId) {
            if (s.nativeId && s.nativeId !== state.nativeId) fail('IDENTITY_MISMATCH')
            s.nativeId = state.nativeId; s.nativeIdVerified = true; s.resolvedModel = state.model
            s.state = 'ready'; h.catalog.save(); return
          }
        } catch (e) { if (!['RUNNER_UNAVAILABLE', 'RUNNER_TIMEOUT'].includes(e.code)) throw e }
      } else {
        const state = privateRead(path.join(h.paths.root, s.id + '.ownership.json'))
        if (state.state === 'running' && state.ready && state.nativeId === s.nativeId) { s.state = 'ready'; h.catalog.save(); return }
      }
      await pause(100)
    }
    fail((this.adapter.toUpperCase() + '_START_TIMEOUT'))
  }
  async status(s) {
    if (this.switching.has(s.id)) return
    const h = this.host
    const live = await h.tmux.inspect(h.name(s.id))
    if (!live) {
      let ownership
      try { ownership = privateRead(path.join(h.paths.root, s.id + '.ownership.json')) }
      catch (e) { if (e.code !== 'ENOENT') throw e }
      if (ownership && ownership.state !== 'exited') {
        if (ownership.state === 'running' && groupAbsent(ownership.pid)) {
          atomic(path.join(h.paths.root, s.id + '.ownership.json'), { ...ownership, state: 'exited' })
        } else {
          if (s.state !== 'error' || s.error !== 'PROCESS_OWNERSHIP_UNKNOWN') {
            s.state = 'error'; s.error = 'PROCESS_OWNERSHIP_UNKNOWN'; h.catalog.save()
          }
          return
        }
      }
      if (s.state !== 'stopped' && s.state !== 'error') { s.state = 'stopped'; s.pid = null; h.catalog.save() }
      return
    }
    if (s.pid && live.pid !== s.pid) fail('SESSION_IDENTITY_CHANGED')
    if (s.mode === 'chat') {
      try {
        const r = await requestRunner(h.paths.root, s.id, h.paths.token, 'status')
        if (r.nativeId && s.nativeId && r.nativeId !== s.nativeId) fail('IDENTITY_MISMATCH')
        const state = r.ended ? 'stopped' : r.state
        if (s.state !== state || s.error !== r.error || (r.model && s.resolvedModel !== r.model)) {
          s.state = state; s.error = r.error; if (r.model) s.resolvedModel = r.model; h.catalog.save()
        }
      } catch (e) { if (!['starting', 'error'].includes(s.state)) { s.state = 'disconnected'; s.error = e.code; h.catalog.save() } }
    }
  }
  async stop(s) {
    const h = this.host
    const live = await h.tmux.inspect(h.name(s.id))
    if (live) {
      if (s.pid && live.pid !== s.pid) fail('SESSION_IDENTITY_CHANGED')
      if (s.mode === 'chat') await requestRunner(h.paths.root, s.id, h.paths.token, 'stop')
      else process.kill(live.pid, 'SIGTERM') // owned wrapper requests graceful native shutdown
    }
    const deadline = Date.now() + 15000
    while (Date.now() < deadline) {
      let ownership
      try { ownership = privateRead(path.join(h.paths.root, s.id + '.ownership.json')) }
      catch (e) { if (e.code !== 'ENOENT') throw e }
      if (!await h.tmux.inspect(h.name(s.id)) && (!ownership || ownership.state === 'exited') && (!ownership?.pid || groupAbsent(ownership.pid))) { s.pid = null; return }
      await pause(50)
    }
    fail('STOP_UNCONFIRMED')
  }
  async switch(owner, method, input, s) {
    const h = this.host
    h.own(owner, s.id)
    if (this.switching.has(s.id)) fail('SWITCH_IN_PROGRESS')
    if (input.expectedRevision !== s.revision) fail('STALE_REVISION')
    const profileId = input.profileId || s.profileId
    await this.validateProfile(s, profileId)
    const mode = input.mode || s.mode
    if (!['chat', 'terminal'].includes(mode)) fail('MODE_UNSUPPORTED')
    await this.status(s)
    if (method !== 'stopSession' && ['busy', 'approval', 'starting'].includes(s.state)) fail('SESSION_BUSY')
    this.switching.add(s.id)
    s.state = 'switching'; s.revision++; h.catalog.save()
    try {
      await this.stop(s)
      s.state = 'stopped'; s.error = null
      if (method !== 'stopSession') { s.profileId = profileId; await this.start(s, mode) }
    } catch (e) { s.state = 'error'; s.error = e.code || (this.adapter.toUpperCase() + '_SWITCH_FAILED') }
    finally { s.revision++; s.updatedAt = Date.now(); h.catalog.save(); this.switching.delete(s.id) }
    return s
  }
}
module.exports = { KimiSessions, binary, assertNoNativeCLI }
