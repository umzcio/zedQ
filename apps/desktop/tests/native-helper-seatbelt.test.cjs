const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const jobsRoot = path.join(os.tmpdir(), 'zq-native-helper-locks', 'dev.zq.SkillHelperSeatbeltProbe.Service.jobs');
const enabled = process.platform === 'darwin' && process.env.ZQ_TEST_NATIVE_SEATBELT === '1';
if (![undefined, 'strict', 'seatbelt-only-probe'].includes(process.env.ZQ_NATIVE_HELPER_MODE)) throw new Error('Invalid Seatbelt test mode');
const app = process.env.ZQ_NATIVE_HELPER_MODE === 'strict' ? 'SkillHelperPrototype.app' : 'SkillHelperSeatbeltProbe.app';
const client = path.resolve(__dirname, '../../../.local-data/skill-helper-prototype', app, 'Contents/MacOS/SkillHelperPrototype');
function execute(code, args = []) {
  const run = spawnSync(client, args, { input: JSON.stringify({ code, files: [] }), encoding: 'utf8', timeout: 40000, maxBuffer: 14 * 1024 * 1024 });
  assert.equal(run.error, undefined, String(run.error));
  assert.equal(run.status, 0, run.stderr);
  return JSON.parse(run.stdout);
}
function success(code) {
  const result = execute(code);
  assert.equal(result.exitCode, 0, JSON.stringify(result));
  return result.stdout.trim();
}
test('per-job policy executes bundled Python and permits job file IO', { skip: !enabled }, () => {
  assert.equal(success("from pathlib import Path\np=Path('canary')\np.write_text('job-only')\nprint(p.read_text())"), 'job-only');
});
test('per-job policy denies synthetic host file reads and sibling writes', { skip: !enabled }, () => {
  const dirs = [fs.mkdtempSync(path.join(os.homedir(), '.zq-seatbelt-canary-')), fs.mkdtempSync(path.join(os.tmpdir(), 'zq-seatbelt-canary-'))];
  try {
    const files = dirs.map(dir => { const name = path.join(dir, 'fake-secret'); fs.writeFileSync(name, 'SYNTHETIC'); return name; });
    const code = `import json,pathlib,uuid\nr=[]\nfor name in ${JSON.stringify(files)}:\n try:\n  pathlib.Path(name).read_bytes()\n  r.append('ALLOWED')\n except PermissionError:\n  r.append('DENIED')\np=pathlib.Path.cwd().parent/('zq-synthetic-'+str(uuid.uuid4()))\ntry:\n p.write_text('SYNTHETIC')\n p.unlink()\n r.append('ALLOWED')\nexcept PermissionError:\n r.append('DENIED')\nprint(json.dumps(r))`;
    assert.deepEqual(JSON.parse(success(code)), ['DENIED', 'DENIED', 'DENIED']);
  } finally { dirs.forEach(dir => fs.rmSync(dir, { recursive: true, force: true })); }
});
test('per-job policy denies network access and child creation', { skip: !enabled }, () => {
  const code = "import os,json,socket,subprocess\nr={}\ntry:\n socket.socket().connect(('127.0.0.1',9))\n r['network']='ALLOWED'\nexcept PermissionError:\n r['network']='DENIED'\ntry:\n pid=os.fork()\n if pid==0: os._exit(0)\n os.waitpid(pid,0)\n r['fork']='ALLOWED'\nexcept PermissionError:\n r['fork']='DENIED'\ntry:\n subprocess.run(['/bin/sh','-c','printf synthetic'],capture_output=True,timeout=2)\n r['shell']='ALLOWED'\nexcept PermissionError:\n r['shell']='DENIED'\nprint(json.dumps(r))";
  assert.deepEqual(JSON.parse(success(code)), { network: 'DENIED', fork: 'DENIED', shell: 'DENIED' });
});
test('per-job policy denies direct exec of a system binary', { skip: !enabled }, () => {
  assert.equal(success("import os\ntry:\n os.execv('/bin/sh',['sh','-c','printf UNRESTRICTED'])\nexcept PermissionError:\n print('DENIED')"), 'DENIED');
});
test('per-job policy denies posix_spawn even for the allowed interpreter', { skip: !enabled }, () => {
  assert.equal(success("import os,sys\ntry:\n pid=os.posix_spawn(sys.executable,[sys.executable,'-I','-c','pass'],{})\n os.waitpid(pid,0)\n print('ALLOWED')\nexcept PermissionError:\n print('DENIED')"), 'DENIED');
});
test('per-job policy follows symlink targets and denies host writes', { skip: !enabled }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zq-seatbelt-link-'));
  const file = path.join(dir, 'fake-secret');
  fs.writeFileSync(file, 'SYNTHETIC');
  try {
    const code = `import pathlib,json\np=pathlib.Path('escape-link')\np.symlink_to(${JSON.stringify(file)})\nr=[]\nfor op in [lambda:p.read_bytes(),lambda:p.write_text('MODIFIED')]:\n try:\n  op()\n  r.append('ALLOWED')\n except PermissionError:\n  r.append('DENIED')\nprint(json.dumps(r))`;
    assert.deepEqual(JSON.parse(success(code)), ['DENIED', 'DENIED']);
    assert.equal(fs.readFileSync(file, 'utf8'), 'SYNTHETIC');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
test('per-job policy survives re-exec of the bundled interpreter', { skip: !enabled }, () => {
  const next = "import socket,json\ntry:\n socket.socket().connect(('127.0.0.1',9))\n status='ALLOWED'\nexcept PermissionError:\n status='DENIED'\nprint(json.dumps({'exitCode':0,'stdout':status,'files':[]}))";
  assert.equal(success(`import os,sys\nos.execv(sys.executable,[sys.executable,'-I','-c',${JSON.stringify(next)}])`), 'DENIED');
});
test('per-job worker cancellation responds promptly', { skip: !enabled }, () => {
  const start = performance.now();
  const result = execute("import os,time\nos.write(2,b'WORKER-STARTED')\ntime.sleep(60)", ['--cancel-after-ms', '1000']);
  assert.notEqual(result.exitCode, 0);
  assert.match(result.stderr, /WORKER-STARTED/);
  assert.ok(performance.now() - start < 3000);
});
test('service cleans a job whose code removes directory permissions', { skip: !enabled }, async () => {
  const before = new Set(fs.readdirSync(jobsRoot));
  const response = execute("import os,pathlib\np=pathlib.Path('locked')\np.mkdir()\n(p/'synthetic').write_text('SYNTHETIC')\np.chmod(0)\nroot=pathlib.Path.cwd()\nroot.chmod(0)\nprint(root)");
  assert.notEqual(response.exitCode, 0);
  assert.equal(response.error, 'could not measure job resources');
  // The resource monitor fails closed on the locked root. Completion now includes
  // cleanup, so there must be no newly-created job left when the reply arrives.
  const remaining = fs.readdirSync(jobsRoot).filter(name => !before.has(name) && /^zq-skill-[A-F0-9-]+$/i.test(name));
  try {
    assert.deepEqual(remaining, [], 'service must remove permission-locked job data before replying');
  } finally {
    for (const name of remaining) {
      const job = path.join(jobsRoot, name);
      fs.chmodSync(job, 0o700);
      if (fs.existsSync(path.join(job, 'locked'))) fs.chmodSync(path.join(job, 'locked'), 0o700);
      fs.rmSync(job, { recursive: true, force: true });
    }
  }
});
test('service cleanup unlinks directory symlinks without touching their targets', { skip: !enabled }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zq-seatbelt-cleanup-'));
  const file = path.join(dir, 'fake-secret');
  fs.writeFileSync(file, 'SYNTHETIC');
  fs.chmodSync(dir, 0o500);
  try {
    const job = success(`import pathlib\npathlib.Path('host-link').symlink_to(${JSON.stringify(dir)},target_is_directory=True)\nprint(pathlib.Path.cwd())`);
    assert.equal(fs.realpathSync(path.dirname(job)), fs.realpathSync(jobsRoot));
    assert.match(path.basename(job), /^zq-skill-[A-F0-9-]+$/i);
    for (let i=0; i<30 && fs.existsSync(job); i++) await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(fs.existsSync(job), false);
    assert.equal(fs.readFileSync(file, 'utf8'), 'SYNTHETIC');
    assert.equal(fs.statSync(dir).mode & 0o777, 0o500);
  } finally { fs.chmodSync(dir, 0o700); fs.rmSync(dir, { recursive: true, force: true }); }
});
