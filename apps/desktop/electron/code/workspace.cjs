const fs = require('node:fs')
const path = require('node:path')
const { createHash, randomUUID } = require('node:crypto')
const { execFile } = require('node:child_process')
const { fail } = require('./service-storage.cjs')
const MAX_FILE = 24000
const fingerprint = b => createHash('sha256').update(b).digest('hex')
function resolveFile(root, relative = '', directory = false) {
  if (typeof relative !== 'string' || relative.includes('\0') || path.isAbsolute(relative)
    || relative.split(/[\\/]/).some(p => p === '..') || relative.length > 4096) fail('INVALID_PATH')
  const base = fs.realpathSync(root)
  let target = base
  for (const part of relative.split('/').filter(p => p && p !== '.')) {
    target = path.join(target, part)
    if (fs.lstatSync(target).isSymbolicLink()) fail('SYMLINK_NOT_SUPPORTED')
  }
  if (target !== base && !target.startsWith(base + path.sep)) fail('PATH_OUTSIDE_PROJECT')
  const stat = fs.lstatSync(target)
  if (directory ? !stat.isDirectory() : !stat.isFile()) fail('INVALID_FILE_TYPE')
  return { target, stat, relative: path.relative(base, target) }
}
function read(root, relative) {
  const { target, relative: normalized } = resolveFile(root, relative)
  const fd = fs.openSync(target, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW)
  try {
    const stat = fs.fstatSync(fd)
    if (!stat.isFile()) fail('INVALID_FILE_TYPE')
    if (stat.size > MAX_FILE) fail('FILE_TOO_LARGE')
    const data = Buffer.alloc(MAX_FILE + 1)
    const size = fs.readSync(fd, data, 0, data.length, 0)
    if (size > MAX_FILE) fail('FILE_TOO_LARGE')
    const bytes = data.subarray(0, size)
    if (bytes.includes(0)) fail('BINARY_FILE')
    let text
    try { text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes) } catch { fail('BINARY_FILE') }
    return { path: normalized, text, fingerprint: fingerprint(bytes) }
  } finally { fs.closeSync(fd) }
}
function write(root, input) {
  if (typeof input.text !== 'string' || input.text.includes('\0') || Buffer.byteLength(input.text) > MAX_FILE
    || typeof input.fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(input.fingerprint)) fail('INVALID_REQUEST')
  const before = read(root, input.path)
  if (before.fingerprint !== input.fingerprint) fail('FILE_CONFLICT')
  const { target, stat } = resolveFile(root, input.path)
  if (stat.nlink !== 1) fail('HARDLINK_NOT_SUPPORTED')
  const tmp = path.join(path.dirname(target), '.zq-' + randomUUID() + '.tmp')
  let fd
  try {
    fd = fs.openSync(tmp, 'wx', stat.mode & 0o777)
    fs.fchmodSync(fd, stat.mode & 0o777)
    fs.writeFileSync(fd, input.text, 'utf8')
    fs.fsyncSync(fd)
    fs.closeSync(fd); fd = undefined
    const checked = resolveFile(root, input.path)
    if (checked.target !== target || checked.stat.ino !== stat.ino || read(root, input.path).fingerprint !== before.fingerprint) fail('FILE_CONFLICT')
    fs.renameSync(tmp, target)
    return read(root, input.path)
  } finally {
    if (fd !== undefined) fs.closeSync(fd)
    try { fs.unlinkSync(tmp) } catch (e) { if (e.code !== 'ENOENT') throw e }
  }
}
function list(root, relative = '') {
  const { target, relative: normalized } = resolveFile(root, relative, true)
  const names = fs.readdirSync(target, { withFileTypes: true }).filter(e => e.name !== '.git').sort((a,b) => a.name.localeCompare(b.name))
  const entries = []
  let bytes = 0
  for (const e of names.slice(0,512)) {
    const entry = { name: e.name, path: path.posix.join(normalized,e.name),
      kind: e.isSymbolicLink() ? 'symlink' : e.isDirectory() ? 'directory' : 'file',
      size: fs.lstatSync(path.join(target,e.name)).size }
    bytes += Buffer.byteLength(JSON.stringify(entry))
    if (bytes > 200000) break
    entries.push(entry)
  }
  return { entries, truncated: entries.length < names.length }
}
function git(root, args) {
  const binary = [...(process.platform === 'darwin' ? ['/opt/homebrew/bin/git','/usr/local/bin/git'] : []),
    ...(process.env.PATH || '').split(path.delimiter).map(dir => path.join(dir,'git'))].find(file => {
      try { fs.accessSync(file,fs.constants.X_OK); return true } catch { return false }
    })
  if (!binary) fail('GIT_UNAVAILABLE')
  const env = { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_CONFIG_NOSYSTEM: '1', GIT_EXTERNAL_DIFF: '' }
  for (const key of ['GIT_DIR','GIT_WORK_TREE','GIT_INDEX_FILE','GIT_COMMON_DIR']) delete env[key]
  return new Promise((resolve, reject) => execFile(binary, ['--literal-pathspecs', '-C', root, ...args], {
    encoding: 'utf8', timeout: 5000, maxBuffer: 256000,
    env
  }, (err, stdout, stderr) => {
    if (!err) return resolve(stdout)
    const code = /not a git repository/i.test(stderr || '') ? 'NOT_GIT_REPOSITORY' : 'GIT_UNAVAILABLE'
    reject(Object.assign(new Error(code), { code }))
  }))
}
async function status(root) {
  const raw = await git(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all'])
  const records = raw.split('\0'), changes = []
  for (let i = 0; i < records.length; i++) {
    const r = records[i]
    if (!r) continue
    const item = { path: r.slice(3), index: r[0], worktree: r[1], untracked: r.startsWith('??') }
    if (/[RC]/.test(r.slice(0,2))) item.previousPath = records[++i]
    changes.push(item)
  }
  return { changes: changes.slice(0,512), truncated: changes.length > 512 }
}
async function diff(root, input) {
  // Deleted paths cannot be realpathed; validate every existing ancestor first.
  if (typeof input.path !== 'string' || !input.path || path.isAbsolute(input.path) || input.path.includes('\0')
    || input.path.split(/[\\/]/).includes('..') || (input.staged !== undefined && typeof input.staged !== 'boolean')) fail('INVALID_PATH')
  let probe = input.path
  while (probe && probe !== '.') {
    try { const st = fs.lstatSync(path.join(root, probe)); resolveFile(root, probe, st.isDirectory()); break }
    catch (e) { if (e.code !== 'ENOENT') throw e; probe = path.dirname(probe) }
  }
  const change = (await status(root)).changes.find(c => c.path === input.path)
  let output
  if (change?.untracked && !input.staged) {
    const file = read(root, input.path)
    output = `--- /dev/null\n+++ b/${input.path}\n@@ -0,0 +1,${file.text.split('\n').length} @@\n` + file.text.split('\n').map(l => '+' + l).join('\n')
  } else output = await git(root, ['diff', '--no-ext-diff', '--no-textconv', '--no-color', ...(input.staged ? ['--cached'] : []), '--', input.path])
  return { diff: output.slice(0,64000), truncated: output.length > 64000 }
}
const workspaceMethods = new Set(['listFiles','readFile','writeFile','gitStatus','gitDiff'])
async function workspace(root, method, input) {
  if (method === 'listFiles') return list(root, input.path)
  if (method === 'readFile') return read(root, input.path)
  if (method === 'writeFile') return write(root, input)
  if (method === 'gitStatus') return status(root)
  if (method === 'gitDiff') return diff(root, input)
  fail('UNKNOWN_METHOD')
}
module.exports = { workspace, workspaceMethods, resolveFile, MAX_FILE }
