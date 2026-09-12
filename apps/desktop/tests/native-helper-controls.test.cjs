const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const enabled = process.platform === 'darwin' && process.env.ZQ_TEST_NATIVE_CONTROLS === '1';
const app = path.resolve(__dirname, '../../../.local-data/skill-helper-prototype/SkillHelperSeatbeltProbe.app');
const caller = bundle => path.join(bundle, 'Contents/MacOS/SkillHelperPrototype');
function execute(code) {
  const result = spawnSync(caller(app), [], { input: JSON.stringify({ code, files: [] }), encoding: 'utf8', timeout: 10000, maxBuffer: 14 * 1024 * 1024 });
  assert.equal(result.error, undefined, String(result.error));
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}
test('XPC accepts the bundled caller and rejects another signature with the same identifier', { skip: !enabled }, () => {
  const legitimate = spawnSync(caller(app), ['--ping'], { encoding: 'utf8', timeout: 10000 });
  assert.equal(legitimate.status, 0, legitimate.stderr);
  assert.deepEqual(JSON.parse(legitimate.stdout), { pong: true });
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'zq-caller-test-'));
  try {
    const copy = path.join(temporary, 'CallerProbe.app');
    fs.cpSync(app, copy, { recursive: true, verbatimSymlinks: true });
    const control = spawnSync(caller(copy), ['--ping'], { encoding: 'utf8', timeout: 10000 });
    assert.equal(control.status, 0, control.stderr);
    assert.deepEqual(JSON.parse(control.stdout), { pong: true });
    // Use a fresh inode after the control run to avoid an executable mapping or
    // kernel signature-cache artifact being mistaken for an XPC rejection.
    const fresh = path.join(temporary, 'fresh-caller');
    fs.copyFileSync(caller(copy), fresh);
    fs.renameSync(fresh, caller(copy));
    for (const target of [caller(copy), copy]) {
      const signed = spawnSync('codesign', ['--force', '--sign', '-', '--identifier', 'dev.zq.SkillHelperSeatbeltProbe.Caller', '--options', '0', target], { encoding: 'utf8' });
      assert.equal(signed.status, 0, signed.stderr);
    }
    const verified = spawnSync('codesign', ['--verify', '--deep', '--strict', copy], { encoding: 'utf8' });
    assert.equal(verified.status, 0, verified.stderr);
    const impostor = spawnSync(caller(copy), ['--ping'], { encoding: 'utf8', timeout: 10000 });
    assert.equal(impostor.error, undefined, String(impostor.error));
    assert.notEqual(impostor.status, 0, 'different caller signature must fail before ping is dispatched');
    assert.equal(impostor.stdout, '');
    assert.match(impostor.stderr, /XPC:/);
  } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
});
test('native watchdog rejects excessive job entry counts', { skip: !enabled }, () => {
  const result = execute("import pathlib,time\nfor i in range(4100): pathlib.Path('entry-'+str(i)).touch()\ntime.sleep(1.5)");
  assert.notEqual(result.exitCode, 0);
  assert.equal(result.error, 'job file count or depth threshold exceeded');
});
test('native watchdog stops work above its memory threshold', { skip: !enabled }, () => {
  const result = execute("import time\nallocated=bytearray(300*1024*1024)\ntime.sleep(1.5)");
  assert.notEqual(result.exitCode, 0);
  assert.equal(result.error, 'worker memory threshold exceeded');
  assert.deepEqual(result.files, []);
});
test('native watchdog accounts for total job file bytes including sparse files', { skip: !enabled }, () => {
  const result = execute("import time\nfor i in range(3):\n with open('synthetic-'+str(i),'wb') as f: f.truncate(24*1024*1024)\ntime.sleep(1.5)");
  assert.notEqual(result.exitCode, 0);
  assert.equal(result.error, 'job file byte threshold exceeded');
  assert.deepEqual(result.files, []);
});
test('final resource check rejects oversized jobs that finish immediately', { skip: !enabled }, () => {
  const result = execute("for i in range(3):\n with open('synthetic-'+str(i),'wb') as f: f.truncate(24*1024*1024)");
  assert.notEqual(result.exitCode, 0);
  assert.equal(result.error, 'job file byte threshold exceeded');
});
test('job slot is shared across client processes and released on completion', { skip: !enabled }, async () => {
  const nonce = require('node:crypto').randomUUID();
  const temporary = os.tmpdir();
  const before = new Set(fs.readdirSync(temporary));
  const first = spawn(caller(app), [], { stdio: ['pipe', 'pipe', 'pipe'] });
  let output = '', errors = '';
  first.stdout.on('data', data => output += data);
  first.stderr.on('data', data => errors += data);
  const finished = new Promise((resolve, reject) => { first.on('error', reject); first.on('close', status => resolve(status)); });
  first.stdin.end(JSON.stringify({ code: `import pathlib,time\npathlib.Path('ready').write_text(${JSON.stringify(nonce)})\ntime.sleep(2)`, files: [] }));
  try {
    let ready = false;
    for (let i = 0; i < 100 && !ready; i++) {
      for (const name of fs.readdirSync(temporary)) {
        if (before.has(name) || !/^zq-skill-[A-F0-9-]+$/i.test(name)) continue;
        try { ready = fs.readFileSync(path.join(temporary, name, 'ready'), 'utf8') === nonce; } catch {}
        if (ready) break;
      }
      if (!ready) await new Promise(resolve => setTimeout(resolve, 20));
    }
    assert.ok(ready, 'first worker reached its synthetic ready marker');
    const second = execute("print('must wait')");
    assert.equal(second.error, 'helper already has an active job');
    assert.notEqual(second.exitCode, 0);
    assert.equal(await finished, 0, errors);
    assert.equal(JSON.parse(output).exitCode, 0, output);
    assert.equal(execute("print('slot released')").stdout.trim(), 'slot released');
  } finally { if (first.exitCode === null) first.kill('SIGKILL'); await finished; }
});
