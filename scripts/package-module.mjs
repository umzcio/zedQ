#!/usr/bin/env node
import {createPrivateKey, createPublicKey, sign} from 'node:crypto'
import {mkdir, readFile, writeFile} from 'node:fs/promises'
import path from 'node:path'
import {pathToFileURL} from 'node:url'
import {repositoryRoot, signingKeyId} from './module-keygen.mjs'

const numeric = '(?:0|[1-9][0-9]*)'
const prerelease = `(?:${numeric}|[0-9]*[A-Za-z-][0-9A-Za-z-]*)`
const semver = new RegExp(`^${numeric}\\.${numeric}\\.${numeric}(?:-${prerelease}(?:\\.${prerelease})*)?(?:\\+[0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*)?$`)
export function validateManifest(manifest) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) throw new Error('Invalid module manifest')
  if (!['zq.hq','zq.notes','zq.tasks','zq.chat','zq.code'].includes(manifest.id)) throw new Error('Unknown first-party module id')
  if (typeof manifest.version !== 'string' || !semver.test(manifest.version)) throw new Error('Module version must be semantic version (for example 1.0.1)')
  if (manifest.apiVersion !== 1) throw new Error('Unsupported module apiVersion')
  for (const field of ['title','view','icon']) if (typeof manifest[field] !== 'string' || !manifest[field].trim()) throw new Error(`Missing manifest ${field}`)
  if (!Array.isArray(manifest.capabilities) || !manifest.capabilities.every(value => typeof value === 'string') || new Set(manifest.capabilities).size !== manifest.capabilities.length) throw new Error('Invalid module capabilities')
  return manifest
}

export async function readSigningKey(keyPath = process.env.ZQ_MODULE_SIGNING_KEY || path.join(repositoryRoot, '.local-data/module-signing/private.pem')) {
  let pem
  try { pem = await readFile(keyPath, 'utf8') }
  catch (error) { throw new Error(`Cannot read module signing key ${keyPath}; run node scripts/module-keygen.mjs first or set ZQ_MODULE_SIGNING_KEY`, {cause:error}) }
  const privateKey = createPrivateKey(pem)
  if (privateKey.asymmetricKeyType !== 'ed25519') throw new Error('Module signing key must be Ed25519')
  const publicKey = createPublicKey(privateKey).export({type:'spki', format:'pem'})
  return {privateKey, publicKey, keyId:signingKeyId(publicKey)}
}

export function signModule({manifest, code, css = ''}, key) {
  validateManifest(manifest)
  if (typeof code !== 'string' || !code.trim() || typeof css !== 'string') throw new Error('Module requires JavaScript code and optional CSS text')
  const payload = {format:1, manifest, code, css, keyId:key.keyId}
  return {...payload, signature:sign(null, Buffer.from(JSON.stringify(payload)), key.privateKey).toString('base64')}
}

export async function writeModule(output, artifact) {
  await mkdir(path.dirname(output), {recursive:true})
  await writeFile(output, `${JSON.stringify(artifact)}\n`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const args = process.argv.slice(2), options = {}
    for (let i = 0; i < args.length; i += 2) {
      if (!['--manifest','--code','--css','--out'].includes(args[i]) || !args[i+1] || args[i+1].startsWith('--')) throw new Error('Usage: node scripts/package-module.mjs --manifest manifest.json --code module.js [--css module.css] --out release.zqmodule')
      options[args[i].slice(2)] = args[i+1]
    }
    if (!options.manifest || !options.code || !options.out) throw new Error('--manifest, --code and --out are required')
    const manifest = JSON.parse(await readFile(options.manifest, 'utf8'))
    const code = await readFile(options.code, 'utf8')
    const css = options.css ? await readFile(options.css, 'utf8') : ''
    await writeModule(options.out, signModule({manifest, code, css}, await readSigningKey()))
    console.log(path.resolve(options.out))
  } catch (error) { console.error(error.message); process.exitCode = 1 }
}
