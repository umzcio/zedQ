import { mkdir, copyFile, rm, cp, readdir, open, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = join(root, 'apps/desktop/native/document-helper');
const base = join(root, '.local-data/document-helper');
const identity = 'DocumentHelper';
const app = join(root, 'apps/desktop/native/bin/DocumentHelper.app');
const signingIdentity = process.env.ZQ_NATIVE_SIGNING_IDENTITY || '-';
// Ad hoc binaries have no Team ID, so Hardened Runtime library validation cannot
// load their signed Python extensions. Development retains App Sandbox + caller
// hash pinning; an Apple-issued release identity enables Hardened Runtime for all
// binaries and signs the bundled extensions with that same Team ID.
const signOptions = ['--force', '--sign', signingIdentity, ...(signingIdentity === '-' ? [] : ['--options', 'runtime', '--timestamp'])];
const entitlements = name => ['--entitlements', join(source, name + '.entitlements')];
const service = join(app, 'Contents/XPCServices/DocumentHelperService.xpc');
const run = (name, args) => execFileSync(name, args, { stdio: 'inherit' });
if (process.platform !== 'darwin' || process.arch !== 'arm64') throw new Error('The document helper currently requires Apple silicon macOS.');
run(process.execPath, [join(root, 'scripts/prepare-document-runtime.mjs')]);
await mkdir(base, {recursive:true});
await rm(app, { recursive: true, force: true });
await mkdir(join(app, 'Contents/MacOS'), { recursive: true });
await mkdir(join(service, 'Contents/MacOS'), { recursive: true });
await mkdir(join(service, 'Contents/Resources'), { recursive: true });
for (const [input, output] of [['Client.plist', join(app, 'Contents/Info.plist')], ['Service.plist', join(service, 'Contents/Info.plist')]]) {
  await copyFile(join(source,input),output);
}
run('xcrun', ['swiftc', '-O', '-target', 'arm64-apple-macos13.0', join(source, 'Protocol.swift'), join(source, 'Client.swift'), '-o', join(app, 'Contents/MacOS/DocumentHelperCaller')]);
run('xcrun', ['clang', '-O2', '-mmacosx-version-min=13.0', '-Wall', '-Wextra', join(source, 'Launcher.c'), '-o', join(app, 'Contents/MacOS/DocumentHelperLauncher')]);
const caller = join(app, 'Contents/MacOS/DocumentHelperCaller');
run('codesign', [...signOptions, '--identifier', 'dev.zq.' + identity + '.Caller', caller]);
const signature = spawnSync('codesign', ['-d', '--verbose=4', caller], { encoding: 'utf8' });
const hash = signature.stderr?.match(/^CDHash=([a-f0-9]{40})$/m)?.[1];
if (signature.status !== 0 || !hash) throw new Error('Could not pin the signed caller identity');
const callerPolicy = join(base, identity + '-CallerPolicy.swift');
const requirement = spawnSync('codesign', ['-d', '-r-', caller], {encoding:'utf8'});
const designated = (requirement.stdout + requirement.stderr).match(/^designated => (.+)$/m)?.[1];
if (signingIdentity !== '-' && (!designated || !designated.includes('anchor apple'))) throw Error('A release helper requires an Apple-issued signing identity.');
await writeFile(callerPolicy, 'let allowedCallerRequirement = ' + JSON.stringify(signingIdentity === '-' ? 'cdhash H"' + hash + '"' : designated) + '\n');
const cleanupObject = join(base, identity + '-Cleanup.o');
run('xcrun', ['clang', '-O2', '-mmacosx-version-min=13.0', '-Wall', '-Wextra', '-c', join(source, 'Cleanup.c'), '-o', cleanupObject]);
const monitorObject = join(base, identity + '-ResourceMonitor.o');
run('xcrun', ['clang', '-O2', '-mmacosx-version-min=13.0', '-Wall', '-Wextra', '-c', join(source, 'ResourceMonitor.c'), '-o', monitorObject]);
run('xcrun', ['swiftc', '-O', '-target', 'arm64-apple-macos13.0', join(source, 'Protocol.swift'), join(source, 'Service.swift'), join(source, 'JobLease.swift'), callerPolicy, cleanupObject, monitorObject, '-o', join(service, 'Contents/MacOS/DocumentHelperService')]);
run('xcrun', ['clang', '-O2', '-mmacosx-version-min=13.0', '-Wall', '-Wextra', join(source, 'Worker.c'), '-o', join(service, 'Contents/MacOS/DocumentHelperWorker')]);
run('codesign', [...signOptions, ...entitlements('Worker'), join(service, 'Contents/MacOS/DocumentHelperWorker')]);
run('xcrun', ['clang', '-O2', '-mmacosx-version-min=13.0', '-Wall', '-Wextra', join(source, 'Supervisor.c'), cleanupObject, monitorObject, '-o', join(service, 'Contents/MacOS/DocumentHelperSupervisor')]);
run('codesign', [...signOptions, ...entitlements('Worker'), join(service, 'Contents/MacOS/DocumentHelperSupervisor')]);
const runtime = join(base, 'runtime/python');
if (!existsSync(runtime)) throw new Error('Prepared document runtime missing.');
{
  const destination = join(service, 'Contents/Resources/python');
  await cp(runtime, destination, { recursive: true, verbatimSymlinks: true });
  // Sign Mach-O libraries/extensions inside out, before signing their containing bundles.
  async function signTree(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const file = join(directory, entry.name);
      if (entry.isDirectory()) await signTree(file);
      else if (entry.isFile()) {
        const handle = await open(file, 'r');
        const magic = Buffer.alloc(4);
        try { await handle.read(magic, 0, 4, 0); } finally { await handle.close(); }
        if (['cffaedfe', 'cefaedfe', 'feedfacf', 'feedface', 'cafebabe', 'bebafeca'].includes(magic.toString('hex'))) {
          const kind = execFileSync('file', ['-b', file], { encoding: 'utf8' });
          const args = [...signOptions];
          if (kind.includes('executable')) args.push(...entitlements('Worker'));
          run('codesign', [...args, file]);
        }
      }
    }
  }
  await signTree(destination);
}
await copyFile(join(source, 'renderer.py'), join(service, 'Contents/Resources/renderer.py'));
await copyFile(join(base, 'runtime/runtime-provenance.json'), join(service, 'Contents/Resources/runtime-provenance.json'));
await copyFile(join(source, 'requirements.lock'), join(service, 'Contents/Resources/requirements.lock'));
run(join(base,'runtime/python/bin/python3.12'), ['-I','-B',join(source,'prepare-fonts.py'),join(root,'node_modules/@fontsource/noto-sans/files'),join(service,'Contents/Resources/fonts')]);
await copyFile(join(root,'node_modules/@fontsource/noto-sans/LICENSE'),join(service,'Contents/Resources/fonts/LICENSE'));

run('codesign', [...signOptions, ...entitlements('Service'), service]);
run('codesign', [...signOptions, app]);
run('codesign', ['--verify', '--deep', '--strict', app]);
console.log(app);
