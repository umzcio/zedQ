const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const crypto = require('node:crypto')
const vm = require('node:vm')
const {pathToFileURL} = require('node:url')

const scripts = path.resolve(__dirname, '../../../scripts')
const load = name => import(pathToFileURL(path.join(scripts, name)))
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'zq-module-build-'))
  t.after(() => fs.rm(root, {recursive:true, force:true}))
  await fs.mkdir(path.join(root, 'modules/chat'), {recursive:true})
  await fs.writeFile(path.join(root, 'modules/chat/manifest.json'), JSON.stringify({
    id:'zq.chat', version:'1.0.0', apiVersion:1, title:'Chat', view:'Chat', icon:'chat', capabilities:['chat'],
  }))
  await fs.writeFile(path.join(root, 'modules/chat/index.tsx'), "import {Fragment} from 'react'; import './style.css'; export default {Provider:Fragment,Root:()=> <div>fixture chat</div>}")
  await fs.writeFile(path.join(root, 'modules/chat/style.css'), '.fixture-chat { color: red; }')
  const {generateSigningKey} = await load('module-keygen.mjs')
  const key = await generateSigningKey(path.join(root, 'private.pem'))
  return {root, keyPath:path.join(root, 'private.pem'), key}
}

test('key generation protects private material and refuses accidental replacement', async t => {
  const {root, keyPath, key} = await fixture(t)
  assert.equal((await fs.stat(keyPath)).mode & 0o777, 0o600)
  assert.equal(key.keyId, crypto.createHash('sha256').update(key.publicKey).digest('hex').slice(0,16))
  assert.equal(crypto.createPublicKey(key.publicKey).asymmetricKeyType, 'ed25519')
  const {generateSigningKey} = await load('module-keygen.mjs')
  await assert.rejects(generateSigningKey(keyPath), /exist/i)
  assert.ok(root)
})

test('a selected module builds alone, shares runtime React, and signs code and CSS', async t => {
  const {root, keyPath, key} = await fixture(t)
  const {buildModules} = await load('build-modules.mjs')
  const [output] = await buildModules({root, names:['chat'], version:'1.0.1', signingKeyPath:keyPath})
  assert.equal(output, path.join(root, '.local-data/module-releases/zq.chat-1.0.1.zqmodule'))
  const artifact = JSON.parse(await fs.readFile(output, 'utf8'))
  assert.equal(artifact.manifest.version, '1.0.1')
  assert.match(artifact.css, /fixture-chat/)
  const payload = {format:1, manifest:artifact.manifest, code:artifact.code, css:artifact.css, keyId:artifact.keyId}
  assert.ok(crypto.verify(null, Buffer.from(JSON.stringify(payload)), key.publicKey, Buffer.from(artifact.signature,'base64')))
  const context = {__zqRuntime:{React:{Fragment:'shared-react-fragment'}, jsx:{jsx:(type, props)=>({type,props})}}}
  vm.runInNewContext(artifact.code, context)
  assert.equal(context.__zqLatestModule.Provider, 'shared-react-fragment')
  assert.equal(context.__zqLatestModule.Root().props.children, 'fixture chat')
  await assert.rejects(fs.access(path.join(root, 'apps/desktop/bundled-modules')))
  assert.deepEqual(await fs.readdir(path.join(root,'.local-data/module-build')), ['chat'])
})

test('a full build packages all modules with only the public verification key', async t => {
  const {root,keyPath,key} = await fixture(t)
  for (const name of ['hq','notes','tasks']) {
    await fs.cp(path.join(root,'modules/chat'),path.join(root,'modules',name),{recursive:true})
    const manifestPath = path.join(root,'modules',name,'manifest.json')
    const manifest = JSON.parse(await fs.readFile(manifestPath,'utf8'))
    manifest.id = `zq.${name}`
    await fs.writeFile(manifestPath,JSON.stringify(manifest))
  }
  const {buildModules} = await load('build-modules.mjs')
  assert.equal((await buildModules({root,signingKeyPath:keyPath})).length,4)
  const bundleDirectory = path.join(root,'apps/desktop/bundled-modules')
  assert.deepEqual((await fs.readdir(bundleDirectory)).sort(),['chat.zqmodule','hq.zqmodule','notes.zqmodule','tasks.zqmodule','trusted-keys.json'])
  const trust = JSON.parse(await fs.readFile(path.join(bundleDirectory,'trusted-keys.json'),'utf8'))
  assert.deepEqual(trust,{[key.keyId]:key.publicKey})
})

test('module build rejects desktop and sibling imports, including symlinks', async t => {
  const {root, keyPath} = await fixture(t)
  const {buildModules} = await load('build-modules.mjs')
  await fs.mkdir(path.join(root,'apps/desktop'), {recursive:true})
  await fs.mkdir(path.join(root,'modules/notes'), {recursive:true})
  await fs.writeFile(path.join(root,'apps/desktop/secret.ts'), 'export default 12')
  await fs.writeFile(path.join(root,'modules/notes/secret.ts'), 'export default 13')
  await fs.symlink(path.join(root,'apps/desktop/secret.ts'), path.join(root,'modules/chat/escape.ts'))
  for (const source of ['../../apps/desktop/secret','../notes/secret','./escape']) {
    await fs.writeFile(path.join(root,'modules/chat/index.tsx'), `import x from '${source}'; export default x`)
    await assert.rejects(buildModules({root,names:['chat'],signingKeyPath:keyPath}), /boundary|outside|forbidden/i)
  }
  await fs.writeFile(path.join(root,'modules/chat/index.tsx'), "import type X from '../../apps/desktop/secret'; export default {Root:()=>null}")
  await assert.rejects(buildModules({root,names:['chat'],signingKeyPath:keyPath}), /boundary|outside|forbidden/i)
})

test('build requires explicit signing key creation and rejects invalid release versions', async t => {
  const {root, keyPath} = await fixture(t)
  const {buildModules} = await load('build-modules.mjs')
  await assert.rejects(buildModules({root,names:['chat']}), /keygen|signing key/i)
  await assert.rejects(buildModules({root,names:['chat'],version:'01.2.3',signingKeyPath:keyPath}), /version/i)
  await assert.rejects(buildModules({root,names:['hq','chat'],version:'1.2.3',signingKeyPath:keyPath}), /single|one/i)
})
