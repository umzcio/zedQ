#!/usr/bin/env node
import {generateKeyPairSync, createHash} from 'node:crypto'
import {mkdir, writeFile} from 'node:fs/promises'
import path from 'node:path'
import {fileURLToPath, pathToFileURL} from 'node:url'

export const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export const signingKeyId = publicKey => createHash('sha256').update(publicKey).digest('hex').slice(0, 16)

export async function generateSigningKey(output = path.join(repositoryRoot, '.local-data/module-signing/private.pem')) {
  const {privateKey, publicKey} = generateKeyPairSync('ed25519', {
    publicKeyEncoding:{type:'spki', format:'pem'},
    privateKeyEncoding:{type:'pkcs8', format:'pem'},
  })
  await mkdir(path.dirname(output), {recursive:true})
  // Exclusive creation deliberately prevents silently rotating an existing release key.
  await writeFile(output, privateKey, {mode:0o600, flag:'wx'})
  return {keyId:signingKeyId(publicKey), publicKey}
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const args = process.argv.slice(2)
    if (args.length && (args.length !== 2 || args[0] !== '--out')) throw new Error('Usage: node scripts/module-keygen.mjs [--out private.pem]')
    const output = args.length ? path.resolve(args[1]) : path.join(repositoryRoot, '.local-data/module-signing/private.pem')
    const key = await generateSigningKey(output)
    console.log(`Created signing key ${key.keyId}: ${output}`)
    console.log('Keep this private key outside application packages and source control.')
  } catch (error) { console.error(error.message); process.exitCode = 1 }
}
