const fs = require('node:fs'),
  path = require('node:path'),
  os = require('node:os')
const { connectCodeService } = require('./session-client.cjs')
const { prepareRoot, fail } = require('./service-storage.cjs')
const METHODS = new Set([
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
  async request(method, input) {
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
  async snapshot() {
    if (!this.tmuxPath)
      return {
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
    const s = await this.request('snapshot')
    s.runtime = {
      tmux: true,
      pty: this.ptyAvailable,
      claude: !!executable('claude'),
      chat: true,
      reason: this.ptyAvailable
        ? null
        : 'Terminal requires the native PTY helper.'
    }
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
  detach(id) {
    const p = this.terminals.get(id)
    if (p) {
      this.terminals.delete(id)
      p.kill()
    }
  }
  async invoke(method, input) {
    if (!METHODS.has(method)) fail('UNKNOWN_METHOD')
    if (this.closed) fail('SERVICE_CLOSED')
    if (
      input !== undefined &&
      (!input || typeof input !== 'object' || Array.isArray(input))
    )
      fail('INVALID_REQUEST')
    if (method === 'snapshot') return this.snapshot()
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
      if (!this.reveal) fail('UNAVAILABLE')
      await this.reveal(p.cwd)
      return { ok: true }
    }
    if (method === 'attachTerminal') {
      await this.request(method, input)
      if (!this.ptyAvailable) fail('PTY_UNAVAILABLE')
      this.detach(input.id)
      const paths = prepareRoot(this.directory)
      const env = { ...process.env, TERM: 'xterm-256color' }
      delete env.TMUX
      delete env.ELECTRON_RUN_AS_NODE
      const terminal = this.pty.spawn(
        this.tmuxPath,
        [
          '-f',
          '/dev/null',
          '-S',
          paths.tmuxSocket,
          'attach-session',
          '-t',
          '=zqc-' + input.id
        ],
        {
          name: 'xterm-256color',
          cols: input.cols,
          rows: input.rows,
          cwd: this.directory,
          env
        }
      )
      this.terminals.set(input.id, terminal)
      this.onTerminal({ sessionId: input.id, data: '', reset: true })
      let queued = '',
        scheduled = false
      terminal.onData((data) => {
        queued += data
        if (Buffer.byteLength(queued) > 262144) {
          this.detach(input.id)
          this.onTerminal({
            sessionId: input.id,
            data: '\r\n[Terminal detached: output exceeded buffer. Reconnect to repaint.]\r\n'
          })
          return
        }
        if (!scheduled) {
          scheduled = true
          setImmediate(() => {
            scheduled = false
            if (queued && this.terminals.get(input.id) === terminal)
              this.onTerminal({ sessionId: input.id, data: queued })
            queued = ''
          })
        }
      })
      terminal.onExit(() => {
        if (this.terminals.get(input.id) === terminal)
          this.terminals.delete(input.id)
      })
      return { ok: true }
    }
    if (method === 'detachTerminal') {
      this.detach(input?.id)
      return this.request('releaseSession', input)
    }
    if (['writeTerminal', 'resizeTerminal'].includes(method)) {
      await this.request(method, input)
      const terminal = this.terminals.get(input.id)
      if (!terminal) fail('TERMINAL_NOT_ATTACHED')
      if (method === 'resizeTerminal') terminal.resize(input.cols, input.rows)
      return { ok: true }
    }
    if (['stopSession', 'switchSession', 'releaseSession'].includes(method))
      this.detach(input?.id)
    const result = await this.request(method, input)
    if (!['events', 'claimSession', 'releaseSession'].includes(method))
      await this.refresh()
    return result
  }
  close() {
    this.closed = true
    clearInterval(this.timer)
    for (const id of this.terminals.keys()) this.detach(id)
    this.client?.close()
    this.client = null
  }
}
module.exports = { CodeService, METHODS }
