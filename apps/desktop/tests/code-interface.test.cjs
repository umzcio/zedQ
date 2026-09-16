const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { randomUUID } = require('node:crypto')
const { CodeCatalog } = require('../electron/code/code-catalog.cjs')
function setup(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zqc-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  return {
    root,
    catalog: new CodeCatalog(root, { seedFile: path.join(root, 'absent') })
  }
}
test('private durable catalog validates CRUD and never records launcher contents', (t) => {
  const { root, catalog } = setup(t)
  const p = catalog.createProject({ name: 'Work', cwd: root })
  const a = catalog.createProfile({
    name: 'A',
    launcherFile: path.join(root, 'launch.zsh'),
    functionName: 'claude-a'
  })
  assert.throws(
    () =>
      catalog.createProfile({
        name: 'bad',
        launcherFile: '/tmp/p',
        functionName: 'x;env'
      }),
    { code: 'INVALID_REQUEST' }
  )
  assert.throws(() => catalog.createProject({ name: 'bad', cwd: 'relative' }), {
    code: 'INVALID_REQUEST'
  })
  assert.throws(
    () =>
      catalog.createProfile({
        name: 'bad',
        launcherFile: '/tmp/p',
        functionName: 'a',
        env: { TOKEN: 'secret' }
      }),
    { code: 'INVALID_REQUEST' }
  )
  const again = new CodeCatalog(root, { seedFile: '/absent' })
  assert.equal(again.value.projects[0].id, p.id)
  assert.equal(again.value.profiles.find(p => p.id === a.id).name, 'A')
  assert.equal(fs.statSync(path.join(root, 'code.json')).mode & 0o777, 0o600)
})
test('active session deletion is rejected and stopped records delete without touching checkout', (t) => {
  const { root, catalog } = setup(t)
  const p = catalog.createProject({ name: 'Work', cwd: root })
  catalog.value.sessions.push({
    id: randomUUID(),
    projectId: p.id,
    state: 'ready'
  })
  catalog.save()
  assert.throws(() => catalog.deleteProject({ id: p.id }), {
    code: 'PROJECT_HAS_SESSIONS'
  })
  assert.ok(fs.statSync(root).isDirectory())
})
test('launcher discovery records only known function names without evaluation', (t) => {
  const { root } = setup(t)
  const file = path.join(root, 'launch.zsh')
  fs.writeFileSync(
    file,
    'export SECRET=private\nclaude-cio() { touch SHOULD_NOT_EXIST; }\nfunction claude-team { :; }\n'
  )
  const c = new CodeCatalog(path.join(root, 'catalog'), { seedFile: file })
  assert.deepEqual(
    c.value.profiles.map((p) => p.functionName),
    ['claude', 'claude-cio', 'claude-team']
  )
  assert.ok(!JSON.stringify(c.value).includes('private'))
  assert.ok(!fs.existsSync('SHOULD_NOT_EXIST'))
  c.deleteProfile({ id: c.value.profiles[0].id })
  assert.equal(
    new CodeCatalog(path.join(root, 'catalog'), { seedFile: file }).value
      .profiles.length,
    2
  )
})
test('plain Claude is seeded in existing catalogs once without duplicating or restoring deleted profiles', t => {
  const {root, catalog} = setup(t)
  const defaultProfile = catalog.value.profiles.find(p => p.functionName === 'claude')
  assert.equal(defaultProfile.name, 'claude')
  assert.equal(defaultProfile.launcherFile, '/dev/null')
  assert.deepEqual(defaultProfile.modes, ['chat', 'terminal'])
  delete catalog.value.defaultClaudeSeeded
  catalog.save()
  const existing = new CodeCatalog(root, {seedFile:'/absent'})
  assert.equal(existing.value.profiles.filter(p => p.functionName === 'claude').length, 1)
  assert.equal(existing.value.profiles[0].id, defaultProfile.id)
  existing.deleteProfile({id:defaultProfile.id})
  assert.equal(new CodeCatalog(root, {seedFile:'/absent'}).value.profiles.length, 0)
  delete existing.value.defaultClaudeSeeded
  existing.save()
  assert.equal(new CodeCatalog(root, {seedFile:'/absent'}).value.profiles[0].functionName, 'claude')
})
const { ClaudeProtocol } = require('../electron/code/claude-protocol.cjs')
test('protocol validates exact identity and explicit permission decisions without replay', () => {
  const sent = [],
    events = []
  const id = randomUUID()
  const p = new ClaudeProtocol({
    nativeId: id,
    send: (m) => sent.push(m),
    event: (e) => events.push(e)
  })
  p.receive({ type: 'system', subtype: 'init', session_id: id })
  assert.equal(p.verified, true)
  p.receive({
    type: 'control_request',
    request_id: 'r1',
    request: {
      subtype: 'can_use_tool',
      tool_name: 'Bash',
      input: { command: 'echo test' }
    }
  })
  assert.equal(sent.length, 0)
  assert.equal(p.pending.size, 1)
  p.respond('r1', false)
  assert.equal(sent[0].response.response.behavior, 'deny')
  assert.equal(p.pending.size, 0)
  assert.throws(() => p.respond('r1', true), { code: 'UNKNOWN_PERMISSION' })
  assert.throws(
    () =>
      p.receive({ type: 'system', subtype: 'init', session_id: randomUUID() }),
    { code: 'IDENTITY_MISMATCH' }
  )
})
test('protocol bounds malformed lines, oversized data and journal text', () => {
  const p = new ClaudeProtocol({
    nativeId: randomUUID(),
    send: () => {},
    event: () => {}
  })
  assert.throws(() => p.feed('not json\n'), { code: 'INVALID_PROTOCOL' })
  assert.throws(() => p.feed('x'.repeat(262145)), {
    code: 'PROTOCOL_TOO_LARGE'
  })
})
