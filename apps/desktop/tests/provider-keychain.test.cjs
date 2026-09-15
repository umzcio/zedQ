const test = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const { PassThrough, Writable } = require('node:stream')
const path = require('node:path')
const { existsSync } = require('node:fs')
const { mkdtemp, rm } = require('node:fs/promises')
const { randomUUID } = require('node:crypto')
const { spawnSync } = require('node:child_process')
const { createCredentialStore } = require('../electron/provider-keychain.cjs')

// Only the external process is replaced: real transport, parsing, bounds, and
// workspace derivation run for every call. No real Keychain items are accessed.
function helper(onRequest) {
  const calls = []
  const spawn = (executable, args, options) => {
    const child = new EventEmitter()
    child.stdout = new PassThrough()
    child.stderr = new PassThrough()
    child.kill = () => { child.killed = true; queueMicrotask(() => child.emit('close', null, 'SIGKILL')) }
    let input = ''
    child.stdin = new Writable({ write(chunk, encoding, done) { input += chunk; done() } })
    child.stdin.on('finish', () => {
      const request = JSON.parse(input)
      calls.push({ executable, args, options, request, child })
      onRequest(request, child)
    })
    return child
  }
  return { calls, spawn }
}

function reply(child, response, status = 0) {
  child.stdout.end(JSON.stringify(response))
  queueMicrotask(() => child.emit('close', status))
}

function store(fake, directory = '/private/tmp/zq-keychain-unit-a', extra = {}) {
  return createCredentialStore({ directory, helperPath: '/test/provider-keychain', platform: 'darwin', spawn: fake.spawn, ...extra })
}

test('credentials travel only through stdin and round trip within a workspace', async () => {
  const items = new Map()
  const fake = helper((request, child) => {
    const id = `${request.service}/${request.account}`
    if (request.operation === 'set') items.set(id, request.key)
    if (request.operation === 'delete') items.delete(id)
    reply(child, request.operation === 'get' ? { ok: true, key: items.get(id) ?? null } : { ok: true })
  })
  const a = store(fake)
  const equivalentA = store(fake, '/private/tmp/zq-keychain-unit-a/./')
  const b = store(fake, '/private/tmp/zq-keychain-unit-b')
  assert.equal(await a.get('openai'), null)
  await a.set('openai', 'sk-unit-secret')
  assert.equal(await equivalentA.get('openai'), 'sk-unit-secret')
  assert.equal(await b.get('openai'), null)
  await a.set('openai', 'sk-replaced')
  assert.equal(await a.get('openai'), 'sk-replaced')
  await a.delete('openai')
  await a.delete('openai')
  assert.equal(await a.get('openai'), null)
  for (const call of fake.calls) {
    assert.deepEqual(call.args, [])
    assert.equal(call.options.shell, false)
    assert.equal(JSON.stringify(call.options).includes('sk-unit-secret'), false)
    assert.equal(call.request.service.includes('zq-keychain-unit'), false)
    assert.match(call.request.account, /^[a-z0-9._-]{1,128}$/i)
  }
})

test('invalid IDs and keys are rejected before invoking a helper', async () => {
  const fake = helper(() => assert.fail('must not launch helper'))
  const credentials = store(fake)
  for (const id of ['', '../x', 'a'.repeat(129), 'x\n', null]) await assert.rejects(credentials.get(id), /invalid credential id/i)
  for (const key of ['', ' ', 'x\nsecret', '\0', 'a'.repeat(8193), null]) await assert.rejects(credentials.set('openai', key), /invalid API key/i)
})

test('unsupported platforms fail without a plaintext fallback', async () => {
  const fake = helper(() => assert.fail('must not launch helper'))
  await assert.rejects(store(fake, undefined, { platform: 'linux' }).get('openai'), /macOS/i)
})

test('helper failures redact stderr, malformed output, and injected error details', async () => {
  for (const mode of ['status', 'json', 'exit', 'spawn', 'stdin']) {
    const fake = helper((request, child) => {
      child.stderr.write('sk-secret-error')
      if (mode === 'spawn') return child.emit('error', new Error('sk-secret-error'))
      if (mode === 'stdin') return child.stdin.emit('error', new Error('sk-secret-error'))
      if (mode === 'json') { child.stdout.end('sk-secret-error'); return child.emit('close', 0) }
      reply(child, { ok: false, status: -25293, error: 'sk-secret-error' }, mode === 'exit' ? 1 : 0)
    })
    await assert.rejects(store(fake).get('openai'), error => {
      assert.equal(String(error).includes('sk-secret-error'), false)
      assert.match(error.message, /keychain/i)
      return true
    })
  }
})

test('timeouts and excessive stdout or stderr kill the helper', async () => {
  for (const stream of ['stdout', 'stderr', 'timeout']) {
    const fake = helper((request, child) => { if (stream !== 'timeout') child[stream].write('x'.repeat(100001)) })
    await assert.rejects(store(fake, undefined, { timeoutMs: 20 }).get('openai'), /keychain/i)
    assert.equal(fake.calls[0].child.killed, true)
  }
})

test('malformed success payloads cannot masquerade as credentials', async () => {
  for (const key of [undefined, 12, '', 'x\n', 'x'.repeat(8193)]) {
    const fake = helper((request, child) => reply(child, { ok: true, key }))
    await assert.rejects(store(fake).get('openai'), /keychain/i)
  }
})

test('authorization requests run one at a time and a cancellation releases the queue', async () => {
  const fake = helper(() => {})
  const credentials = store(fake)
  const first = credentials.get('first')
  const rejected = assert.rejects(first, /cancelled/)
  const second = credentials.set('second', 'sk-isolated')
  const third = credentials.delete('third')
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(fake.calls.length, 1)
  reply(fake.calls[0].child, { ok: false, status: -128 })
  await rejected
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(fake.calls.length, 2)
  assert.equal(fake.calls[1].request.operation, 'set')
  reply(fake.calls[1].child, { ok: true })
  await second
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(fake.calls.length, 3)
  assert.equal(fake.calls[2].request.operation, 'delete')
  reply(fake.calls[2].child, { ok: true })
  await third
})

test('default authorization window allows password entry beyond thirty seconds', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const fake = helper(() => {})
  const credentials = store(fake)
  const result = credentials.get('slow-approval')
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(fake.calls.length, 1)
  t.mock.timers.tick(31000)
  assert.equal(fake.calls[0].child.killed, undefined)
  reply(fake.calls[0].child, { ok: true, key: null })
  assert.equal(await result, null)
})

const nativeHelper = path.join(__dirname, '../native/bin/provider-keychain')
test('compiled helper rejects malformed and oversized input before any Keychain access', {
  skip: process.platform !== 'darwin' || !existsSync(nativeHelper),
}, () => {
  for (const input of ['not JSON', JSON.stringify({ operation: 'enumerate' }), 'x'.repeat(65537)]) {
    const result = spawnSync(nativeHelper, [], { input, encoding: 'utf8', env: { PATH: '/usr/bin:/bin' }, timeout: 5000, maxBuffer: 65536 })
    assert.equal(result.error, undefined)
    assert.equal(result.status, 0)
    assert.equal(result.stderr, '')
    assert.deepEqual(JSON.parse(result.stdout), { ok: false, status: -50 })
  }
})

// Opt-in only: a unique workspace service + unique account. Never read, alter,
// or enumerate a normal workspace's existing Keychain items.
test('real macOS Keychain creates, updates, retrieves, and deletes one isolated item', {
  skip: process.platform !== 'darwin' || process.env.ZQ_TEST_REAL_KEYCHAIN !== '1',
  timeout: 60000,
}, async () => {
  const directory = await mkdtemp('/private/tmp/zq-keychain-smoke-')
  const credentials = createCredentialStore({ directory, helperPath: nativeHelper, timeoutMs: 10000 })
  const id = `test-${randomUUID()}`
  const first = `sk-isolated-${randomUUID()}`
  const second = `sk-isolated-${randomUUID()}`
  try {
    assert.equal(await credentials.get(id), null)
    await credentials.set(id, first)
    assert.ok(await credentials.get(id) === first, 'Keychain must return the original value')
    await credentials.set(id, second)
    assert.ok(await credentials.get(id) === second, 'Keychain must return the updated value')
    await credentials.delete(id)
    assert.equal(await credentials.get(id), null)
    await credentials.delete(id)
  } finally {
    try { await credentials.delete(id) } finally { await rm(directory, { recursive: true, force: true }) }
  }
})
