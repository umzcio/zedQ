const {test}=require('node:test'),assert=require('node:assert/strict');
const JSZip=require('jszip'),{createHash}=require('node:crypto');
const {parseSkillPackage,exportSkillPackage,validResourcePath}=require('../electron/skill-package.cjs');
const {parseSkillImport}=require('../electron/skill-import.cjs');
const frontmatter='name: careful-review\ndescription: Review code carefully.\nlicense: MIT\ncompatibility: Requires Python 3.\nmetadata:\n  author: Example\n  version: "2"\nallowed-tools: Read Bash(python:*)\n';
const markdown='---\n'+frontmatter+'---\n# Review\n\nKeep exact spacing.  \n';
async function zip(entries,options={}){const archive=new JSZip();for(const [name,value] of Object.entries(entries))archive.file(name,value,{createFolders:false});return archive.generateAsync({type:'nodebuffer',compression:'DEFLATE',...options})}
function stored(draft){return{...draft,id:'skill',createdAt:1,updatedAt:1,package:{...draft.package,resources:draft.package.resources.map(resource=>({path:resource.path,size:resource.size,digest:createHash('sha256').update(Buffer.from(resource.data,'base64')).digest('hex')}))}}}

test('standard ZIP round trip preserves resource bytes, relative paths, metadata and exact body',async()=>{
 const binary=Buffer.from([0,255,128,13,10]),script=Buffer.from('#!/bin/sh\nprintf dangerous\n');
 const original={'careful-review/SKILL.md':markdown,'careful-review/references/中文.md':'# Unicode reference\n','careful-review/assets/image.bin':binary,'careful-review/scripts/run.sh':script};
 const draft=await parseSkillPackage({name:'package.skill',bytes:await zip(original)});assert.equal(draft.package.frontmatter,frontmatter);assert.equal(draft.instructions,'# Review\n\nKeep exact spacing.  \n');assert.deepEqual(draft.files.map(file=>file.resourcePath),['references/中文.md']);assert.ok(draft.warnings.some(w=>/script|execut/i.test(w)));
 const exported=await exportSkillPackage(stored(draft),resource=>Buffer.from(draft.package.resources.find(file=>file.path===resource.path).data,'base64'));assert.equal(exported.name,'careful-review.zip');assert.equal(exported.mime,'application/zip');
 const archive=await JSZip.loadAsync(exported.bytes);for(const [name,value] of Object.entries(original))assert.deepEqual(await archive.file(name).async('nodebuffer'),Buffer.from(value));
 const again=await parseSkillPackage({name:exported.name,bytes:exported.bytes});assert.deepEqual(again.package,draft.package);
});

test('plain Markdown retains standard metadata and exports as SKILL.md; edited labels remain interoperable',async()=>{
 const draft=parseSkillImport({name:'SKILL.md',bytes:Buffer.from(markdown)});assert.equal(draft.package.frontmatter,frontmatter);assert.deepEqual(draft.package.resources,[]);
 const unchanged=await exportSkillPackage(stored(draft),()=>{throw Error('No resources expected')});assert.equal(unchanged.name,'SKILL.md');assert.equal(unchanged.bytes.toString(),markdown);
 const changed=await exportSkillPackage({...stored(draft),name:'A Fancy Local Name!',description:''},()=>{});const parsed=parseSkillImport({name:changed.name,bytes:changed.bytes});assert.equal(parsed.name,'a-fancy-local-name');assert.ok(parsed.description.trim());assert.match(parsed.package.frontmatter,/license: MIT/);assert.match(parsed.package.frontmatter,/author: Example/);assert.equal(parsed.instructions,draft.instructions);
});

test('extracted-only PDFs export honest text files and never overwrite preserved resources',async()=>{
 const draft=await parseSkillPackage({name:'a.zip',bytes:await zip({'SKILL.md':markdown,'references/report.pdf.txt':'original'})});
 const skill={...stored(draft),files:[{id:'old',name:'report.pdf',kind:'pdf',mime:'application/pdf',size:900,pages:1,text:'Extracted report',preview:''}]};
 const output=await exportSkillPackage(skill,r=>Buffer.from(draft.package.resources.find(file=>file.path===r.path).data,'base64')),archive=await JSZip.loadAsync(output.bytes);
 assert.equal(await archive.file('careful-review/references/report.pdf.txt').async('string'),'original');const generated=Object.keys(archive.files).filter(name=>name.endsWith('.txt')&&name!=='careful-review/references/report.pdf.txt');assert.equal(generated.length,1);assert.equal(await archive.file(generated[0]).async('string'),'Extracted report');
});

test('unsafe, duplicate and multi-skill archive paths fail without extraction',async()=>{
 for(const entries of [ {'../escape':'x','SKILL.md':markdown},{'/absolute':'x','SKILL.md':markdown},{'a\\b':'x','SKILL.md':markdown},{'SKILL.md':markdown,'File.txt':'a','file.txt':'b'},{'SKILL.md':markdown,'é.txt':'a','e\u0301.txt':'b'},{'one/SKILL.md':markdown,'two/SKILL.md':markdown},{'one/two/SKILL.md':markdown},{'wrapper/SKILL.md':markdown,'outside.txt':'x'},{'README.md':'No skill'} ])await assert.rejects(parseSkillPackage({name:'test.zip',bytes:await zip(entries)}));
 for(const name of ['../x','/x','a\\b','a/../b','C:x','a//b','SKILL.md'])assert.equal(validResourcePath(name),false);assert.equal(validResourcePath('references/中文.md'),true);
 const symbolic=new JSZip();symbolic.file('SKILL.md',markdown);symbolic.file('link','../outside',{unixPermissions:0o120777});await assert.rejects(parseSkillPackage({name:'symbolic.zip',bytes:await symbolic.generateAsync({type:'nodebuffer',platform:'UNIX'})}),/link|regular/i);
 const encrypted=await zip({'SKILL.md':markdown});for(let i=0;i<encrypted.length-10;i++){const signature=encrypted.readUInt32LE(i);if(signature===0x04034b50)encrypted.writeUInt16LE(encrypted.readUInt16LE(i+6)|1,i+6);if(signature===0x02014b50)encrypted.writeUInt16LE(encrypted.readUInt16LE(i+8)|1,i+8)}await assert.rejects(parseSkillPackage({name:'encrypted.zip',bytes:encrypted}),/encrypt/i);
});

test('archive byte, entry, text and metadata complexity limits reject bounded inputs',async()=>{
 await assert.rejects(parseSkillPackage({name:'large.zip',bytes:Buffer.alloc(10*1024*1024+1)}),/10 MB/);
 await assert.rejects(parseSkillPackage({name:'bomb.zip',bytes:await zip({'SKILL.md':markdown,'large.bin':Buffer.alloc(10*1024*1024)})}),/10 MB/);
 const entries={'SKILL.md':markdown};for(let i=0;i<200;i++)entries['empty-'+i]='';await assert.rejects(parseSkillPackage({name:'many.zip',bytes:await zip(entries)}),/200/);
 await assert.rejects(parseSkillPackage({name:'bad.zip',bytes:await zip({'SKILL.md':Buffer.from([0xff])})}),/UTF-8/);
 for(const value of ['metadata: &a\n  cycle: *a\n','metadata: '+ '['.repeat(30)+'a'+']'.repeat(30)+'\n','name: first\nname: second\n'])assert.throws(()=>parseSkillImport({name:'SKILL.md',bytes:Buffer.from('---\n'+value+'---\nBody')}),/YAML|metadata/i);
});

test('auto-selected references stay request-sized and scripts remain package resources',async()=>{
 const entries={'SKILL.md':markdown,'scripts/task.py':'print("do not execute")'};for(let i=0;i<12;i++)entries['references/'+i+'.txt']='x'.repeat(10000);
 const draft=await parseSkillPackage({name:'bounded.zip',bytes:await zip(entries)});assert.ok(draft.files.length<=10);assert.ok(draft.files.reduce((sum,file)=>sum+Buffer.byteLength(file.text),Buffer.byteLength(draft.instructions))<100000);assert.equal(draft.package.resources.length,13);assert.equal(draft.files.some(file=>file.resourcePath==='scripts/task.py'),false);
});

test('corrupted resource bytes fail checksum verification instead of silently changing the package',async()=>{
 const bytes=await zip({'SKILL.md':markdown,'reference.txt':'RESOURCE_CONTENT_MARKER'},{compression:'STORE'}),offset=bytes.indexOf(Buffer.from('RESOURCE_CONTENT_MARKER'));assert.ok(offset>=0);bytes[offset]^=1;await assert.rejects(parseSkillPackage({name:'corrupt.zip',bytes}),/checksum|corrupt/i);
});

test('a local reference named SKILL.md exports as a reference without creating a second skill',async()=>{
 const draft=parseSkillImport({name:'SKILL.md',bytes:Buffer.from(markdown)}),skill={...stored(draft),files:[{id:'file',name:'SKILL.md',kind:'text',mime:'text/plain',size:12,text:'Another text',preview:''}]};
 const exported=await exportSkillPackage(skill,()=>{}),again=await parseSkillPackage({name:exported.name,bytes:exported.bytes});assert.equal(again.name,'careful-review');assert.equal(again.files[0].text,'Another text');
});

test('aliased YAML scalars cannot expand metadata beyond its bounded size',()=>{
 const source='---\nname: small-skill\ndescription: Bounded metadata.\nmetadata:\n  blob: &blob '+ 'x'.repeat(20000)+'\n  repeated: [*blob, *blob, *blob, *blob]\n---\nBody';assert.throws(()=>parseSkillImport({name:'SKILL.md',bytes:Buffer.from(source)}),/metadata|complex/i);
});

test('literal descriptions and commented unknown YAML retain their original source on unchanged export',async()=>{
 const source='---\nname: literal-description\ndescription: |\n  First line\n  Second line\n# Keep this licensing note.\nlicense: MIT\n---\nExact body\n',draft=parseSkillImport({name:'SKILL.md',bytes:Buffer.from(source)});const output=await exportSkillPackage(stored(draft),()=>{});assert.equal(output.bytes.toString(),source);
});
