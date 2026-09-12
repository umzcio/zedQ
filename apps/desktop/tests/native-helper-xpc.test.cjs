const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const enabled = process.platform === 'darwin' && process.env.ZQ_TEST_NATIVE_HELPER === '1';
const probe = process.env.ZQ_NATIVE_HELPER_MODE === 'app-sandbox-only-probe';
const client = path.resolve(__dirname, '../../../.local-data/skill-helper-prototype', probe ? 'SkillHelperSandboxProbe.app' : 'SkillHelperPrototype.app', 'Contents/MacOS/SkillHelperPrototype');
function execute(request, args = []) {
  const run = spawnSync(client, args, { input: JSON.stringify(request), encoding: 'utf8', timeout: 40000, maxBuffer: 14 * 1024 * 1024 });
  assert.equal(run.error, undefined, String(run.error));
  assert.equal(run.status, 0, run.stderr);
  return JSON.parse(run.stdout);
}
test('standalone client reaches bundled XPC service', { skip: !enabled }, () => {
  assert.deepEqual(execute({}, ['--ping']), { pong: true });
});
test('strict worker fails closed when nested policy installation is denied', { skip: !enabled || probe }, () => {
  const result = execute({ code: 'print("must-not-run")', files: [] });
  assert.equal(result.exitCode, 125, JSON.stringify(result));
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /restrictive sandbox initialization failed: Operation not permitted/);
});
test('diagnostic App Sandbox worker executes bundled Python', { skip: !enabled || !probe }, () => {
  const result = execute({ code: 'print("native-python-ok")', files: [] });
  assert.equal(result.exitCode, 0, JSON.stringify(result));
  assert.equal(result.stdout.trim(), 'native-python-ok');
});
test('diagnostic denies synthetic home and host temporary file reads', { skip: !enabled || !probe }, () => {
  const directories = [fs.mkdtempSync(path.join(os.homedir(), '.zq-native-canary-')), fs.mkdtempSync(path.join(os.tmpdir(), 'zq-native-canary-'))];
  try {
    const names = directories.map(directory => { const file = path.join(directory, 'fake-secret'); fs.writeFileSync(file, 'SYNTHETIC-CANARY'); return file; });
    const code = `import json\nresult=[]\nfor name in ${JSON.stringify(names)}:\n try:\n  open(name).read()\n  result.append('ALLOWED')\n except OSError:\n  result.append('DENIED')\nprint(json.dumps(result))`;
    const result = execute({ code, files: [] });
    assert.equal(result.exitCode, 0, JSON.stringify(result));
    assert.deepEqual(JSON.parse(result.stdout), ['DENIED', 'DENIED']);
  } finally { for (const directory of directories) fs.rmSync(directory, { recursive: true, force: true }); }
});
test('diagnostic App Sandbox denies network socket creation', { skip: !enabled || !probe }, () => {
  const result = execute({ code: "import socket\ntry:\n socket.socket().connect(('127.0.0.1',9))\n print('ALLOWED')\nexcept OSError as error:\n print(error.errno)", files: [] });
  assert.equal(result.exitCode, 0, JSON.stringify(result));
  assert.match(result.stdout.trim(), /^(1|13)$/);
});
test('diagnostic exposes whether shells and process creation remain allowed', { skip: !enabled || !probe }, () => {
  const code = `import subprocess,json,os\nr={}\nfor name,args in [('shell',['/bin/sh','-c','printf synthetic-shell']),('osascript',['/usr/bin/osascript','-e','return 1'])]:\n try:\n  p=subprocess.run(args,capture_output=True,timeout=3)\n  r[name]={'returncode':p.returncode,'stdout':p.stdout.decode(),'stderr':p.stderr.decode()}\n except OSError as e:\n  r[name]={'errno':e.errno}\ntry:\n pid=os.fork()\n if pid==0:\n  os.setsid()\n  os._exit(0)\n _,status=os.waitpid(pid,0)\n r['forkSetsid']=status\nexcept OSError as e:\n r['forkSetsid']={'errno':e.errno}\nprint(json.dumps(r))`;
  const result = execute({ code, files: [] });
  assert.equal(result.exitCode, 0, JSON.stringify(result));
  const measured = JSON.parse(result.stdout);
  console.log('App Sandbox process probe:', measured);
  assert.equal(measured.shell.returncode, 0);
  assert.equal(measured.shell.stdout, 'synthetic-shell');
  assert.equal(measured.forkSetsid, 0);
});
test('diagnostic cancellation stops the active worker promptly', { skip: !enabled || !probe }, () => {
  const started = performance.now();
  const result = execute({ code: 'import time\ntime.sleep(60)', files: [] }, ['--cancel-after-ms', '250']);
  assert.notEqual(result.exitCode, 0);
  assert.ok(performance.now() - started < 3000);
});
module.exports = { execute, enabled };
test('diagnostic exposes writes outside the individual job directory', { skip: !enabled || !probe }, () => {
  const result = execute({ code: "import tempfile,pathlib\nwith tempfile.TemporaryDirectory(prefix='zq-synthetic-sibling-',dir=pathlib.Path.cwd().parent) as directory:\n p=pathlib.Path(directory)/'canary'\n p.write_text('SYNTHETIC')\n print(p.read_text())", files: [] });
  assert.equal(result.exitCode, 0, JSON.stringify(result));
  assert.equal(result.stdout.trim(), 'SYNTHETIC');
});
test('diagnostic records detached child lifetime gap without leaving a child running', { skip: !enabled || !probe }, async () => {
  const code = "import os,time\npid=os.fork()\nif pid==0:\n os.setsid()\n os.write(2,('SYNTHETIC-CHILD-PID:'+str(os.getpid())).encode())\n time.sleep(0.8)\n os._exit(0)\ntime.sleep(60)";
  const result = execute({ code, files: [] }, ['--cancel-after-ms', '250']);
  assert.notEqual(result.exitCode, 0);
  const match = result.stderr.match(/SYNTHETIC-CHILD-PID:(\d+)/);
  assert.ok(match, JSON.stringify(result));
  const pid = Number(match[1]);
  try {
    assert.doesNotThrow(() => process.kill(pid, 0), 'detached child demonstrably survives cancellation');
    await new Promise(resolve => setTimeout(resolve, 1000));
    assert.throws(() => process.kill(pid, 0), /ESRCH/, 'synthetic child exits itself');
  } finally {
    try { process.kill(pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
  }
});
test('diagnostic bounds raw worker output independently of Python stream capture', { skip: !enabled || !probe }, () => {
  const result = execute({ code: "import os\nwhile True: os.write(1,b'x'*65536)", files: [] });
  assert.notEqual(result.exitCode, 0);
  assert.equal(result.error, 'worker output limit exceeded');
});
test('diagnostic enforces an OS per-file size ceiling', { skip: !enabled || !probe }, () => {
  const result = execute({ code: "import os\nwith open('outputs/too-big','wb') as f: os.ftruncate(f.fileno(),65*1024*1024)\nprint('UNBOUNDED')", files: [] });
  assert.notEqual(result.exitCode, 0);
  assert.doesNotMatch(result.stdout || '', /UNBOUNDED/);
});
test('diagnostic wall watchdog terminates sleeping work', { skip: !enabled || !probe, timeout: 35000 }, () => {
  const started = performance.now();
  const result = execute({ code: 'import time\ntime.sleep(60)', files: [] });
  assert.notEqual(result.exitCode, 0);
  assert.ok(performance.now() - started < 33000);
});
test('diagnostic reaps same-group descendants after normal worker completion', { skip: !enabled || !probe }, async () => {
  const result = execute({code:"import os,time\npid=os.fork()\nif pid==0:\n time.sleep(2)\n os._exit(0)\nprint(pid)",files:[]});
  assert.equal(result.exitCode,0,JSON.stringify(result));
  const pid=Number(result.stdout.trim());
  assert.ok(Number.isInteger(pid)&&pid>1);
  try {
    for(let i=0;i<20;i++) {
      try { process.kill(pid,0); } catch(e) { if(e.code==='ESRCH') return; throw e; }
      await new Promise(resolve=>setTimeout(resolve,10));
    }
    assert.fail('same-group descendant survived normal completion');
  } finally { try {process.kill(pid,'SIGKILL');}catch(e){if(e.code!=='ESRCH')throw e;} }
});
