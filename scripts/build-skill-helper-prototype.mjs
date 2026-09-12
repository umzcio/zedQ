import { mkdir, copyFile, rm, cp, readdir, open, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = join(root, 'apps/desktop/native/skill-helper-prototype');
const base = join(root, '.local-data/skill-helper-prototype');
const probe = process.argv.includes('--app-sandbox-only-probe');
const seatbelt = process.argv.includes('--seatbelt-only-probe');
if (process.argv.slice(2).some(arg => !['--app-sandbox-only-probe', '--seatbelt-only-probe'].includes(arg)) || (probe && seatbelt)) throw new Error('Unknown or conflicting build option');
// Explicit development variants. Never fall back from one isolation boundary to another.
const identity = seatbelt ? 'SkillHelperSeatbeltProbe' : probe ? 'SkillHelperSandboxProbe' : 'SkillHelperPrototype';
const app = join(base, identity + '.app');
const swiftFlags = seatbelt ? ['-D', 'SEATBELT_ONLY_PROBE'] : probe ? ['-D', 'APP_SANDBOX_ONLY_PROBE'] : [];
const entitlements = name => seatbelt ? [] : ['--entitlements', join(source, name + '.entitlements')];
const service = join(app, 'Contents/XPCServices/SkillHelperService.xpc');
const run = (name, args) => execFileSync(name, args, { stdio: 'inherit' });
if (process.platform !== 'darwin') throw new Error('This prototype requires macOS');
await rm(app, { recursive: true, force: true });
await mkdir(join(app, 'Contents/MacOS'), { recursive: true });
await mkdir(join(service, 'Contents/MacOS'), { recursive: true });
await mkdir(join(service, 'Contents/Resources'), { recursive: true });
for (const [input, output] of [['Client.plist', join(app, 'Contents/Info.plist')], ['Service.plist', join(service, 'Contents/Info.plist')]]) {
  let text = await readFile(join(source, input), 'utf8');
  text = text.replaceAll('dev.zq.SkillHelperPrototype', 'dev.zq.' + identity);
  if (input === 'Client.plist') text = text.replace('<string>SkillHelperPrototype</string>', '<string>SkillHelperLauncher</string>');
  await writeFile(output, text);
}
run('xcrun', ['swiftc', '-O', ...swiftFlags, join(source, 'Protocol.swift'), join(source, 'Client.swift'), '-o', join(app, 'Contents/MacOS/SkillHelperPrototype')]);
run('xcrun', ['clang', '-O2', '-Wall', '-Wextra', join(source, 'Launcher.c'), '-o', join(app, 'Contents/MacOS/SkillHelperLauncher')]);
const caller = join(app, 'Contents/MacOS/SkillHelperPrototype');
run('codesign', ['--force', '--sign', '-', '--options', 'runtime', '--identifier', 'dev.zq.' + identity + '.Caller', caller]);
const signature = spawnSync('codesign', ['-d', '--verbose=4', caller], { encoding: 'utf8' });
const hash = signature.stderr?.match(/^CDHash=([a-f0-9]{40})$/m)?.[1];
if (signature.status !== 0 || !hash) throw new Error('Could not pin the signed caller identity');
const callerPolicy = join(base, identity + '-CallerPolicy.swift');
await writeFile(callerPolicy, 'let allowedCallerRequirement = ' + JSON.stringify('cdhash H"' + hash + '"') + '\n');
const cleanupObject = join(base, identity + '-Cleanup.o');
run('xcrun', ['clang', '-O2', '-Wall', '-Wextra', '-c', join(source, 'Cleanup.c'), '-o', cleanupObject]);
const monitorObject = join(base, identity + '-ResourceMonitor.o');
run('xcrun', ['clang', '-O2', '-Wall', '-Wextra', '-c', join(source, 'ResourceMonitor.c'), '-o', monitorObject]);
run('xcrun', ['swiftc', '-O', ...swiftFlags, join(source, 'Protocol.swift'), join(source, 'Service.swift'), join(source, 'JobLease.swift'), callerPolicy, cleanupObject, monitorObject, '-o', join(service, 'Contents/MacOS/SkillHelperService')]);
run('xcrun', ['clang', '-O2', '-Wall', '-Wextra', ...(probe ? ['-DAPP_SANDBOX_ONLY_PROBE=1'] : []), join(source, 'Worker.c'), '-o', join(service, 'Contents/MacOS/SkillHelperWorker')]);
run('codesign', ['--force', '--sign', '-', ...entitlements('Worker'), join(service, 'Contents/MacOS/SkillHelperWorker')]);
const runtime = join(base, 'runtime/python');
if (existsSync(runtime)) {
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
          const args = ['--force', '--sign', '-'];
          if (kind.includes('executable')) args.push(...entitlements('Worker'));
          run('codesign', [...args, file]);
        }
      }
    }
  }
  await signTree(destination);
}
if (existsSync(join(source, 'runner.py'))) await copyFile(join(source, 'runner.py'), join(service, 'Contents/Resources/runner.py'));
run('codesign', ['--force', '--sign', '-', ...entitlements('Service'), service]);
run('codesign', ['--force', '--sign', '-', app]);
run('codesign', ['--verify', '--deep', '--strict', app]);
console.log(app);
