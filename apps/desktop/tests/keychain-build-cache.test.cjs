const test = require('node:test')
const assert = require('node:assert/strict')
const { existsSync } = require('node:fs')
const { mkdtemp, mkdir, copyFile, readFile, writeFile, rm } = require('node:fs/promises')
const { tmpdir } = require('node:os')
const path = require('node:path')
const { createHash } = require('node:crypto')
const { spawnSync } = require('node:child_process')

const root = path.resolve(__dirname, '../../..')
const helper = path.join(root, 'apps/desktop/native/bin/provider-keychain')
const digest = bytes => createHash('sha256').update(bytes).digest('hex')

test('builds preserve the signed helper across compiler changes and worktrees, and reject cache corruption', {
  skip: process.platform !== 'darwin' || !existsSync(helper),
}, async () => {
  // Run the real build script against isolated checkouts. Never access Keychain.
  const fixture = await mkdtemp(path.join(tmpdir(), 'zq-keychain-cache-'))
  const main = path.join(fixture, 'main')
  const worktree = path.join(fixture, 'worktree')
  const source = await readFile(path.join(root, 'apps/desktop/native/provider-keychain.swift'))
  const original = await readFile(helper)
  const target = `${process.arch === 'x64' ? 'x86_64' : 'arm64'}-apple-macosx13.0`
  const inputHash = createHash('sha256').update(source).update(target).update('-').digest('hex')
  const cache = path.join(main, '.local-data/native-keychain', inputHash)
  const output = checkout => path.join(checkout, 'apps/desktop/native/bin/provider-keychain')
  const build = checkout => spawnSync(process.execPath, [path.join(checkout, 'scripts/build-keychain.mjs')], {
    encoding: 'utf8', timeout: 10000,
    env: { ...process.env, DEVELOPER_DIR: '/nonexistent/zq-test-no-compiler', ZQ_KEYCHAIN_SIGN_IDENTITY: '-', ZQ_KEYCHAIN_ARCH: process.arch, ZQ_KEYCHAIN_FORCE_REBUILD: '0' },
  })
  try {
    for (const checkout of [main, worktree]) {
      await mkdir(path.join(checkout, 'scripts'), { recursive: true })
      await mkdir(path.join(checkout, 'apps/desktop/native'), { recursive: true })
      await copyFile(path.join(root, 'scripts/build-keychain.mjs'), path.join(checkout, 'scripts/build-keychain.mjs'))
      await writeFile(path.join(checkout, 'apps/desktop/native/provider-keychain.swift'), source)
    }
    const gitDirectory = path.join(main, '.git/worktrees/test')
    await mkdir(gitDirectory, { recursive: true })
    await writeFile(path.join(gitDirectory, 'commondir'), '../..\n')
    await writeFile(path.join(worktree, '.git'), `gitdir: ${gitDirectory}\n`)
    await mkdir(cache, { recursive: true })
    await copyFile(helper, path.join(cache, 'provider-keychain'))
    await writeFile(path.join(cache, 'receipt.json'), JSON.stringify({ inputHash, binaryHash: digest(original) }))

    for (const checkout of [main, worktree]) {
      const result = build(checkout)
      assert.equal(result.status, 0, result.stderr)
      assert.match(result.stdout, /identity preserved/)
      assert.deepEqual(await readFile(output(checkout)), original)
    }

    await writeFile(path.join(cache, 'provider-keychain'), 'corrupted executable')
    const corrupted = build(worktree)
    assert.notEqual(corrupted.status, 0)
    assert.match(corrupted.stderr, /integrity verification/)
    assert.deepEqual(await readFile(output(worktree)), original, 'failed verification must preserve the installed binary')

    await writeFile(path.join(worktree, 'apps/desktop/native/provider-keychain.swift'), Buffer.concat([source, Buffer.from('\n// changed source\n')]))
    const changed = build(worktree)
    assert.notEqual(changed.status, 0, 'changed source must require compilation')
    assert.match(changed.stderr, /xcrun/)
    assert.deepEqual(await readFile(output(worktree)), original)
  } finally {
    await rm(fixture, { recursive: true, force: true })
  }
})
