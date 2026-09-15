import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmod, copyFile, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Reuse the exact signed bytes for unchanged source/target/signing identity.
// Compiler upgrades and isolated worktrees must not invalidate Keychain trust.
// Release builds should set ZQ_KEYCHAIN_SIGN_IDENTITY to a stable certificate
// and preserve dev.zedq.desktop.provider-keychain when signing nested code.
if (process.platform !== 'darwin') {
  console.log('Skipping macOS Keychain helper on this platform; provider credential storage is unavailable.')
  process.exit(0)
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const source = path.join(root, 'apps/desktop/native/provider-keychain.swift')
const outputDirectory = path.join(root, 'apps/desktop/native/bin')
const output = path.join(outputDirectory, 'provider-keychain')
const stamp = `${output}.build-hash`
const identity = process.env.ZQ_KEYCHAIN_SIGN_IDENTITY || '-'
const architecture = process.env.ZQ_KEYCHAIN_ARCH || process.arch
if (!['arm64', 'x64'].includes(architecture)) throw new Error('Unsupported Keychain helper architecture')
const target = `${architecture === 'x64' ? 'x86_64' : 'arm64'}-apple-macosx13.0`

function run(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8', maxBuffer: 1024 * 1024 })
  if (result.error || result.status !== 0) {
    // Build input never contains provider credentials.
    process.stderr.write(result.stderr || '')
    throw new Error(`Keychain helper build failed: ${command}`)
  }
  return result.stdout
}

// Worktrees share this cache with their primary checkout. It contains only
// the public executable and its integrity receipt, never credentials or keys.
let cacheRoot = root
try {
  const gitFile = await readFile(path.join(root, '.git'), 'utf8')
  const gitDir = path.resolve(root, gitFile.trim().replace(/^gitdir: /, ''))
  const common = (await readFile(path.join(gitDir, 'commondir'), 'utf8')).trim()
  cacheRoot = path.dirname(path.resolve(gitDir, common))
} catch { /* A regular checkout (or source archive) uses its own cache. */ }
const hash = createHash('sha256').update(await readFile(source)).update(target).update(identity).digest('hex')
const cache = path.join(cacheRoot, '.local-data/native-keychain', hash)
const cachedBinary = path.join(cache, 'provider-keychain')
const receiptPath = path.join(cache, 'receipt.json')
const digest = bytes => createHash('sha256').update(bytes).digest('hex')
async function publish(binary) {
  await mkdir(outputDirectory, { recursive: true })
  const temporary = `${output}.tmp-${process.pid}`
  try {
    await copyFile(binary, temporary)
    await chmod(temporary, 0o755)
    await rename(temporary, output)
    await writeFile(stamp, `${hash}\n`)
  } finally { await rm(temporary, { force: true }) }
}
let receipt
try { receipt = JSON.parse(await readFile(receiptPath, 'utf8')) }
catch (error) { if (error.code !== 'ENOENT') throw error }
if (receipt && process.env.ZQ_KEYCHAIN_FORCE_REBUILD !== '1') {
  const bytes = await readFile(cachedBinary)
  if (receipt.inputHash !== hash || receipt.binaryHash !== digest(bytes))
    throw new Error('Cached Keychain helper failed integrity verification; refusing to replace its trusted identity.')
  run('/usr/bin/codesign', ['--verify', '--strict', cachedBinary])
  await publish(cachedBinary)
  console.log('Reused the existing signed Keychain helper (identity preserved).')
  process.exit(0)
}
const compiler = run('/usr/bin/xcrun', ['swiftc', '--version'])

await mkdir(outputDirectory, { recursive: true })
const temporary = await mkdtemp(path.join(tmpdir(), 'zq-keychain-build-'))
try {
  const binary = path.join(temporary, 'provider-keychain')
  run('/usr/bin/xcrun', ['swiftc', source, '-O', '-target', target, '-framework', 'Security', '-module-cache-path', path.join(temporary, 'module-cache'), '-o', binary])
  run('/usr/bin/codesign', ['--force', '--sign', identity, '--identifier', 'dev.zedq.desktop.provider-keychain', '--options', 'runtime', ...(identity === '-' ? [] : ['--timestamp']), binary])
  run('/usr/bin/codesign', ['--verify', '--strict', binary])
  await mkdir(cache, { recursive: true, mode: 0o700 })
  await copyFile(binary, cachedBinary)
  await writeFile(receiptPath, JSON.stringify({ inputHash: hash, binaryHash: digest(await readFile(binary)), compiler }), { mode: 0o600 })
  await publish(cachedBinary)
  console.log(`Built macOS Keychain helper (${architecture}).`)
  if (identity === '-') console.log('Ad-hoc signing: source changes may require Keychain authorization again. Use ZQ_KEYCHAIN_SIGN_IDENTITY for stable signed releases.')
} finally {
  await rm(temporary, { recursive: true, force: true })
}
