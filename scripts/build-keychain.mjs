import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { access, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Build once per source/compiler/architecture/signing-identity change. Keeping
// an unchanged helper avoids unnecessary ad-hoc identity changes and prompts.
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

const compiler = run('/usr/bin/xcrun', ['swiftc', '--version'])
const hash = createHash('sha256').update(await readFile(source)).update(await readFile(fileURLToPath(import.meta.url))).update(compiler).update(target).update(identity).digest('hex')
try {
  if ((await readFile(stamp, 'utf8')).trim() === hash) {
    await access(output)
    run('/usr/bin/codesign', ['--verify', '--strict', output])
    console.log('Keychain helper is up to date.')
    process.exit(0)
  }
} catch { /* Missing, changed, or invalid builds are replaced atomically. */ }

await mkdir(outputDirectory, { recursive: true })
const temporary = await mkdtemp(path.join(tmpdir(), 'zq-keychain-build-'))
try {
  const binary = path.join(temporary, 'provider-keychain')
  run('/usr/bin/xcrun', ['swiftc', source, '-O', '-target', target, '-framework', 'Security', '-module-cache-path', path.join(temporary, 'module-cache'), '-o', binary])
  run('/usr/bin/codesign', ['--force', '--sign', identity, '--identifier', 'dev.zedq.desktop.provider-keychain', '--options', 'runtime', ...(identity === '-' ? [] : ['--timestamp']), binary])
  run('/usr/bin/codesign', ['--verify', '--strict', binary])
  await rename(binary, output)
  await writeFile(stamp, `${hash}\n`)
  console.log(`Built macOS Keychain helper (${architecture}).`)
  if (identity === '-') console.log('Ad-hoc signing: source changes may require Keychain authorization again. Use ZQ_KEYCHAIN_SIGN_IDENTITY for stable signed releases.')
} finally {
  await rm(temporary, { recursive: true, force: true })
}
