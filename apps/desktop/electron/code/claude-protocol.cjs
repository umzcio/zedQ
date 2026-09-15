const { fail } = require('./service-storage.cjs')
const { randomUUID } = require('node:crypto')
class ClaudeProtocol {
  constructor({ nativeId, send, event }) {
    this.nativeId = nativeId
    this.send = send
    this.event = event
    this.buffer = ''
    this.verified = false
    this.pending = new Map()
    this.state = 'starting'
    this.initialized = false
    this.initializeId = null
  }
  feed(chunk) {
    this.buffer += chunk
    if (Buffer.byteLength(this.buffer) > 262144) fail('PROTOCOL_TOO_LARGE')
    let n
    while ((n = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, n)
      this.buffer = this.buffer.slice(n + 1)
      if (!line.trim()) continue
      let m
      try {
        m = JSON.parse(line)
      } catch {
        fail('INVALID_PROTOCOL')
      }
      this.receive(m)
    }
  }
  initialize() {
    this.initializeId = randomUUID()
    this.send({
      type: 'control_request',
      request_id: this.initializeId,
      request: { subtype: 'initialize', hooks: {} }
    })
  }
  receive(m) {
    if (!m || typeof m !== 'object' || typeof m.type !== 'string')
      fail('INVALID_PROTOCOL')
    if (
      m.type === 'control_response' &&
      m.response?.request_id === this.initializeId
    ) {
      if (m.response.subtype !== 'success') fail('INITIALIZE_FAILED')
      this.initialized = true
      return
    }
    if (m.session_id && m.session_id !== this.nativeId)
      fail('IDENTITY_MISMATCH')
    if (m.type === 'system' && m.subtype === 'init') {
      if (m.session_id !== this.nativeId) fail('IDENTITY_MISMATCH')
      this.verified = true
      this.state = 'ready'
      this.event({ kind: 'status', text: 'Session connected' })
      return
    }
    if (m.type === 'control_request') {
      const r = m.request
      if (!r || typeof m.request_id !== 'string' || m.request_id.length > 200)
        fail('INVALID_PROTOCOL')
      if (r.subtype !== 'can_use_tool') {
        this.send({
          type: 'control_response',
          response: {
            subtype: 'error',
            request_id: m.request_id,
            error: 'Unsupported control request'
          }
        })
        return
      }
      if (this.pending.size >= 32) fail('PROTOCOL_TOO_LARGE')
      this.pending.set(m.request_id, r)
      this.state = 'approval'
      this.event({
        kind: r.tool_name === 'AskUserQuestion' ? 'question' : 'permission',
        text: 'Permission requested',
        requestId: m.request_id,
        toolName: String(r.tool_name || '').slice(0, 200),
        input: r.input || {}
      })
      return
    }
    if (m.type === 'control_cancel_request') {
      this.pending.delete(m.request_id)
      this.event({
        kind: 'status',
        text: 'Permission request cancelled',
        requestId: m.request_id,
        resolved: true
      })
      return
    }
    if (m.type === 'assistant' || m.type === 'user')
      for (const block of m.message?.content || []) {
        if (block.type === 'text')
          this.event({ kind: m.type, text: String(block.text).slice(0, 32768) })
        else if (block.type === 'tool_use')
          this.event({
            kind: 'tool',
            text: 'Tool started',
            toolName: String(block.name).slice(0, 200),
            input: block.input || {}
          })
        else if (block.type === 'tool_result')
          this.event({
            kind: 'tool',
            text: (typeof block.content === 'string'
              ? block.content
              : JSON.stringify(block.content)
            ).slice(0, 32768)
          })
      }
    if (m.type === 'result') {
      this.state = m.is_error ? 'error' : 'ready'
      const errors = Array.isArray(m.errors) ? m.errors.join('\n') : m.result
      this.event({
        kind: m.is_error ? 'error' : 'status',
        text: m.is_error
          ? String(errors || 'Agent failed').slice(0, 32768)
          : 'Turn complete'
      })
    }
    if (
      m.type === 'rate_limit_event' &&
      m.rate_limit_info?.status === 'rejected'
    ) {
      this.state = 'limited'
      this.event({
        kind: 'error',
        text: 'Usage limit reached. Switch profile and continue.'
      })
    }
  }
  message(text) {
    if (!this.verified) fail('SESSION_NOT_READY')
    if (this.pending.size || this.state === 'busy') fail('SESSION_BUSY')
    this.send({
      type: 'user',
      message: { role: 'user', content: text },
      parent_tool_use_id: null,
      session_id: this.nativeId
    })
    this.state = 'busy'
    this.event({ kind: 'user', text })
  }
  respond(id, allow, answers) {
    const r = this.pending.get(id)
    if (!r) fail('UNKNOWN_PERMISSION')
    const response = allow
      ? {
          behavior: 'allow',
          updatedInput: answers ? { ...r.input, answers } : r.input
        }
      : { behavior: 'deny', message: 'Denied by user' }
    this.send({
      type: 'control_response',
      response: { subtype: 'success', request_id: id, response }
    })
    this.pending.delete(id)
    this.state = this.pending.size ? 'approval' : 'busy'
    this.event({
      kind: 'status',
      text: allow ? 'Permission allowed' : 'Permission denied',
      requestId: id,
      resolved: true
    })
  }
  interrupt() {
    this.send({
      type: 'control_request',
      request_id: randomUUID(),
      request: { subtype: 'interrupt' }
    })
  }
}
module.exports = { ClaudeProtocol }
