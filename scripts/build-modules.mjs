#!/usr/bin/env node
import {build} from 'vite'
import {parseSync} from 'rolldown/utils'
import {mkdir, readFile, realpath, writeFile} from 'node:fs/promises'
import path from 'node:path'
import {pathToFileURL} from 'node:url'
import {repositoryRoot} from './module-keygen.mjs'
import {readSigningKey, signModule, validateManifest, writeModule} from './package-module.mjs'

const moduleNames = ['hq','notes','tasks','chat']
const globals = {
  react:'__zqRuntime.React',
  'react-dom':'__zqRuntime.ReactDOM',
  'react-dom/client':'__zqRuntime.ReactDOMClient',
  'react/jsx-runtime':'__zqRuntime.jsx',
  'react/jsx-dev-runtime':'__zqRuntime.jsxDev',
  '@zq/module-api':'__zqRuntime.sdk',
  '@zq/ui':'__zqRuntime.ui',
  '@phosphor-icons/react':'__zqRuntime.icons',
  'radix-ui':'__zqRuntime.radix',
}
const contains = (directory, file) => file === directory || file.startsWith(`${directory}${path.sep}`)

function moduleBoundary(directory) {
  return {
    name:'zq-module-boundary', enforce:'pre',
    async transform(code, id) {
      if (!contains(directory, id) || !/\.[cm]?[jt]sx?$/.test(id)) return null
      // Inspect source before TypeScript erases type-only imports as those also
      // couple a module release to private desktop or sibling implementation.
      const parsed = parseSync(id, code)
      const sources = new Set()
      const inspect = node => {
        if (!node || typeof node !== 'object') return
        if (['ImportDeclaration','ExportNamedDeclaration','ExportAllDeclaration','TSImportType','ImportExpression'].includes(node.type) && typeof node.source?.value === 'string') sources.add(node.source.value)
        for (const value of Object.values(node)) {
          if (Array.isArray(value)) value.forEach(inspect)
          else if (value && typeof value === 'object') inspect(value)
        }
      }
      inspect(parsed.program)
      for (const source of sources) await this.resolve(source, id, {skipSelf:false})
      return null
    },
    async resolveId(source, importer) {
      if (Object.hasOwn(globals, source)) return {id:source, external:true}
      if (source.startsWith('@zq/')) throw new Error(`Module boundary: forbidden private package ${source}; use @zq/module-api or @zq/ui`)
      if (!importer || source.startsWith('\0')) return null
      const resolved = await this.resolve(source, importer, {skipSelf:true})
      if (!resolved || resolved.external || !path.isAbsolute(resolved.id)) return resolved
      const filename = resolved.id.split('?')[0]
      const physical = await realpath(filename)
      if (!contains(directory, physical) && !physical.includes(`${path.sep}node_modules${path.sep}`)) throw new Error(`Module boundary: ${source} imports outside ${directory}`)
      return resolved
    },
  }
}

export async function buildModules({root = repositoryRoot, names = moduleNames, version, out, signingKeyPath} = {}) {
  if (!names.length || new Set(names).size !== names.length || names.some(name => !moduleNames.includes(name))) throw new Error('Select hq, notes, tasks or chat')
  if (version && names.length !== 1) throw new Error('--version requires a single module')
  if (out?.endsWith('.zqmodule') && names.length !== 1) throw new Error('A .zqmodule --out requires a single module')
  const key = await readSigningKey(signingKeyPath || process.env.ZQ_MODULE_SIGNING_KEY || path.join(root, '.local-data/module-signing/private.pem'))
  const outputs = []
  const bundleDirectory = path.join(root, 'apps/desktop/bundled-modules')
  const outputDirectory = out ? path.resolve(out) : names.length === 1 ? path.join(root, '.local-data/module-releases') : bundleDirectory
  for (const name of names) {
    const directory = await realpath(path.join(root, 'modules', name))
    const manifest = JSON.parse(await readFile(path.join(directory, 'manifest.json'), 'utf8'))
    if (manifest.id !== `zq.${name}`) throw new Error(`Manifest id must be zq.${name}`)
    if (version) manifest.version = version
    validateManifest(manifest)
    const buildDirectory = path.join(root, '.local-data/module-build', name)
    const result = await build({
      configFile:false, root:directory, publicDir:false, logLevel:'warn',
      plugins:[moduleBoundary(directory)],
      define:{'process.env.NODE_ENV':JSON.stringify('production')},
      build:{
        outDir:buildDirectory, emptyOutDir:true, sourcemap:false, minify:true, target:'es2022',
        cssCodeSplit:false, lib:{entry:path.join(directory,'index.tsx'), name:'__zqLatestModule', formats:['iife'], fileName:()=>'module.js', cssFileName:'module'},
        rolldownOptions:{external:Object.keys(globals), output:{globals, exports:'default', codeSplitting:false}},
      },
    })
    const generated = (Array.isArray(result) ? result : [result]).flatMap(item => item.output || [])
    const chunks = generated.filter(item => item.type === 'chunk')
    if (chunks.length !== 1 || chunks[0].imports.some(id => !Object.hasOwn(globals, id)) || chunks[0].dynamicImports.length) throw new Error('Module must produce one self-contained JavaScript bundle')
    const assets = generated.filter(item => item.type === 'asset')
    if (assets.some(item => !item.fileName.endsWith('.css'))) throw new Error('Module assets must be inlined into JavaScript or CSS')
    const css = assets.map(item => typeof item.source === 'string' ? item.source : Buffer.from(item.source).toString('utf8')).join('\n')
    const artifact = signModule({manifest, code:chunks[0].code, css}, key)
    const output = out?.endsWith('.zqmodule') ? outputDirectory : path.join(outputDirectory, names.length > 1 ? `${name}.zqmodule` : `${manifest.id}-${manifest.version}.zqmodule`)
    await writeModule(output, artifact)
    outputs.push(output)
  }
  // A release of one module never changes the shell's bundled artifacts or roots.
  if (names.length > 1 || (out && path.resolve(out) === bundleDirectory)) {
    await mkdir(outputDirectory, {recursive:true})
    await writeFile(path.join(outputDirectory, 'trusted-keys.json'), `${JSON.stringify({[key.keyId]:key.publicKey}, null, 2)}\n`)
  }
  return outputs
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const args = process.argv.slice(2), options = {}
    for (let i = 0; i < args.length; i++) {
      if (['--version','--out'].includes(args[i])) {
        const flag = args[i].slice(2), value = args[++i]
        if (!value || value.startsWith('--')) throw new Error(`--${flag} requires a value`)
        options[flag] = value
      } else if (moduleNames.includes(args[i]) && !options.names) options.names = [args[i]]
      else throw new Error('Usage: node scripts/build-modules.mjs [hq|notes|tasks|chat] [--version 1.0.1] [--out path]')
    }
    for (const output of await buildModules(options)) console.log(output)
  } catch (error) { console.error(error.message); process.exitCode = 1 }
}
