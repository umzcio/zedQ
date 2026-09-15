// Claude SessionStart hook: retain only identity, never transcript or credentials.
const fs = require('node:fs'),
  path = require('node:path')
const { uuid } = require('./service-storage.cjs')
let data = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (s) => {
  data += s
  if (Buffer.byteLength(data) > 65536) process.exit(1)
})
process.stdin.on('end', () => {
  try {
    const m = JSON.parse(data),
      [file, nonce] = process.argv.slice(2)
    if (
      !uuid(m.session_id) ||
      !uuid(nonce) ||
      !path.isAbsolute(file) ||
      typeof m.cwd !== 'string' ||
      m.hook_event_name !== 'SessionStart'
    )
      process.exit(1)
    fs.writeFileSync(
      file,
      JSON.stringify({
        nativeId: m.session_id,
        cwd: m.cwd,
        source: m.source,
        nonce
      }),
      { flag: 'wx', mode: 0o600 }
    )
  } catch {
    process.exit(1)
  }
})
