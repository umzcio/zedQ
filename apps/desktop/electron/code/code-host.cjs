const fs = require('node:fs'),
  path = require('node:path')
const { randomUUID } = require('node:crypto')
const {
  CodeCatalog,
  atomic,
  privateRead,
  keys,
  text
} = require('./code-catalog.cjs')
const { buildClaudeResume } = require('./claude-launch.cjs')
const { createHandoffCoordinator } = require('./handoff.cjs')
const { requestRunner } = require('./structured-runner.cjs')
const { fail } = require('./service-storage.cjs')
const { workspace, workspaceMethods } = require('./workspace.cjs')
const { externalTmux } = require('./external-terminal.cjs')
const { buildTerminalLaunch } = require('./terminal-launch.cjs')
const { nativeExitConfirmed } = require('./process-ownership.cjs')
const delay = (ms) => new Promise((r) => setTimeout(r, ms))
const quote = (v) => "'" + v.replace(/'/g, "'\\''") + "'"
class CodeHost {
  constructor({ paths, tmux, nodePath = process.execPath, seedFile }) {
    this.paths = paths
    this.tmux = tmux
    this.nodePath = nodePath
    this.catalog = new CodeCatalog(paths.root, { seedFile })
    this.leases = new Map()
    this.handles = new Map()
    this.eventCursors = new Map()
    this.external = externalTmux(tmux.binary)
    this.externalOwners = new Map()
    this.coordinator = createHandoffCoordinator({
      load: async (id) => {
        const s = this.session(id)
        return {
          ...s,
          state: ['ready', 'busy', 'approval', 'limited', 'error'].includes(
            s.state
          )
            ? 'ready'
            : s.state === 'stopped'
              ? 'recoverable'
              : s.state
        }
      },
      save: async (s) => {
        Object.assign(this.session(s.id), s, {
          pid: this.session(s.id).pid,
          updatedAt: Date.now()
        })
        this.catalog.save()
      },
      preflight: (s, t) => this.preflight(s, t),
      stopSource: (s) => this.stop(s),
      start: (s, t) => this.start(s, t, false),
      ready: (h) => this.ready(h),
      stopTarget: (h) => this.stop(this.session(h.id))
    })
  }
  session(id) {
    return this.catalog.find('sessions', id)
  }
  name(id) {
    return 'zqc-' + id
  }
  release(owner) {
    for (const [id, v] of this.externalOwners) if (v === owner) this.externalOwners.delete(id)
    for (const [id, v] of this.leases) if (v === owner) this.leases.delete(id)
  }
  own(owner, id) {
    if (this.leases.get(id) !== owner) fail('LEASE_REQUIRED')
  }
  async status(s) {
    if (s.ownership === 'external') {
      const info = await this.external.inspect(s.tmuxTarget)
      const state = info && info.identity === s.tmuxIdentity ? 'ready' : 'stopped'
      if (s.state !== state) { s.state = state; this.catalog.save() }
      return
    }
    const live = await this.tmux.inspect(this.name(s.id))
    if (live && s.pid && live.pid !== s.pid) fail('SESSION_IDENTITY_CHANGED')
    if (!live) {
      if (s.mode === 'chat' && !nativeExitConfirmed(this.paths.root, s.id)) {
        if (s.state !== 'switching' || s.error !== 'PROCESS_OWNERSHIP_UNKNOWN') {
          s.state = 'switching'; s.error = 'PROCESS_OWNERSHIP_UNKNOWN'; this.catalog.save()
        }
        return
      }
      if (s.pid) {
        try {
          process.kill(s.pid, 0)
          if (s.state !== 'switching') {
            s.state = 'switching'
            s.error = 'PROCESS_OWNERSHIP_UNKNOWN'
            this.catalog.save()
          }
          return
        } catch (e) {
          if (e.code !== 'ESRCH') fail('PROCESS_OWNERSHIP_UNKNOWN')
        }
      }
      if (!['stopped', 'recoverable'].includes(s.state)) {
        s.state = s.recovery ? 'recoverable' : 'stopped'
        s.pid = null
        this.catalog.save()
      }
      return
    }
    if (s.mode === 'chat' && s.state !== 'switching') {
      try {
        const r = await requestRunner(
          this.paths.root,
          s.id,
          this.paths.token,
          'status'
        )
        const nextError = r.error || (r.nativeId && !r.ended ? null : s.error)
        const changed =
          s.state !== r.state ||
          s.nativeIdVerified !== !!r.nativeId ||
          s.error !== nextError ||
          this.eventCursors.get(s.id) !== r.seq
        if (changed) {
          this.eventCursors.set(s.id, r.seq)
          s.state = r.ended ? 'stopped' : r.state
          s.nativeIdVerified = !!r.nativeId
          s.error = nextError
          this.catalog.save()
        }
      } catch {
        if (s.state !== 'disconnected') {
          s.state = 'disconnected'
          s.error = 'RUNNER_UNAVAILABLE'
          this.catalog.save()
        }
      }
    }
  }
  async preflight(s, { profile, mode }) {
    if (s.ownership === 'external' || profile.adapter === 'terminal' || this.catalog.find('profiles', s.profileId).adapter === 'terminal') fail('RESUME_UNSUPPORTED')
    buildClaudeResume({ session: s, profile, mode })
    if (
      !fs.statSync(s.cwd).isDirectory() ||
      !fs.statSync(profile.launcherFile).isFile()
    )
      fail('PREFLIGHT_FAILED')
    if (
      profile.id !== s.profileId &&
      (!profile.sharedHistoryConfirmed ||
        !this.catalog.find('profiles', s.profileId).sharedHistoryConfirmed)
    )
      fail('SHARED_HISTORY_UNCONFIRMED')
    if (!s.nativeIdVerified) fail('IDENTITY_UNVERIFIED')
  }
  async start(s, { profile, mode }, fresh) {
    if (!fresh && s.mode === 'chat' && !nativeExitConfirmed(this.paths.root, s.id)) fail('PROCESS_OWNERSHIP_UNKNOWN')
    if (profile.adapter === 'terminal') {
      if (!fresh) fail('RESUME_UNSUPPORTED')
      const launch = buildTerminalLaunch({ session: s, profile, mode })
      await this.tmux.launch(this.name(s.id), launch, 100, 30)
      const live = await this.tmux.inspect(this.name(s.id))
      if (!live) fail('TARGET_NOT_READY')
      s.pid = live.pid
      atomic(path.join(this.paths.root, s.id + '.controller.json'), { mode, pid: s.pid, adapter: 'terminal' })
      this.catalog.save()
      return { id: s.id, mode, generic: true, profileId: profile.id }
    }
    const launch = buildClaudeResume({ session: s, profile, mode })
    try {
      const old = privateRead(
        path.join(this.paths.root, s.id + '.controller.json')
      )
      if (
        path.dirname(old.receipt) === this.paths.root &&
        /^[a-f0-9-]+\.receipt\.json$/.test(path.basename(old.receipt))
      )
        fs.unlinkSync(old.receipt)
    } catch (e) {
      if (e.code !== 'ENOENT') throw e
    }
    const nonce = randomUUID(),
      receipt = path.join(this.paths.root, nonce + '.receipt.json')
    const command = [
      'env',
      'ELECTRON_RUN_AS_NODE=1',
      this.nodePath,
      path.join(__dirname, 'identity-receipt.cjs'),
      receipt,
      nonce
    ]
      .map(quote)
      .join(' ')
    launch.args.push(
      '--settings',
      JSON.stringify({
        hooks: {
          SessionStart: [{ hooks: [{ type: 'command', command, timeout: 5 }] }]
        }
      })
    )
    if (fresh) {
      const i = launch.args.indexOf('--resume')
      launch.args[i] = '--session-id'
    }
    // stdio permission requests remain host-mediated; never grant bypass permission.
    if (mode === 'chat') launch.args.push('--permission-prompt-tool', 'stdio')
    let actual = launch
    if (mode === 'chat') {
      atomic(path.join(this.paths.root, s.id + '.launch.json'), {
        launch,
        nativeId: s.nativeId,
        profileId: profile.id,
        receipt,
        nonce,
        fresh
      })
      actual = {
        file: this.nodePath,
        args: [
          path.join(__dirname, 'structured-runner.cjs'),
          this.paths.root,
          s.id
        ],
        cwd: s.cwd
      }
    }
    if (mode === 'chat') atomic(path.join(this.paths.root, s.id + '.ownership.json'), { state: 'launching', nonce })
    await this.tmux.launch(this.name(s.id), actual, 100, 30, mode === 'chat')
    const live = await this.tmux.inspect(this.name(s.id))
    s.pid = live?.pid || null
    this.session(s.id).pid = s.pid
    atomic(path.join(this.paths.root, s.id + '.controller.json'), {
      mode,
      pid: s.pid,
      receipt,
      nonce
    })
    this.catalog.save()
    const handle = {
      id: s.id,
      mode,
      expected: s.nativeId,
      profileId: profile.id,
      fresh,
      receipt,
      nonce,
      cwd: s.cwd
    }
    this.handles.set(s.id, handle)
    return handle
  }
  async ready(h) {
    if (h.generic) {
      if (!(await this.tmux.inspect(this.name(h.id)))) fail('TARGET_NOT_READY')
      await this.activated(h)
      return { nativeId: null }
    }
    const deadline = Date.now() + 45000
    while (Date.now() < deadline) {
      if (!(await this.tmux.inspect(this.name(h.id)))) fail('TARGET_NOT_READY')
      if (h.mode === 'chat') {
        try {
          const pending = await requestRunner(this.paths.root, h.id, this.paths.token, 'status')
          if (pending.error || pending.ended) fail(pending.error || 'TARGET_NOT_READY')
        } catch (e) {
          if (e.code !== 'RUNNER_UNAVAILABLE') throw e
        }
      }
      let receipt
      try {
        receipt = privateRead(h.receipt)
      } catch (e) {
        if (e.code !== 'ENOENT') throw e
      }
      if (receipt) {
        if (
          receipt.nativeId !== h.expected ||
          receipt.cwd !== h.cwd ||
          receipt.nonce !== h.nonce ||
          receipt.source !== (h.fresh ? 'startup' : 'resume')
        )
          fail('IDENTITY_MISMATCH')
        if (!(await this.tmux.inspect(this.name(h.id))))
          fail('TARGET_NOT_READY')
        if (h.mode === 'terminal') {
          await this.activated(h)
          return { nativeId: h.expected }
        }
        try {
          const r = await requestRunner(
            this.paths.root,
            h.id,
            this.paths.token,
            'status'
          )
          if (r.error || r.ended) fail('TARGET_NOT_READY')
          if (r.nativeId === h.expected && r.initialized) {
            await this.activated(h)
            return { nativeId: h.expected }
          }
        } catch (e) {
          if (e.code !== 'RUNNER_UNAVAILABLE') throw e
        }
      }
      await delay(40)
    }
    fail('IDENTITY_UNVERIFIED')
  }
  async activated(h) {
    if (h.mode === 'chat') {
      await requestRunner(this.paths.root, h.id, this.paths.token, 'activated')
      return
    }
    const file = path.join(this.paths.root, h.id + '.events.json')
    let journal
    try {
      journal = privateRead(file)
    } catch (e) {
      if (e.code !== 'ENOENT') throw e
      journal = { seq: 0, events: [] }
    }
    journal.events.push({
      seq: ++journal.seq,
      sessionId: h.id,
      profileId: h.profileId,
      at: Date.now(),
      kind: 'profile',
      text: 'Profile active in Terminal'
    })
    while (
      journal.events.length > 256 ||
      Buffer.byteLength(JSON.stringify(journal)) > 240000
    )
      journal.events.shift()
    atomic(file, journal)
  }
  async stop(s) {
    if (s.ownership === 'external') fail('EXTERNAL_SESSION_OWNERSHIP')
    const live = await this.tmux.inspect(this.name(s.id))
    if (!live) {
      await this.status(s)
      if (s.pid || s.error === 'PROCESS_OWNERSHIP_UNKNOWN') fail('STOP_UNCONFIRMED')
      return
    }
    let mode = s.mode
    try {
      mode = privateRead(
        path.join(this.paths.root, s.id + '.controller.json')
      ).mode
    } catch (e) {
      if (e.code !== 'ENOENT') throw e
    }
    if (mode === 'chat') {
      try {
        await requestRunner(this.paths.root, s.id, this.paths.token, 'stop')
      } catch {
        /* Exit confirmation below decides whether replacement is safe. */
      }
    } else await this.tmux.stop(this.name(s.id))
    const deadline = Date.now() + 1500
    while (Date.now() < deadline) {
      let present = false
      try {
        process.kill(mode === 'terminal' ? -live.pid : live.pid, 0)
        present = true
      } catch (e) {
        if (e.code !== 'ESRCH') present = true
      }
      if (!present && !(await this.tmux.inspect(this.name(s.id)))) {
        s.pid = null
        this.session(s.id).pid = null
        return
      }
      await delay(40)
    }
    fail('STOP_UNCONFIRMED')
  }
  inputBlocked(id) {
    return (
      this.catalog.value.sessions.find((s) => s.id === id)?.state ===
      'switching'
    )
  }
  async dispatch(owner, method, input = {}) {
    if (this.catalog.blocked) fail('STORAGE_UNAVAILABLE')
    if (!input || typeof input !== 'object' || Array.isArray(input))
      fail('INVALID_REQUEST')
    if (workspaceMethods.has(method)) return workspace(this.catalog.find('projects', input.projectId).cwd, method, input)
    if (method === 'discoverTerminals') return this.external.discover()
    if (method === 'attachExternalTerminal') {
      if (this.catalog.value.sessions.length >= 32) fail('LIMIT_REACHED')
      keys(input, ['projectId','target','title'])
      if (typeof input.target !== 'string' || !/^\$\d+$/.test(input.target) || (input.title !== undefined && !text(input.title,200))) fail('INVALID_REQUEST')
      const project = this.catalog.find('projects', input.projectId)
      const info = await this.external.inspect(input.target)
      if (!info) fail('NOT_FOUND')
      if (info.attached) fail('EXTERNAL_TERMINAL_IN_USE')
      if (this.catalog.value.sessions.some(s => s.ownership === 'external' && s.tmuxTarget === input.target && s.tmuxIdentity === info.identity)) fail('ALREADY_ATTACHED')
      const s = { id: randomUUID(), projectId: project.id, hostId: project.hostId, cwd: project.cwd, profileId: '',
        nativeId: '', nativeIdVerified: false, mode: 'terminal', state: 'ready', revision: 0, title: input.title || info.name,
        createdAt: Date.now(), updatedAt: Date.now(), archivedAt: null, pid: null, error: null, ownership: 'external', tmuxTarget: input.target, tmuxIdentity: info.identity }
      this.catalog.value.sessions.push(s); this.catalog.save(); this.leases.set(s.id, owner)
      return s
    }
    if (method === 'snapshot') {
      for (const s of this.catalog.value.sessions) await this.status(s)
      return {
        ...this.catalog.value,
        hosts: [
          { id: 'local', name: 'This Mac', kind: 'local', available: true }
        ],
        runtime: {
          tmux: true,
          pty: true,
          claude: true,
          chat: true,
          reason: null
        }
      }
    }
    if (
      [
        'createProject',
        'updateProject',
        'deleteProject',
        'createProfile',
        'updateProfile',
        'duplicateProfile',
        'deleteProfile'
      ].includes(method)
    )
      return this.catalog[method](input)
    if (method === 'createSession') {
      keys(input, ['projectId', 'profileId', 'mode', 'title'])
      if (
        !['chat', 'terminal'].includes(input.mode) ||
        (input.title !== undefined && !text(input.title, 200))
      )
        fail('INVALID_REQUEST')
      if (this.catalog.value.sessions.length >= 32) fail('LIMIT_REACHED')
      const project = this.catalog.find('projects', input.projectId),
        profile = this.catalog.find('profiles', input.profileId)
      if (!profile.modes.includes(input.mode)) fail('MODE_UNSUPPORTED')
      const s = {
        id: randomUUID(),
        projectId: project.id,
        hostId: project.hostId,
        cwd: project.cwd,
        profileId: profile.id,
        nativeId: profile.adapter === 'terminal' ? '' : randomUUID(),
        ownership: 'owned',
        nativeIdVerified: false,
        mode: input.mode,
        state: 'starting',
        revision: 0,
        title: input.title || 'New session',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        archivedAt: null,
        pid: null,
        error: null
      }
      this.catalog.value.sessions.push(s)
      this.catalog.save()
      this.leases.set(s.id, owner)
      try {
        const h = await this.start(s, { profile, mode: s.mode }, true)
        await this.ready(h)
        s.nativeIdVerified = profile.adapter !== 'terminal'
        s.state = 'ready'
        this.catalog.save()
      } catch (e) {
        try { await this.stop(s) } catch {}
        s.nativeIdVerified = false
        s.error = e.code || 'START_FAILED'
        s.state = 'error'
        this.catalog.save()
      }
      return s
    }
    const s = this.session(input.id)
    if (method === 'claimSession') {
      if (this.leases.has(s.id) && this.leases.get(s.id) !== owner)
        fail('LEASE_HELD')
      this.leases.set(s.id, owner)
      return { ok: true }
    }
    if (method === 'releaseSession') {
      if (this.leases.get(s.id) === owner) this.leases.delete(s.id)
      if (this.externalOwners.get(s.id) === owner) this.externalOwners.delete(s.id)
      return { ok: true }
    }
    if (method === 'events') {
      if (!Number.isSafeInteger(input.after) || input.after < 0)
        fail('INVALID_REQUEST')
      try {
        return await requestRunner(
          this.paths.root,
          s.id,
          this.paths.token,
          'events',
          { after: input.after }
        )
      } catch (e) {
        if (!['RUNNER_UNAVAILABLE', 'RUNNER_TIMEOUT'].includes(e.code)) throw e
        let j
        try {
          j = privateRead(path.join(this.paths.root, s.id + '.events.json'))
        } catch (e) {
          if (e.code !== 'ENOENT') throw e
          j = { seq: 0, events: [] }
        }
        if (input.after > j.seq) fail('INVALID_REQUEST')
        return {
          seq: j.seq,
          truncated: input.after < (j.events[0]?.seq || 1) - 1,
          events: j.events.filter((e) => e.seq > input.after)
        }
      }
    }
    if (method === 'updateSession') {
      keys(input, ['id', 'title', 'archived'])
      if (
        (input.title !== undefined && !text(input.title, 200)) ||
        (input.archived !== undefined && typeof input.archived !== 'boolean')
      )
        fail('INVALID_REQUEST')
      if (input.title !== undefined) s.title = input.title
      if (input.archived !== undefined)
        s.archivedAt = input.archived ? Date.now() : null
      s.updatedAt = Date.now()
      this.catalog.save()
      return s
    }
    this.own(owner, s.id)
    if (['stopSession', 'resumeSession', 'switchSession'].includes(method)) {
      if (s.ownership === 'external') fail('EXTERNAL_SESSION_OWNERSHIP')
      if (method !== 'stopSession' && this.catalog.find('profiles', s.profileId).adapter === 'terminal') fail('RESUME_UNSUPPORTED')
      if (input.expectedRevision !== s.revision) fail('STALE_REVISION')
      await this.status(s)
      if (method === 'switchSession' && ['busy', 'approval'].includes(s.state))
        fail('SESSION_BUSY')
      if (method === 'stopSession') {
        s.state = 'switching'
        s.revision++
        this.catalog.save()
        try {
          await this.stop(s)
          s.state = 'stopped'
          s.error = null
          delete s.recovery
        } catch (e) {
          s.error = e.code || 'STOP_UNCONFIRMED'
        }
        this.catalog.save()
        return s
      }
      if (
        method === 'resumeSession' &&
        !['stopped', 'recoverable'].includes(s.state)
      )
        fail('SESSION_NOT_STOPPED')
      const profile = this.catalog.find(
        'profiles',
        input.profileId || s.profileId
      )
      return this.coordinator.switchController({
        sessionId: s.id,
        expectedRevision: input.expectedRevision,
        target: { profile, mode: input.mode || s.mode }
      })
    }
    if (
      ['attachTerminal', 'writeTerminal', 'resizeTerminal'].includes(method)
    ) {
      if (s.mode !== 'terminal') fail('MODE_UNSUPPORTED')
      if (s.state !== 'ready') fail('SESSION_NOT_READY')
      if (
        method !== 'writeTerminal' &&
        (!Number.isInteger(input.cols) ||
          input.cols < 2 ||
          input.cols > 512 ||
          !Number.isInteger(input.rows) ||
          input.rows < 2 ||
          input.rows > 200)
      )
        fail('INVALID_REQUEST')
      if (
        method === 'writeTerminal' &&
        (typeof input.data !== 'string' ||
          input.data.includes('\0') ||
          Buffer.byteLength(input.data) > 8192)
      )
        fail('INVALID_REQUEST')
      if (s.ownership === 'external') {
        const info = await this.external.inspect(s.tmuxTarget)
        if (!info || info.identity !== s.tmuxIdentity) fail('SESSION_IDENTITY_CHANGED')
        if (method === 'attachTerminal') {
          if (info.attached && this.externalOwners.get(s.id) !== owner) fail('EXTERNAL_TERMINAL_IN_USE')
          this.externalOwners.set(s.id, owner)
        }
        if (method === 'writeTerminal') await this.external.write(s.tmuxTarget, input.data)
      } else if (method === 'writeTerminal') await this.tmux.write(this.name(s.id), input.data)
      return { ok: true }
    }
    if (method === 'detachTerminal') return { ok: true }
    if (s.mode !== 'chat') fail('MODE_UNSUPPORTED')
    if (s.state === 'switching') fail('RECONCILIATION_REQUIRED')
    if (method === 'sendMessage')
      return requestRunner(this.paths.root, s.id, this.paths.token, 'message', {
        text: input.text
      })
    if (method === 'respondPermission') {
      keys(input, ['id', 'requestId', 'allow', 'answers'])
      if (
        typeof input.requestId !== 'string' ||
        typeof input.allow !== 'boolean' ||
        (input.answers !== undefined &&
          (!input.answers ||
            typeof input.answers !== 'object' ||
            Array.isArray(input.answers) ||
            Object.entries(input.answers).some(
              ([k, v]) =>
                !text(k, 500) || typeof v !== 'string' || v.length > 8192
            )))
      )
        fail('INVALID_REQUEST')
      return requestRunner(
        this.paths.root,
        s.id,
        this.paths.token,
        'permission',
        input
      )
    }
    if (method === 'interruptSession')
      return requestRunner(this.paths.root, s.id, this.paths.token, 'interrupt')
    fail('UNKNOWN_METHOD')
  }
}
module.exports = { CodeHost }
