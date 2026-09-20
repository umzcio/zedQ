// Own only the native CLI launched for this zQ tab. Signal its entire owned
// terminal group, including account-launcher shells, before closing tmux.
const fs = require('node:fs'), path = require('node:path')
const { spawn, execFileSync } = require('node:child_process')
const { atomic, privateRead } = require('./code-catalog.cjs')
const { groupAbsent } = require('./process-ownership.cjs')
const root = process.argv[2], id = process.argv[3]
const configFile = path.join(root, id + '.launch.json')
const config = privateRead(configFile)
fs.unlinkSync(configFile)
const file = path.join(root, id + '.ownership.json')
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
const child = spawn(config.launch.file, config.launch.args, { cwd: config.launch.cwd, env, stdio: 'inherit' })
const record = { nonce: config.nonce, nativeId: config.nativeId }
let childGroup = process.pid
function resolveGroup() {
  const group = Number(execFileSync('/bin/ps', ['-o', 'pgid=', '-p', String(child.pid)], {encoding:'utf8', timeout:2000}).trim())
  if (group === child.pid || group === process.pid) childGroup = group
  return group
}
atomic(file, { ...record, state: 'running', pid: process.pid })
const ready = setTimeout(() => {
  try { resolveGroup() } catch {}
  atomic(file, { ...record, state: 'running', pid: childGroup, ready: true })
}, 1800)
let stopping = false
process.on('SIGTERM', () => {
  if (stopping) return
  stopping = true
  clearTimeout(ready)
  // Kimi's native launcher forwards SIGTERM to its engine itself. Signalling
  // its wider group would terminate that forwarding parent too early.
  if (config.adapter !== 'codex') { if (child.pid) child.kill('SIGTERM'); return }
  // Interactive zsh can put itself in a new group. Resolve only our live
  // child, never a PID recovered from a previous launch or another session.
  try {
    const group = resolveGroup()
    if (group === child.pid || group === process.pid) process.kill(-group, 'SIGTERM')
    else child.kill('SIGTERM')
  } catch { if (child.pid) child.kill('SIGTERM') }
})
child.on('error', () => { clearTimeout(ready); atomic(file, { ...record, state: 'exited' }); process.exit(1) })
child.on('exit', code => {
  clearTimeout(ready)
  const finish = () => {
    // The account shell may exit before the CLI finishes flushing history.
    if (childGroup !== process.pid && !groupAbsent(childGroup)) { setTimeout(finish, 50); return }
    atomic(file, { ...record, state: 'exited', pid: childGroup })
    process.exit(code || 0)
  }
  finish()
})
