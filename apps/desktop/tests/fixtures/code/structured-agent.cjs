const fs = require('node:fs'),
  path = require('node:path'),
  { execSync } = require('node:child_process'),
  readline = require('node:readline')
const args = process.argv.slice(2)
const value = (k) => args[args.indexOf(k) + 1]
const fresh = args.includes('--session-id'),
  id = value(fresh ? '--session-id' : '--resume')
const settings = JSON.parse(value('--settings'))
const history = path.join(process.cwd(), id + '.history')
if (!fresh && !fs.existsSync(history)) process.exit(1)
if (process.env.LAZY_HISTORY !== '1') fs.writeFileSync(history, id)
if (process.env.IGNORE_TERM === '1') {
  process.on('SIGTERM', () => {})
  process.on('SIGHUP', () => {})
}
if (process.env.FAIL_TARGET === '1') process.exit(1)
const hook = settings.hooks.SessionStart[0].hooks[0].command
execSync(hook, {
  input: JSON.stringify({
    session_id: id,
    cwd: process.cwd(),
    source: fresh ? 'startup' : 'resume',
    hook_event_name: 'SessionStart',
    transcript_path: history
  }),
  stdio: ['pipe', 'ignore', 'ignore']
})
if (args.includes('--input-format')) {
  const out = (m) => process.stdout.write(JSON.stringify(m) + '\n')
  out({ type: 'system', subtype: 'init', session_id: id, model: args.includes('--model') ? value('--model') : 'fixture-default' })
  readline.createInterface({ input: process.stdin }).on('line', (line) => {
    const m = JSON.parse(line)
    if (m.type === 'control_request' && m.request.subtype === 'initialize')
      out({
        type: 'control_response',
        response: { subtype: 'success', request_id: m.request_id, response: {} }
      })
    else if (
      m.type === 'control_request' &&
      m.request.subtype === 'interrupt'
    ) {
      out({ type: 'control_cancel_request', request_id: 'permission-1' })
      out({ type: 'result', session_id: id, is_error: false })
    } else if (m.type === 'user') {
      fs.writeFileSync(history, id)
      out({
        type: 'assistant',
        session_id: id,
        message: {
          content: [{ type: 'text', text: 'reply:' + m.message.content }]
        }
      })
      if (m.message.content === 'permission')
        out({
          type: 'control_request',
          request_id: 'permission-1',
          request: {
            subtype: 'can_use_tool',
            tool_name: 'Bash',
            input: { command: 'test' }
          }
        })
      else out({ type: 'result', session_id: id, is_error: false })
    } else if (m.type === 'control_response') {
      out({
        type: 'assistant',
        session_id: id,
        message: {
          content: [
            { type: 'text', text: 'decision:' + m.response.response.behavior }
          ]
        }
      })
      out({ type: 'result', session_id: id, is_error: false })
    }
  })
} else {
  process.stdout.write('\x1b[32mterminal:' + id + '\x1b[0m\r\n')
  process.stdin.on('data', (data) => process.stdout.write('echo:' + data))
}
setInterval(() => {}, 1000)
