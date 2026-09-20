// ACP is Kimi's published client protocol. History is replayed by session/load;
// zQ never reconstructs a conversation by feeding its own transcript to a model.
const { randomUUID } = require('node:crypto')
const { fail } = require('./service-storage.cjs')
class KimiProtocol {
  constructor({ nativeId, cwd, send, event }) {
    Object.assign(this, { nativeId, cwd, send, event, buffer: '', state: 'starting', initialized: false, verified: false })
    this.pending = new Map()
    this.requests = new Map()
    this.serial = 0
    this.chunk = null
  }
  request(method, params, callback) {
    const id = ++this.serial
    this.requests.set(id, callback)
    this.send({ jsonrpc: '2.0', id, method, params })
  }
  initialize() {
    this.request('initialize', { protocolVersion: 1, clientCapabilities: {}, clientInfo: { name: 'zQ', version: '1' } }, result => {
      if (!result.agentCapabilities?.loadSession) fail('KIMI_PROTOCOL_UNSUPPORTED')
      this.request(this.nativeId ? 'session/load' : 'session/new', {
        ...(this.nativeId ? { sessionId: this.nativeId } : {}), cwd: this.cwd, mcpServers: []
      }, result => {
        this.flush()
        if (!this.nativeId) this.nativeId = result.sessionId
        if (!validNativeId(this.nativeId)) fail('IDENTITY_MISMATCH')
        this.config(result.configOptions)
        this.initialized = this.verified = true
        this.state = 'ready'
      })
    })
  }
  config(options) {
    const model = options?.find(o => o.category === 'model' || o.id === 'model')
    if (typeof model?.currentValue === 'string') this.model = model.currentValue
  }
  feed(data) {
    this.buffer += data
    let n
    while ((n = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, n); this.buffer = this.buffer.slice(n + 1)
      if (!line.trim()) continue
      if (Buffer.byteLength(line) > 2 * 1024 * 1024) fail('PROTOCOL_TOO_LARGE')
      let message
      try { message = JSON.parse(line) } catch { fail('INVALID_PROTOCOL') }
      this.receive(message)
    }
    if (Buffer.byteLength(this.buffer) > 2 * 1024 * 1024) fail('PROTOCOL_TOO_LARGE')
  }
  flush() {
    clearTimeout(this.streamTimer)
    this.streamTimer = null
    if (this.chunk) { this.event(this.chunk); this.chunk = null }
  }
  receive(m) {
    if (m?.jsonrpc !== '2.0') fail('INVALID_PROTOCOL')
    if (!m.method) {
      const callback = this.requests.get(m.id)
      if (!callback) return
      this.requests.delete(m.id)
      if (m.error) {
        this.flush()
        this.state = 'error'
        // Protocol errors may contain tool output; only expose the bounded message.
        this.event({ kind: 'error', text: String(m.error.message || 'Kimi request failed').slice(0, 2000) })
        if (!this.initialized) fail(m.error.code === -32000 ? 'KIMI_AUTH_REQUIRED' : 'KIMI_LOAD_FAILED')
        return
      }
      callback(m.result || {})
      return
    }
    const p = m.params || {}
    if (p.sessionId && this.nativeId && p.sessionId !== this.nativeId) fail('IDENTITY_MISMATCH')
    if (m.method === 'session/update') {
      const u = p.update || {}
      const kind = { user_message_chunk: 'user', agent_message_chunk: 'assistant', agent_thought_chunk: 'thinking' }[u.sessionUpdate]
      if (kind) {
        const text = u.content?.type === 'text' ? u.content.text : `[${u.content?.type || 'attachment'}]`
        if (typeof text !== 'string') return
        // Kimi ACP replays injected context reminders as user chunks. They are
        // engine context, not messages the person entered. Do not display them.
        if (!this.initialized && kind === 'user' && /^<system-reminder>[\s\S]*<\/system-reminder>$/.test(text.trim())) return
        if (this.chunk?.kind !== kind) this.flush()
        this.chunk ||= { kind, text: '', eventId: randomUUID() }
        this.chunk.text += text
        // Stream a replacement event, not a paragraph per token. The native
        // transcript remains complete even when the bounded display is trimmed.
        if (this.chunk.text.length > 30000) this.flush()
        else if (this.initialized && !this.streamTimer) this.streamTimer = setTimeout(() => {
          this.streamTimer = null
          if (this.chunk) this.event({ ...this.chunk, stream: true })
        }, 75)
        return
      }
      this.flush()
      if (u.sessionUpdate === 'tool_call' || u.sessionUpdate === 'tool_call_update') {
        this.event({ kind: 'tool', eventId: (this.initialized ? 'live-tool-' : 'history-tool-') + u.toolCallId, toolName: u.title,
          text: (u.content || []).map(c => c.type === 'content' ? c.content?.text || `[${c.content?.type}]` : c.type === 'diff' ? `${c.path}\n${c.newText || ''}` : c.type).join('\n') || u.status || 'Tool started',
          ...(u.rawInput !== undefined ? { input: { arguments: u.rawInput } } : {}) })
      } else if (u.sessionUpdate === 'config_option_update') this.config(u.configOptions)
      return
    }
    if (m.method === 'session/request_permission' && m.id !== undefined) {
      this.flush()
      if (this.pending.size >= 32) fail('PROTOCOL_TOO_LARGE')
      const key = String(m.id)
      this.pending.set(key, { id: m.id, ...p })
      this.state = 'approval'
      this.event({ kind: 'permission', requestId: key, text: (p.toolCall?.content || []).map(c => c.content?.text || '').filter(Boolean).join('\n') || p.toolCall?.title || 'Kimi needs permission',
        toolName: p.toolCall?.title, input: { ...p.toolCall, options: p.options } })
      return
    }
    if (m.id !== undefined) this.send({ jsonrpc: '2.0', id: m.id, error: { code: -32601, message: 'Client capability not supported' } })
  }
  message(text) {
    if (!this.verified || this.state !== 'ready') fail('SESSION_NOT_READY')
    this.flush()
    this.state = 'busy'
    this.event({ kind: 'user', text })
    this.request('session/prompt', { sessionId: this.nativeId, prompt: [{ type: 'text', text }] }, result => {
      this.flush()
      for (const id of this.pending.keys()) this.event({ kind: 'status', text: 'Request ended', requestId: id, resolved: true })
      this.pending.clear()
      this.state = 'ready'
      this.event({ kind: 'status', text: result.stopReason === 'cancelled' ? 'Interrupted' : 'Turn complete' })
    })
  }
  respond(id, allow, answers) {
    const request = this.pending.get(id)
    if (!request) fail('UNKNOWN_PERMISSION')
    const option = request.options?.find(o => answers?.optionId ? o.optionId === answers.optionId : o.kind === (allow ? 'allow_once' : 'reject_once'))
    if (answers?.optionId && !option) fail('UNKNOWN_PERMISSION')
    // Never silently promote "allow once" into an always-allow rule.
    if (allow && !option) fail('KIMI_PERMISSION_UNSUPPORTED')
    this.send({ jsonrpc: '2.0', id: request.id, result: { outcome: option ? { outcome: 'selected', optionId: option.optionId } : { outcome: 'cancelled' } } })
    this.pending.delete(id)
    this.state = this.pending.size ? 'approval' : 'busy'
    this.event({ kind: 'status', text: allow ? 'Permission allowed' : 'Permission denied', requestId: id, resolved: true })
  }
  interrupt() { this.send({ jsonrpc: '2.0', method: 'session/cancel', params: { sessionId: this.nativeId } }) }
  close(done) {
    this.flush()
    if (!this.nativeId || !this.initialized) return done()
    this.request('session/close', { sessionId: this.nativeId }, done)
  }
}
function validNativeId(value) { return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$/.test(value) }
module.exports = { KimiProtocol, validNativeId }
