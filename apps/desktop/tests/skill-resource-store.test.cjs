const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {SkillResourceStore}=require('../electron/skill-resource-store.cjs');
const {validSkillPackage}=require('../electron/skill-package-schema.cjs');
const candidate=()=>({frontmatter:'name: writer\ndescription: Write clearly',resources:[{path:'assets/template.bin',size:3,data:Buffer.from([0,1,255]).toString('base64')}]});
function fixture(t){const directory=fs.mkdtempSync(path.join(os.tmpdir(),'zq-skill-resources-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));return {directory,store:new SkillResourceStore(path.join(directory,'resources'))}}
test('immutable resources retain bytes across restart and rollback preserves shared data',t=>{const{directory,store}=fixture(t),first=store.stage(candidate()),second=store.stage(candidate());assert(validSkillPackage(first.package));assert.equal(second.created.length,0);second.rollback();assert.deepEqual(new SkillResourceStore(path.join(directory,'resources')).read(first.package.resources[0]),Buffer.from([0,1,255]));assert.equal(fs.readdirSync(path.join(directory,'resources')).length,1);first.rollback();assert.equal(fs.readdirSync(path.join(directory,'resources')).length,0)});
test('resource schema rejects escapes, duplicates, mismatched bytes and malformed hashes',()=>{for(const patch of [{path:'../bad'},{path:'/bad'},{path:'a\\b'},{path:'SKILL.md'},{data:'abc='},{size:4}]){const p=candidate();Object.assign(p.resources[0],patch);assert.equal(validSkillPackage(p,{incoming:true}),false)}const p=candidate();p.resources.push({...p.resources[0],path:'ASSETS/template.bin'});assert.equal(validSkillPackage(p,{incoming:true}),false)});
test('resource reads reject corruption, symlinks, and unchecked metadata',t=>{const {store}=fixture(t),staged=store.stage(candidate()),r=staged.package.resources[0];assert.throws(()=>store.read({...r,digest:'../../secret'}));const file=path.join(store.directory,r.digest);fs.writeFileSync(file,'bad');assert.throws(()=>store.read(r),/damaged/);fs.unlinkSync(file);fs.symlinkSync('/etc/hosts',file);assert.throws(()=>store.read(r))});
test('resource and parent directory flush failures prevent staging and remove new blobs',t=>{
 for(const failParent of [false,true]){
  const {directory,store}=fixture(t),sync=fs.fsyncSync;store.ensure();const target=fs.statSync(failParent?directory:store.directory);
  try{fs.fsyncSync=fd=>{const stat=fs.fstatSync(fd);if(stat.isDirectory()&&stat.dev===target.dev&&stat.ino===target.ino)throw Error('Injected resource directory flush failure');return sync(fd)};assert.throws(()=>store.stage(candidate()),/resource directory flush failure/)}finally{fs.fsyncSync=sync}
  assert.deepEqual(fs.readdirSync(store.directory),[]);
 }
});
