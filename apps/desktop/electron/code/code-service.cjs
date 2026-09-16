const fs = require('node:fs'),
  path = require('node:path'),
  os = require('node:os')
const { connectCodeService } = require('./session-client.cjs')
const { randomUUID } = require('node:crypto')
const { prepareRoot, fail, uuid } = require('./service-storage.cjs')
const { RemoteHosts, sshArgs, discoverAliases } = require('./remote.cjs')
const { Previews } = require('./preview.cjs')
const { resolveFile } = require('./workspace.cjs')
const METHODS = new Set([
  'createHost', 'updateHost', 'deleteHost', 'discoverHosts', 'connectHost', 'disconnectHost',
  'listFiles', 'readFile', 'writeFile', 'gitStatus', 'gitDiff', 'gitRepository', 'gitCommit', 'gitFetch', 'revealFile',
  'discoverTerminals', 'attachExternalTerminal', 'openPreview', 'stopPreview', 'listPreviews',
  'snapshot',
  'pickDirectory',
  'createProject',
  'updateProject',
  'deleteProject',
  'createProfile',
  'updateProfile',
  'duplicateProfile',
  'deleteProfile',
  'createSession',
  'createSetupSession',
  'updateSession',
  'stopSession',
  'resumeSession',
  'switchSession',
  'claimSession',
  'releaseSession',
  'events',
  'sendMessage',
  'respondPermission',
  'interruptSession',
  'attachTerminal',
  'detachTerminal',
  'writeTerminal',
  'resizeTerminal',
  'revealProject',
  'openExternal'
])
const executable = (name) =>
  [
    ...(process.env.PATH || '').split(path.delimiter),
    '/opt/homebrew/bin',
    '/usr/local/bin',
    path.join(os.homedir(), '.local/bin')
  ]
    .map((p) => path.join(p, name))
    .find((p) => {
      try {
        fs.accessSync(p, fs.constants.X_OK)
        return true
      } catch {
        return false
      }
    })
class CodeService {
  constructor({
    directory,
    onChange = () => {},
    onTerminal = () => {},
    pickDirectory,
    openExternal,
    reveal,
    tmuxPath = executable('tmux'),
    pty,
    nodePath = process.execPath
  }) {
    prepareRoot(directory)
    this.remotes = new RemoteHosts(directory)
    this.previews = new Previews()
    this.snapshotSerial = 0
    this.directory = directory
    this.onChange = onChange
    this.onTerminal = onTerminal
    this.pickDirectory = pickDirectory
    this.openExternal = openExternal
    this.reveal = reveal
    this.tmuxPath = tmuxPath
    this.nodePath = nodePath
    this.closed = false
    this.terminals = new Map()
    this.attachments = new Map()
    this.readRequests = new Map()
    this.seq = -1
    this.client = null
    this.connecting = null
    this.pty = pty
    this.ptyAvailable = true
    try {
      this.pty ||= require('node-pty')
    } catch {
      this.ptyAvailable = false
    }
    this.timer = setInterval(() => this.refresh().catch(() => {}), 1000)
    this.timer.unref?.()
  }
  async connection() {
    if (this.closed) fail('SERVICE_CLOSED')
    if (!this.tmuxPath) fail('TMUX_UNAVAILABLE')
    if (this.client) return this.client
    if (!this.connecting)
      this.connecting = connectCodeService({
        root: this.directory,
        tmuxPath: this.tmuxPath,
        nodePath: this.nodePath
      })
        .then((c) => {
          if (this.closed) {
            c.close()
            fail('SERVICE_CLOSED')
          }
          this.client = c
          return c
        })
        .finally(() => {
          this.connecting = null
        })
    return this.connecting
  }
  localRequest(method, input) {
    if (!['snapshot', 'events'].includes(method)) return this.performLocalRequest(method, input)
    const key = method + JSON.stringify(input || {})
    if (!this.readRequests.has(key)) {
      const request = this.performLocalRequest(method, input).finally(() => this.readRequests.delete(key))
      this.readRequests.set(key, request)
    }
    return this.readRequests.get(key)
  }
  async performLocalRequest(method, input) {
    try {
      return await (
        await this.connection()
      ).request('code:' + method, input || {})
    } catch (e) {
      if (
        ['SERVICE_DISCONNECTED', 'SERVICE_REQUEST_TIMEOUT'].includes(e.code)
      ) {
        this.client?.close()
        this.client = null
        for (const id of this.terminals.keys()) this.detach(id)
      }
      throw e
    }
  }
  async request(method, input = {}) {
    try { return await this.requestOnce(method, input) }
    catch (error) {
      // The service drops socket leases on reconnect, while the selected UI can
      // stay mounted. LEASE_REQUIRED is raised before any action takes effect.
      // Reclaim only for explicit control actions, and never steal another owner
      // or replay an action after an ambiguous disconnect/timeout.
      if (error.code !== 'LEASE_REQUIRED' || ![
        'stopSession', 'resumeSession', 'switchSession', 'sendMessage',
        'interruptSession', 'respondPermission', 'attachTerminal'
      ].includes(method)) throw error
      await this.requestOnce('claimSession', { id: input.id })
      return this.requestOnce(method, input)
    }
  }
  async requestOnce(method, input = {}) {
    const snapshot = this.lastSnapshot || await this.snapshot()
    const row = [...snapshot.projects, ...snapshot.profiles, ...snapshot.sessions].find(r => r.id === (input.projectId || input.id))
    const hostId = input.hostId || row?.hostId || 'local'
    if (input.patch?.hostId && input.patch.hostId !== hostId) fail('HOST_MISMATCH')
    if (hostId !== 'local') {
      const params = { ...input }
      if ('hostId' in params) params.hostId = 'local'
      if (params.patch?.hostId) params.patch = { ...params.patch, hostId: 'local' }
      const result = await this.remotes.request(hostId, method, params)
      if (result && result.hostId) result.hostId = hostId
      return result
    }
    return this.localRequest(method, input)
  }
  async snapshot() {
    let s
    if (!this.tmuxPath)
      s = {
        version: 1,
        seq: 0,
        hosts: [
          { id: 'local', name: 'This Mac', kind: 'local', available: true }
        ],
        projects: [],
        profiles: [],
        sessions: [],
        runtime: {
          tmux: false,
          pty: this.ptyAvailable,
          claude: !!executable('claude'),
          chat: false,
          reason: 'Install tmux to start persistent Code sessions.'
        }
      }
    else s = await this.localRequest('snapshot')
    for (const host of this.remotes.hosts) {
      let remote = this.remotes.snapshots.get(host.id)
      if (this.remotes.clients.has(host.id)) {
        try { remote = await this.remotes.snapshot(host.id) } catch { this.remotes.disconnect(host.id) }
      }
      if (remote) for (const key of ['projects', 'profiles', 'sessions'])
        s[key].push(...remote[key].map(row => key === 'sessions' && !this.remotes.clients.has(host.id) ? { ...row, state: 'disconnected', error: 'HOST_DISCONNECTED' } : row))
    }
    s.hosts.push(...this.remotes.rows())
    s.runtime = {
      tmux: !!this.tmuxPath || this.remotes.clients.size > 0,
      pty: this.ptyAvailable,
      claude: !!executable('claude'),
      chat: !!this.tmuxPath || this.remotes.clients.size > 0,
      reason: !this.ptyAvailable ? 'Terminal requires the native PTY helper.'
        : !this.tmuxPath && !this.remotes.clients.size ? 'Install tmux locally or connect an SSH host.' : null
    }
    const signature = JSON.stringify(s)
    if (signature !== this.snapshotSignature) { this.snapshotSignature = signature; this.snapshotSerial++ }
    s.seq = this.snapshotSerial
    this.lastSnapshot = s
    return s
  }
  async refresh() {
    if (this.closed) return
    const s = await this.snapshot()
    if (!this.closed && s.seq !== this.seq) {
      this.seq = s.seq
      this.onChange(s)
    }
    return s
  }
  detach(id, attachmentId) {
    if (attachmentId !== undefined && this.attachments.get(id)?.id !== attachmentId) return
    const attached = this.attachments.has(id) || this.terminals.has(id)
    this.attachments.delete(id)
    const p = this.terminals.get(id)
    if (p) {
      this.terminals.delete(id)
      p.kill()
    }
    return attached
  }
  async invoke(method, input) {
    if (!METHODS.has(method)) fail('UNKNOWN_METHOD')
    if (this.closed) fail('SERVICE_CLOSED')
    if (
      input !== undefined &&
      (!input || typeof input !== 'object' || Array.isArray(input))
    )
      fail('INVALID_REQUEST')
    if (['attachTerminal','detachTerminal','writeTerminal','resizeTerminal'].includes(method) && input?.attachmentId !== undefined && !uuid(input.attachmentId)) fail('INVALID_REQUEST')
    if (method === 'snapshot') return this.snapshot()
    if (method === 'discoverHosts') return discoverAliases()
    if (method === 'listPreviews') return this.previews.list()
    if (method === 'stopPreview') return this.previews.stop(input.id)
    if (['createHost','updateHost','deleteHost','connectHost','disconnectHost'].includes(method)) {
      let result
      if (method === 'createHost') result = this.remotes.create(input)
      if (method === 'updateHost') result = this.remotes.update(input)

      if (method === 'connectHost') result = await this.remotes.connect(input.id)
      if (method === 'disconnectHost' || method === 'deleteHost') {
        for (const s of this.lastSnapshot?.sessions || []) if (s.hostId === input.id) this.detach(s.id)
        for (const preview of this.previews.list()) if (this.lastSnapshot?.projects.find(p => p.id === preview.projectId)?.hostId === input.id) this.previews.stop(preview.id)
        result = method === 'deleteHost' ? this.remotes.delete(input.id) : this.remotes.disconnect(input.id)
      }
      await this.refresh()
      return result
    }
    if (method === 'openPreview' || method === 'revealFile') {
      const s = await this.snapshot(), p = s.projects.find(p => p.id === input.projectId)
      if (!p) fail('NOT_FOUND')
      if (method === 'openPreview') {
        if (p.hostId !== 'local' && !this.remotes.clients.has(p.hostId)) fail('HOST_DISCONNECTED')
        return this.previews.open(p, input.url, p.hostId === 'local' ? null : this.remotes.find(p.hostId))
      }
      if (p.hostId !== 'local') fail('LOCAL_ONLY')
      if (!this.reveal) fail('UNAVAILABLE')
      await this.reveal(resolveFile(p.cwd, input.path).target)
      return { ok: true }
    }
    if (method === 'pickDirectory')
      return this.pickDirectory ? await this.pickDirectory() : null
    if (method === 'openExternal') {
      let url
      try {
        url = new URL(input?.url)
      } catch {
        fail('INVALID_REQUEST')
      }
      if (!['https:', 'http:'].includes(url.protocol)) fail('INVALID_REQUEST')
      if (!this.openExternal) fail('UNAVAILABLE')
      await this.openExternal(url.href)
      return { ok: true }
    }
    if (method === 'revealProject') {
      const s = await this.snapshot(),
        p = s.projects.find((p) => p.id === input?.id)
      if (!p) fail('NOT_FOUND')
      if (p.hostId !== 'local') fail('LOCAL_ONLY')
      if (!this.reveal) fail('UNAVAILABLE')
      await this.reveal(p.cwd)
      return { ok: true }
    }
    if (method === 'attachTerminal') {
      if (!this.ptyAvailable) fail('PTY_UNAVAILABLE')
      this.detach(input.id)
      const attachment = { id: input.attachmentId || randomUUID() }
      this.attachments.set(input.id, attachment)
      try {
      await this.request(method, { ...input, attachmentId: attachment.id })
      const paths = prepareRoot(this.directory)
      const env = { ...process.env, TERM: 'xterm-256color' }
      delete env.TMUX
      delete env.ELECTRON_RUN_AS_NODE
      const snapshot = await this.snapshot()
      if (this.closed || this.attachments.get(input.id) !== attachment) fail('ATTACHMENT_SUPERSEDED')
      const session = snapshot.sessions.find(s => s.id === input.id)
      if (!session) fail('NOT_FOUND')
      const external = session.ownership === 'external'
      let binary = this.tmuxPath
      let args = [...(external ? [] : ['-f', '/dev/null', '-S', paths.tmuxSocket]), 'attach-session', '-t', external ? session.tmuxTarget : '=zqc-' + input.id]
      if (session.hostId !== 'local') {
        const host = this.remotes.find(session.hostId), client = this.remotes.clients.get(session.hostId)
        if (!client) fail('HOST_DISCONNECTED')
        binary = '/usr/bin/ssh'
        args = sshArgs(host.sshAlias, [client.metadata.tmuxPath, ...(external ? [] : ['-f','/dev/null','-S',path.posix.join(client.metadata.root,'tmux')]), 'attach-session','-t', external ? session.tmuxTarget : '=zqc-' + input.id], true)
      }
      const terminal = this.pty.spawn(binary, args, {
        name: 'xterm-256color', cols: input.cols, rows: input.rows, cwd: this.directory, env
      })
      this.terminals.set(input.id, terminal)
      this.onTerminal({ sessionId: input.id, attachmentId: attachment.id, data: '', reset: true })
      let queued = '',
        scheduled = false
      terminal.onData((data) => {
        if (this.terminals.get(input.id) !== terminal) return
        queued += data
        if (Buffer.byteLength(queued) > 262144) {
          this.detach(input.id)
          this.onTerminal({
            sessionId: input.id,
            attachmentId: attachment.id,
            data: '\r\n[Terminal detached: output exceeded buffer. Reconnect to repaint.]\r\n'
          })
          return
        }
        if (!scheduled) {
          scheduled = true
          setImmediate(() => {
            scheduled = false
            if (queued && this.terminals.get(input.id) === terminal)
              this.onTerminal({ sessionId: input.id, attachmentId: attachment.id, data: queued })
            queued = ''
          })
        }
      })
      terminal.onExit(() => {
        if (this.terminals.get(input.id) === terminal) {
          this.terminals.delete(input.id)
          this.attachments.delete(input.id)
        }
      })
      return { ok: true, attachmentId: attachment.id }
      } catch (error) {
        if (this.attachments.get(input.id) === attachment) this.detach(input.id, attachment.id)
        throw error
      }
    }
    if (method === 'detachTerminal') {
      if (this.detach(input?.id, input?.attachmentId)) await this.request('detachTerminal', input)
      return { ok: true }
    }
    if (['writeTerminal', 'resizeTerminal'].includes(method)) {
      if (input.attachmentId !== undefined && this.attachments.get(input.id)?.id !== input.attachmentId) fail('ATTACHMENT_SUPERSEDED')
      const terminal = this.terminals.get(input.id)
      if (!terminal) fail('TERMINAL_NOT_ATTACHED')
      await this.request(method, input)
      if (this.terminals.get(input.id) !== terminal) fail('ATTACHMENT_SUPERSEDED')
      if (method === 'resizeTerminal') terminal.resize(input.cols, input.rows)
      return { ok: true }
    }
    if (method === 'stopSession') {
      const session = (await this.snapshot()).sessions.find(s => s.id === input?.id)
      if (session?.ownership === 'external') {
        this.detach(input.id)
        await this.request('releaseSession', { id: input.id })
        return session
      }
    }
    const result = await this.request(method, input)
    if (['stopSession', 'switchSession', 'releaseSession'].includes(method))
      this.detach(input?.id)
    if (!['events', 'claimSession', 'releaseSession'].includes(method))
      await this.refresh()
    return result
  }
  close() {
    this.closed = true
    clearInterval(this.timer)
    this.attachments.clear()
    for (const id of this.terminals.keys()) this.detach(id)
    this.client?.close()
    this.remotes.close()
    this.previews.close()
    this.client = null
  }
}
module.exports = { CodeService, METHODS }
