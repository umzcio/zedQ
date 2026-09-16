const fs = require('node:fs')
const path = require('node:path')
const { randomUUID } = require('node:crypto')
const { fail, uuid } = require('./service-storage.cjs')
const text = (v, max = 4096) =>
  typeof v === 'string' &&
  v.trim().length > 0 &&
  v.length <= max &&
  !v.includes('\0')
function keys(value, allowed) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).some((k) => !allowed.includes(k))
  )
    fail('INVALID_REQUEST')
}
function privateRead(file) {
  const s = fs.lstatSync(file)
  if (
    !s.isFile() ||
    s.isSymbolicLink() ||
    s.uid !== process.getuid() ||
    s.mode & 0o077 ||
    s.nlink !== 1 ||
    s.size > 4 * 1024 * 1024
  )
    fail('UNSAFE_SERVICE_PATH')
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW)
  try {
    return JSON.parse(fs.readFileSync(fd, 'utf8'))
  } finally {
    fs.closeSync(fd)
  }
}
function atomic(file, value) {
  const data = JSON.stringify(value)
  if (Buffer.byteLength(data) > 4 * 1024 * 1024) fail('STORAGE_UNAVAILABLE')
  if (fs.existsSync(file)) privateRead(file)
  const tmp = file + '.' + randomUUID() + '.tmp'
  let fd
  try {
    fd = fs.openSync(tmp, 'wx', 0o600)
    fs.writeFileSync(fd, data)
    fs.fsyncSync(fd)
    fs.closeSync(fd)
    fd = null
    fs.renameSync(tmp, file)
    const parent = fs.openSync(path.dirname(file), 'r')
    try {
      fs.fsyncSync(parent)
    } finally {
      fs.closeSync(parent)
    }
  } finally {
    if (fd) fs.closeSync(fd)
    try {
      fs.unlinkSync(tmp)
    } catch (e) {
      if (e.code !== 'ENOENT') throw e
    }
  }
}
class CodeCatalog {
  constructor(
    root,
    { seedFile = '/Users/zach/GitHub/dotfiles/claude/multi-account.zsh' } = {}
  ) {
    fs.mkdirSync(root, { recursive: true, mode: 0o700 })
    const stat = fs.lstatSync(root)
    if (
      !stat.isDirectory() ||
      stat.isSymbolicLink() ||
      stat.uid !== process.getuid() ||
      stat.mode & 0o077
    )
      fail('UNSAFE_SERVICE_PATH')
    this.file = path.join(root, 'code.json')
    this.blocked = false
    try {
      this.value = privateRead(this.file)
      if (
        this.value.version !== 1 ||
        !Number.isSafeInteger(this.value.seq) ||
        !['projects', 'profiles', 'sessions'].every((k) =>
          Array.isArray(this.value[k])
        )
      )
        fail('INVALID_CATALOG')
    } catch (e) {
      if (e.code !== 'ENOENT') throw e
      this.value = {
        version: 1,
        seq: 0,
        projects: [],
        profiles: [],
        sessions: []
      }
      let source = ''
      try {
        const s = fs.statSync(seedFile)
        if (s.isFile() && s.size < 1024 * 1024)
          source = fs.readFileSync(seedFile, 'utf8')
      } catch {}
      for (const name of [
        'claude-cio',
        'claude-team',
        'claude-api',
        'claude-gmail',
        'claude-azure',
        'claude-chatmt'
      ])
        if (
          new RegExp(
            '(?:^|\\n)\\s*(?:function\\s+)?' + name + '\\s*(?:\\(\\s*\\)|\\{)'
          ).test(source)
        )
          this.value.profiles.push(
            this.profile({ name, launcherFile: seedFile, functionName: name, sharedHistoryConfirmed: true })
          )
      this.save()
    }
    // Plain `claude` is available independently of custom account functions.
    // Seed once for existing catalogs too; respect later deletion or renaming.
    if (!this.value.defaultClaudeSeeded) {
      if (!this.value.profiles.some(p => p.hostId === 'local' && p.functionName === 'claude')) {
        this.value.profiles.unshift(this.profile({
          name: 'claude', launcherFile: '/dev/null', functionName: 'claude',
          sharedHistoryConfirmed: true
        }))
      }
      this.value.defaultClaudeSeeded = true
      this.save()
    }
  }
  save() {
    if (this.blocked) fail('STORAGE_UNAVAILABLE')
    this.value.seq++
    try {
      atomic(this.file, this.value)
    } catch {
      this.blocked = true
      fail('STORAGE_UNAVAILABLE')
    }
  }
  project(input) {
    keys(input, ['name', 'cwd', 'hostId', 'icon', 'color'])
    if (
      !text(input.name, 200) ||
      !text(input.cwd) ||
      !path.isAbsolute(input.cwd) ||
      !fs.statSync(input.cwd).isDirectory() ||
      (input.hostId && input.hostId !== 'local')
    )
      fail('INVALID_REQUEST')
    if (
      (input.icon !== undefined && !text(input.icon, 80)) ||
      (input.color !== undefined && !text(input.color, 40))
    )
      fail('INVALID_REQUEST')
    return {
      id: randomUUID(),
      hostId: 'local',
      name: input.name,
      cwd: fs.realpathSync(input.cwd),
      icon: input.icon || 'Folder',
      color: input.color || 'neutral',
      createdAt: Date.now()
    }
  }
  profile(input) {
    keys(input, [
      'name',
      'launcherFile',
      'functionName',
      'hostId',
      'modes',
      'adapter',
      'sharedHistoryConfirmed'
    ])
    if (
      !text(input.name, 200) ||
      !text(input.launcherFile) ||
      !path.isAbsolute(input.launcherFile) ||
      !text(input.functionName, 100) ||
      !/^[A-Za-z_][A-Za-z0-9_-]*$/.test(input.functionName) ||
      (input.hostId && input.hostId !== 'local') ||
      (input.adapter !== undefined && !['claude', 'terminal'].includes(input.adapter)) ||
      (input.modes &&
        (!Array.isArray(input.modes) ||
          !input.modes.length ||
          input.modes.some((m) => !['chat', 'terminal'].includes(m)))) ||
      (input.sharedHistoryConfirmed !== undefined &&
        typeof input.sharedHistoryConfirmed !== 'boolean')
    )
      fail('INVALID_REQUEST')
    return {
      id: randomUUID(),
      hostId: 'local',
      name: input.name,
      launcherFile: input.launcherFile,
      functionName: input.functionName,
      adapter: input.adapter || 'claude',
      modes: input.adapter === 'terminal' ? ['terminal'] : input.modes || ['chat', 'terminal'],
      sharedHistoryConfirmed: input.sharedHistoryConfirmed || false,
      createdAt: Date.now()
    }
  }
  find(kind, id) {
    if (!uuid(id)) fail('INVALID_REQUEST')
    const row = this.value[kind].find((r) => r.id === id)
    if (!row) fail('NOT_FOUND')
    return row
  }
  createProject(input) {
    if (this.value.projects.length >= 128) fail('LIMIT_REACHED')
    const row = this.project(input)
    this.value.projects.push(row)
    this.save()
    return row
  }
  createProfile(input) {
    if (this.value.profiles.length >= 128) fail('LIMIT_REACHED')
    const row = this.profile(input)
    this.value.profiles.push(row)
    this.save()
    return row
  }
  updateProject({ id, patch }) {
    const row = this.find('projects', id)
    keys(patch, ['name', 'cwd', 'hostId', 'icon', 'color'])
    if (
      ('cwd' in patch || 'hostId' in patch) &&
      this.value.sessions.some((s) => s.projectId === id)
    )
      fail('PROJECT_HAS_SESSIONS')
    const { createdAt, ...validated } = this.project({
      ...Object.fromEntries(
        ['name', 'cwd', 'hostId', 'icon', 'color'].map((k) => [k, row[k]])
      ),
      ...patch
    })
    Object.assign(row, validated, { id })
    this.save()
    return row
  }
  updateProfile({ id, patch }) {
    const row = this.find('profiles', id)
    keys(patch, [
      'name',
      'launcherFile',
      'functionName',
      'hostId',
      'modes',
      'adapter',
      'sharedHistoryConfirmed'
    ])
    if (
      Object.keys(patch).some((k) => k !== 'name') &&
      this.value.sessions.some(
        (s) =>
          s.profileId === id && !['stopped', 'recoverable'].includes(s.state)
      )
    )
      fail('PROFILE_IN_USE')
    const validated = this.profile({
      ...Object.fromEntries(
        [
          'name',
          'launcherFile',
          'functionName',
          'hostId',
          'modes',
          'adapter',
          'sharedHistoryConfirmed'
        ].map((k) => [k, row[k]])
      ),
      ...patch
    })
    Object.assign(row, validated, { id, createdAt: row.createdAt })
    this.save()
    return row
  }
  duplicateProfile({ id }) {
    const row = this.find('profiles', id)
    return this.createProfile({
      ...Object.fromEntries(
        [
          'launcherFile',
          'functionName',
          'hostId',
          'modes',
          'adapter',
          'sharedHistoryConfirmed'
        ].map((k) => [k, row[k]])
      ),
      name: row.name + ' copy'
    })
  }
  deleteProject({ id }) {
    this.find('projects', id)
    if (this.value.sessions.some((s) => s.projectId === id))
      fail('PROJECT_HAS_SESSIONS')
    this.value.projects = this.value.projects.filter((r) => r.id !== id)
    this.save()
    return { ok: true }
  }
  deleteProfile({ id }) {
    this.find('profiles', id)
    if (
      this.value.sessions.some(
        (s) => s.profileId === id || s.recovery?.targetProfileId === id
      )
    )
      fail('PROFILE_IN_USE')
    this.value.profiles = this.value.profiles.filter((r) => r.id !== id)
    this.save()
    return { ok: true }
  }
}
module.exports = { CodeCatalog, atomic, privateRead, keys, text }
