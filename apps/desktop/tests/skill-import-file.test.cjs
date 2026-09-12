const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {readSkillFile,readSkillDirectory}=require('../electron/skill-import-file.cjs');
test('skill file reader bounds user-selected regular files and rejects symlinks',t=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'zq-import-file-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const file=path.join(dir,'SKILL.md');fs.writeFileSync(file,'# Writer\nUse short sentences.');assert.equal(readSkillFile(file).toString(),'# Writer\nUse short sentences.');const link=path.join(dir,'link.md');fs.symlinkSync(file,link);assert.throws(()=>readSkillFile(link));assert.throws(()=>readSkillFile(dir));fs.writeFileSync(file,Buffer.alloc(1024*1024+1));assert.throws(()=>readSkillFile(file),/1 MB/)});

test('folder import preserves standard metadata, nested binary files and script bytes',async t=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'zq-skill-folder-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));fs.mkdirSync(path.join(directory,'references'));fs.mkdirSync(path.join(directory,'scripts'));fs.mkdirSync(path.join(directory,'assets'));
 fs.writeFileSync(path.join(directory,'SKILL.md'),'---\nname: folder-skill\ndescription: Read this folder.\nlicense: Apache-2.0\n---\nExact body.\n');fs.writeFileSync(path.join(directory,'references','guide.md'),'Read guide.');fs.writeFileSync(path.join(directory,'scripts','run.py'),'print("never run")');fs.writeFileSync(path.join(directory,'assets','binary'),Buffer.from([0,255,128]));
 const draft=await readSkillDirectory(directory);assert.equal(draft.name,'folder-skill');assert.match(draft.package.frontmatter,/license: Apache-2.0/);assert.equal(draft.package.resources.length,3);assert.deepEqual(Buffer.from(draft.package.resources.find(file=>file.path==='assets/binary').data,'base64'),Buffer.from([0,255,128]));assert.equal(draft.files[0].resourcePath,'references/guide.md');
});

test('folder import rejects symlinked files/directories and excessive entry/byte counts',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'zq-skill-folder-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const folder=path.join(root,'skill'),outside=path.join(root,'outside');fs.mkdirSync(folder);fs.mkdirSync(outside);fs.writeFileSync(path.join(folder,'SKILL.md'),'Body');fs.writeFileSync(path.join(outside,'secret.txt'),'Do not read');
 fs.symlinkSync(outside,path.join(folder,'linked'));await assert.rejects(readSkillDirectory(folder),/link/i);fs.unlinkSync(path.join(folder,'linked'));fs.symlinkSync(path.join(outside,'secret.txt'),path.join(folder,'linked.txt'));await assert.rejects(readSkillDirectory(folder),/link/i);fs.unlinkSync(path.join(folder,'linked.txt'));
 fs.writeFileSync(path.join(folder,'large.bin'),Buffer.alloc(10*1024*1024));await assert.rejects(readSkillDirectory(folder),/10 MB/);fs.unlinkSync(path.join(folder,'large.bin'));for(let i=0;i<200;i++)fs.writeFileSync(path.join(folder,'empty-'+i),'');await assert.rejects(readSkillDirectory(folder),/200/);
});

test('selected ZIP files use the package byte limit while Markdown keeps its own bound',t=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'zq-skill-reader-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));const file=path.join(directory,'skill.zip');fs.writeFileSync(file,Buffer.alloc(2*1024*1024));assert.equal(readSkillFile(file).length,2*1024*1024);fs.writeFileSync(file,Buffer.alloc(10*1024*1024+1));assert.throws(()=>readSkillFile(file),/10 MB/);
});
