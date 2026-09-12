const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const jobsRoot = path.join(os.tmpdir(), 'zq-native-helper-locks', 'dev.zq.SkillHelperSeatbeltProbe.Service.jobs');
const enabled = process.platform === 'darwin' && process.env.ZQ_TEST_NATIVE_RECOVERY === '1';
const app = path.resolve(__dirname, '../../../.local-data/skill-helper-prototype/SkillHelperSeatbeltProbe.app');
const client = path.join(app, 'Contents/MacOS/SkillHelperPrototype');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
function command(pid) { return spawnSync('/bin/ps', ['-p', String(pid), '-o', 'command='], {encoding:'utf8'}).stdout.trim(); }
function alive(pid) { try { process.kill(pid, 0); return true; } catch(e) { if(e.code==='ESRCH') return false; throw e; } }
async function until(fn, ms=3000) { const end=performance.now()+ms; do { const result=fn(); if(result) return result; await delay(20); } while(performance.now()<end); return null; }
for (const scenario of ['service', 'client', 'worker', 'output', 'lease']) test(`${scenario} interruption cleans up and permits subsequent work`, {skip:!enabled, timeout:15000}, async t => {
  const nonce=crypto.randomUUID();
  const proc=spawn(client, [], {stdio:['pipe','pipe','pipe']});
  let stderr='',stdout=''; proc.stderr.on('data',b=>stderr+=b); proc.stdout.on('data',b=>{if(stdout.length<14*1024*1024)stdout+=b;});
  const exited=new Promise(resolve=>proc.once('exit',(code,signal)=>resolve({code,signal})));
  proc.stdin.end(JSON.stringify({files:[],code:`import os,pathlib,json,time\npathlib.Path('recovery-${nonce}').write_text(json.dumps({'worker':os.getpid(),'service':os.getppid()}))\n${scenario==='output' ? "end=time.monotonic()+8\nwhile time.monotonic()<end:\n os.write(2,b'x'*65536)\n time.sleep(.002)" : 'time.sleep(8)'}`}));
  let job,ids;
  t.after(async()=>{
    if(ids?.supervisor && alive(ids.supervisor)) process.kill(ids.supervisor,'SIGCONT');
    if(ids && alive(ids.worker) && command(ids.worker).includes(app)) process.kill(ids.worker,'SIGKILL');
    if(proc.exitCode===null && proc.signalCode===null) proc.kill('SIGKILL');
    await exited;
    if(job) fs.rmSync(job,{recursive:true,force:true});
  });
  const ready=await until(()=>{
    for(const entry of (fs.existsSync(jobsRoot)?fs.readdirSync(jobsRoot):[]).filter(n=>/^zq-skill-[A-F0-9-]+$/i.test(n))) {
      const root=path.join(jobsRoot,entry), file=path.join(root,'recovery-'+nonce);
      try { const data=JSON.parse(fs.readFileSync(file,'utf8')); return {root,data}; } catch{}
    }
  },5000);
  assert.ok(ready,`worker did not become ready: ${stderr}`);
  job=ready.root; ids=ready.data;
  if(command(ids.service).includes('SkillHelperSupervisor')) {
    ids.supervisor=ids.service;
    ids.service=Number(spawnSync('/bin/ps',['-p',String(ids.supervisor),'-o','ppid='],{encoding:'utf8'}).stdout.trim());
  }
  assert.ok(Number.isInteger(ids.service)&&ids.service>1);
  assert.ok(command(ids.service).includes(path.join(app,'Contents/XPCServices/SkillHelperService.xpc/Contents/MacOS/SkillHelperService')));
  assert.ok(command(ids.worker).includes(app));
  if(scenario==='lease') {
    assert.ok(ids.supervisor,'supervisor must own the inherited lease');
    process.kill(ids.supervisor,'SIGSTOP');
    assert.ok(await until(()=>spawnSync('/bin/ps',['-p',String(ids.supervisor),'-o','state='],{encoding:'utf8'}).stdout.includes('T')));
  }
  process.kill(scenario==='client'?proc.pid:scenario==='worker'?ids.worker:ids.service,'SIGKILL');
  if(scenario==='lease') {
    const denied=spawnSync(client,[],{input:JSON.stringify({code:"print('overlap')",files:[]}),encoding:'utf8',timeout:10000});
    assert.equal(denied.status,0,denied.stderr);
    const reply=JSON.parse(denied.stdout);
    // POSIX resumes an orphaned stopped group. It may already have cleaned up;
    // admission can succeed only after the previous worker and job are gone.
    if(reply.error) assert.equal(reply.error,'helper already has an active job');
    else { assert.equal(alive(ids.worker),false,'admitted work while old worker survived'); assert.equal(fs.existsSync(job),false); }
    if(alive(ids.supervisor)) process.kill(ids.supervisor,'SIGCONT');
  }
  const result=await exited;
  if(scenario==='worker') {
    assert.equal(result.code,0,stderr);
    assert.notEqual(JSON.parse(stdout).exitCode,0);
    assert.deepEqual(JSON.parse(stdout).files,[]);
  } else assert.notEqual(result.code,0,'interrupted client/service must not return successful artifacts');
  assert.ok(await until(()=>!alive(ids.worker)), 'worker survived its XPC service crash');
  assert.ok(await until(()=>!fs.existsSync(job)), 'staged job survived its XPC service crash');
  const recovered=await until(()=>{
    const next=spawnSync(client,[],{input:JSON.stringify({code:"print('recovered')",files:[]}),encoding:'utf8',timeout:10000});
    assert.equal(next.status,0,next.stderr);
    const reply=JSON.parse(next.stdout);
    if(reply.error==='helper already has an active job') return false;
    assert.equal(reply.stdout?.trim(),'recovered',next.stdout);
    return true;
  });
  assert.ok(recovered,'job slot did not recover');
});

test('admission removes stale staged data before starting the next worker', {skip:!enabled}, () => {
  const jobs=path.join(os.tmpdir(),'zq-native-helper-locks','dev.zq.SkillHelperSeatbeltProbe.Service.jobs');
  fs.mkdirSync(jobs,{recursive:true,mode:0o700});
  const stale=fs.mkdtempSync(path.join(jobs,'zq-skill-'));
  fs.writeFileSync(path.join(stale,'synthetic-private-input'),'SYNTHETIC');
  try {
    const next=spawnSync(client,[],{input:JSON.stringify({code:"print('recovered')",files:[]}),encoding:'utf8',timeout:10000});
    assert.equal(next.status,0,next.stderr);
    assert.equal(JSON.parse(next.stdout).stdout?.trim(),'recovered',next.stdout);
    assert.equal(fs.existsSync(stale),false,'stale data must be removed before admitting new work');
  } finally { fs.rmSync(stale,{recursive:true,force:true}); }
});
