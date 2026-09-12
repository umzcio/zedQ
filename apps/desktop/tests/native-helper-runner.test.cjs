'use strict';
// Validation-only host tests. Executed skill code belongs in the real XPC integration tests.
const {test}=require('node:test'),assert=require('node:assert/strict'),{spawnSync}=require('node:child_process'),path=require('node:path'),fs=require('node:fs');
const runner=path.resolve(__dirname,'../native/skill-helper-prototype/runner.py');
function check(code){assert.ok(fs.existsSync(runner),'native helper runner exists');const result=spawnSync('/usr/bin/python3',['-I','-B','-c',`import importlib.util, json, tempfile, pathlib, os\nspec=importlib.util.spec_from_file_location('runner',${JSON.stringify(runner)})\nm=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)\n${code}`],{encoding:'utf8'});assert.equal(result.status,0,result.stderr)}
test('native runner rejects unsafe, duplicate, oversized or malformed staging before writing files',()=>check(`
good={'code':'pass','files':[{'path':'skill/scripts/a.py','data':'cGFzcw=='}]}
m.validate_request(good)
for value in ['../x','/tmp/x','inputs/../x','inputs//x','inputs/./x','skill/a\\\\b','other/x']:
 try: m.validate_request(dict(good,files=[dict(good['files'][0],path=value)]))
 except ValueError: pass
 else: raise AssertionError(value)
for job in [dict(good,files=good['files']*2),dict(good,code='a'*65537),dict(good,files=[{'path':'inputs/a','data':'!!!!'}]),dict(good,command='bash')]:
 try: m.validate_request(job)
 except ValueError: pass
 else: raise AssertionError('invalid request accepted')
`));
test('native runner refuses symbolic and hard links and bounds collected documents',()=>check(`
with tempfile.TemporaryDirectory() as d:
 root=pathlib.Path(d);out=root/'output';out.mkdir();original=root/'original.pdf';original.write_bytes(b'%PDF-1.4')
 link=out/'copy.pdf';link.symlink_to(original)
 try:m.collect_files(out)
 except ValueError:pass
 else:raise AssertionError('symlink accepted')
 link.unlink();os.link(original,link)
 try:m.collect_files(out)
 except ValueError:pass
 else:raise AssertionError('hardlink accepted')
 link.unlink();link.write_bytes(b'x'*(4*1024*1024+1))
 try:m.collect_files(out)
 except ValueError:pass
 else:raise AssertionError('large file accepted')
 link.unlink();(out/'bad.exe').write_bytes(b'x')
 try:m.collect_files(out)
 except ValueError:pass
 else:raise AssertionError('unsupported output accepted')
`));
test('native runner bounds UTF8 logs without changing write return values',()=>check(`
s=m.BoundedLog(16)
assert s.write('🙂'*20)==20
assert len(s.getvalue().encode('utf-8'))<=16
assert s.truncated
for i in range(10000):s.write("ignored")
assert len(s.parts)<=2, "truncated logs retain empty chunks"
`));
