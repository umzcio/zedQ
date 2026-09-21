const path = require('node:path')
const { createHash } = require('node:crypto')
const { spawn: spawnProcess } = require('node:child_process')

const MAX_OUTPUT_BYTES = 65536
const validKey = key => typeof key === 'string' && /^[\x21-\x7e]{1,8192}$/.test(key)

// The helper owns the native Keychain ACL. Secrets are never argv, environment
// variables, shell input, temporary files, logs, or renderer snapshots.
function createCredentialStore({ directory, helperPath = path.join(__dirname, '../native/bin/provider-keychain'), platform = process.platform, spawn = spawnProcess, timeoutMs = 120000 }) {
  if (typeof directory !== 'string' || !directory || directory.includes('\0')) throw new Error('Invalid credential workspace')
  if (typeof helperPath !== 'string' || !path.isAbsolute(helperPath) || helperPath.includes('\0')) throw new Error('Invalid Keychain helper path')
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120000) throw new Error('Invalid Keychain timeout')
  const workspace = createHash('sha256').update(path.resolve(directory)).digest('hex')
  const service = `dev.zedq.desktop.providers.${workspace}`

  async function request(operation, id, key, interactive) {
    if (typeof id !== 'string' || !/^[a-zA-Z0-9._-]{1,128}$/.test(id)) throw new Error('Invalid credential id')
    if (operation === 'set' && !validKey(key)) throw new Error('Invalid API key')
    if (platform !== 'darwin') throw new Error('Provider credentials require macOS Keychain')
    return new Promise((resolve, reject) => {
      let child
      let finished = false
      let stdout = []
      let outputBytes = 0
      let timer
      const fail = (message, code) => {
        if (finished) return
        finished = true
        clearTimeout(timer)
        stdout = []
        try { child?.kill('SIGKILL') } catch { /* Never expose child errors. */ }
        reject(Object.assign(new Error(message), code ? { code } : {}))
      }
      try {
        child = spawn(helperPath, [], {
          shell: false,
          stdio: ['pipe', 'pipe', 'pipe'],
          // Do not inherit API keys or dynamic-loader injection from the shell.
          env: { PATH: '/usr/bin:/bin' },
        })
        timer = setTimeout(() => fail('Keychain authorization timed out. Retry, then approve the macOS dialog within two minutes.'), timeoutMs)
        child.on('error', () => fail('Keychain helper could not start. Rebuild or reinstall zQ.'))
        child.stdin.on('error', () => fail('Keychain helper communication failed.'))
        const collect = (chunk, keep) => {
          if (finished) return
          outputBytes += chunk.length
          if (outputBytes > MAX_OUTPUT_BYTES) return fail('Keychain helper response exceeded its limit.')
          if (keep) stdout.push(Buffer.from(chunk))
        }
        child.stdout.on('data', chunk => collect(chunk, true))
        child.stderr.on('data', chunk => collect(chunk, false))
        child.stdout.on('error', () => fail('Keychain helper communication failed.'))
        child.stderr.on('error', () => fail('Keychain helper communication failed.'))
        child.on('close', code => {
          if (finished) return
          if (code !== 0) return fail('Keychain helper failed. Unlock your login keychain and try again.')
          let response
          try { response = JSON.parse(Buffer.concat(stdout).toString('utf8')) } catch { return fail('Keychain helper returned an invalid response.') }
          stdout = []
          if (!response || response.ok !== true) {
            const status = response?.status
            if (status === -128) return fail('Keychain access was cancelled.', 'KEYCHAIN_AUTH_REQUIRED')
            if (status === -25293 || status === -25308 || status === -25315) return fail('Keychain access was denied or the login keychain is locked.', 'KEYCHAIN_AUTH_REQUIRED')
            return fail('Keychain operation failed.')
          }
          if (operation === 'get' && response.key !== null && !validKey(response.key)) return fail('Keychain helper returned an invalid credential.')
          finished = true
          clearTimeout(timer)
          resolve(operation === 'get' ? response.key : undefined)
        })
        child.stdin.end(JSON.stringify({ operation, service, account: id, interactive, ...(operation === 'set' ? { key } : {}) }))
      } catch { fail('Keychain helper could not start. Rebuild or reinstall zQ.') }
    })
  }

  // macOS authorization is interactive. Launch one helper at a time so
  // unrelated connector restores cannot stack password dialogs. A queued
  // operation gets its full timeout only when its own helper starts.
  let pending = Promise.resolve()
  const enqueue = (operation, id, key, { interactive = true } = {}) => {
    if (typeof interactive !== 'boolean') return Promise.reject(new Error('Invalid Keychain interaction policy'))
    const result = pending.then(() => request(operation, id, key, interactive))
    pending = result.then(() => undefined, () => undefined)
    return result
  }

  return {
    get: (id, options) => enqueue('get', id, undefined, options),
    set: (id, key, options) => enqueue('set', id, key, options),
    delete: (id, options) => enqueue('delete', id, undefined, options),
  }
}
module.exports = { createCredentialStore }
