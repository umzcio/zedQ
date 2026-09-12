'use strict';
const path=require('node:path'),yaml=require('js-yaml'),yauzl=require('yauzl'),JSZip=require('jszip'),{crc32}=require('node:zlib');
const {parseSkillImport,validateSkillImport,readFrontmatter,MAX_IMPORT_BYTES}=require('./skill-import.cjs');
const {validResourcePath,MAX_PACKAGE_BYTES,MAX_PACKAGE_FILES}=require('./skill-package-schema.cjs');
const key=value=>value.normalize('NFC').toLowerCase();
function entryPath(value){return typeof value==='string'&&value.length>0&&!value.startsWith('/')&&!/[\\:\0]/.test(value)&&Buffer.byteLength(value)<=1024&&value.isWellFormed()&&value.split('/').every(part=>part&&part!=='.'&&part!=='..')}
function readZip(bytes){return new Promise((resolve,reject)=>{
 if(!(bytes instanceof Uint8Array)||bytes.byteLength>MAX_PACKAGE_BYTES){reject(Error('Skill packages can be up to 10 MB.'));return}
 yauzl.fromBuffer(Buffer.from(bytes),{lazyEntries:true,strictFileNames:true,validateEntrySizes:true},(error,archive)=>{
  if(error){reject(Error('This file is not a readable skill ZIP package.'));return}
  let settled=false,total=0,count=0;const entries=[],seen=new Set(),files=new Set();
  const fail=error=>{if(settled)return;settled=true;archive.close();reject(error)};
  archive.on('error',fail);archive.on('end',()=>{if(!settled){settled=true;resolve(entries)}});
  archive.on('entry',entry=>{
   try{
    if(++count>MAX_PACKAGE_FILES)throw Error('Skill packages can contain up to 200 entries.');
    if(entry.generalPurposeBitFlag&0x41)throw Error('Encrypted skill package entries are not supported.');
    const type=(entry.externalFileAttributes>>>16)&0xf000;
    if(type&&type!==0x8000&&type!==0x4000)throw Error('Skill packages cannot contain symbolic links or other non-regular files.');
    const directory=entry.fileName.endsWith('/'),name=directory?entry.fileName.slice(0,-1):entry.fileName;
    if(!entryPath(name))throw Error('Skill package contains an unsafe resource path.');
    const normalized=key(name);if(seen.has(normalized))throw Error('Skill package contains duplicate resource paths.');seen.add(normalized);
    const parts=normalized.split('/');for(let i=1;i<parts.length;i++)if(files.has(parts.slice(0,i).join('/')))throw Error('Skill package contains conflicting file and directory paths.');
    if(!directory){if([...seen].some(existing=>existing.startsWith(normalized+'/')))throw Error('Skill package contains conflicting file and directory paths.');files.add(normalized)}
    if(directory){if(type===0x8000||entry.uncompressedSize)throw Error('Invalid package directory entry.');archive.readEntry();return}
    if(type===0x4000)throw Error('Invalid package file entry.');
    if((total+=entry.uncompressedSize)>MAX_PACKAGE_BYTES)throw Error('Expanded skill packages can be up to 10 MB.');
    if(/(^|\/)skill\.md$/i.test(name)&&entry.uncompressedSize>MAX_IMPORT_BYTES)throw Error('SKILL.md can be up to 1 MB.');
    archive.openReadStream(entry,(error,stream)=>{
     if(error){fail(error);return}const chunks=[];let actual=0;
     stream.on('error',fail);stream.on('data',chunk=>{actual+=chunk.length;if(actual>entry.uncompressedSize||actual>MAX_PACKAGE_BYTES){stream.destroy();fail(Error('Expanded skill packages can be up to 10 MB.'));return}chunks.push(chunk)});
     stream.on('end',()=>{if(settled)return;if(actual!==entry.uncompressedSize){fail(Error('Skill package entry size is invalid.'));return}const content=Buffer.concat(chunks);if(crc32(content)!==entry.crc32){fail(Error('Skill package entry checksum is corrupt.'));return}entries.push({path:name,bytes:content});archive.readEntry()});
    });
   }catch(error){fail(error)}
  });archive.readEntry();
 });
})}
async function parseSkillEntries(entries){
 if(!Array.isArray(entries)||entries.length>MAX_PACKAGE_FILES)throw Error('Skill packages can contain up to 200 entries.');
 const seen=new Set();let total=0;
 for(const entry of entries){if(!entryPath(entry.path)||!(entry.bytes instanceof Uint8Array))throw Error('Skill package contains an unsafe resource path.');if(seen.has(key(entry.path)))throw Error('Skill package contains duplicate resource paths.');seen.add(key(entry.path));total+=entry.bytes.byteLength;if(total>MAX_PACKAGE_BYTES)throw Error('Expanded skill packages can be up to 10 MB.')}
 const rootDocuments=entries.filter(entry=>/^skill\.md$/i.test(entry.path));
 const documents=rootDocuments.length?rootDocuments:entries.filter(entry=>/^[^/]+\/skill\.md$/i.test(entry.path));
 if(documents.length!==1)throw Error('Choose one skill with SKILL.md at the root or in one enclosing folder. Multi-skill and plugin packages must be imported separately.');
 const document=documents[0],parts=document.path.split('/');
 if(parts.length>2)throw Error('SKILL.md must be at the package root or inside one enclosing folder.');
 const prefix=parts.length===2?parts[0]+'/':'';
 if(prefix&&entries.some(entry=>!entry.path.startsWith(prefix)))throw Error('The package contains files outside its enclosing skill folder.');
 const draft=parseSkillImport({name:'SKILL.md',bytes:document.bytes});
 // The archive supplies these files; replace the single-file upload warning.
 draft.warnings=draft.warnings.filter(warning=>!warning.startsWith('Links to other files'));
 const resources=entries.filter(entry=>entry!==document).map(entry=>{const resourcePath=entry.path.slice(prefix.length);if(!validResourcePath(resourcePath))throw Error('Skill package contains an unsafe resource path.');return{path:resourcePath,size:entry.bytes.byteLength,data:Buffer.from(entry.bytes).toString('base64')}});
 draft.package.resources=resources;let contextBytes=Buffer.byteLength(draft.instructions),skipped=0,pdfAttempts=0;
 for(const resource of resources){
  if(draft.files.length>=10||contextBytes>=90000){skipped++;continue}
  const name=resource.path,buffer=Buffer.from(resource.data,'base64');let file;
  if(!/(^|\/)scripts?\//i.test(name)&&/\.(?:md|txt|rst|csv|tsv|json|ya?ml|xml|html?|css)$/i.test(name)){
   try{const body=new TextDecoder('utf-8',{fatal:true}).decode(buffer);if(!/[\x00-\x08\x0b\x0e-\x1f]/.test(body)&&Buffer.byteLength(body)<=100000)file={name,kind:'text',mime:'text/plain',size:buffer.length,text:body,resourcePath:name}}catch{}
  }else if(pdfAttempts<10&&!/(^|\/)scripts?\//i.test(name)&&/\.pdf$/i.test(name)){
   pdfAttempts++;
   try{const result=await require('./chat-attachments.cjs').extractPdf(buffer);if(result.text?.trim()&&Buffer.byteLength(result.text)<=100000)file={name,kind:'pdf',mime:'application/pdf',size:buffer.length,text:result.text,pages:result.pages,resourcePath:name}}catch{}
  }
  if(file&&contextBytes+Buffer.byteLength(file.text)<=90000){draft.files.push(file);contextBytes+=Buffer.byteLength(file.text)}else skipped++;
 }
 if(skipped)draft.warnings.push(`${skipped} package file${skipped===1?' is':'s are'} preserved without automatic chat context. Scripts and assets are never executed on import.`);
 if(Buffer.byteLength(draft.instructions)>=100000&&!draft.warnings.some(warning=>warning.startsWith('These instructions')))draft.warnings.push('These instructions exceed the per-request context limit. Shorten them before enabling this skill in a chat.');
 return{...validateSkillImport(draft),warnings:draft.warnings};
}
async function parseSkillPackage({name,bytes}={}){
 if(typeof name!=='string'||!(/\.(zip|skill)$/i.test(name)))return parseSkillImport({name,bytes});
 return parseSkillEntries(await readZip(bytes));
}
function slug(value){return value.normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,64).replace(/-+$/g,'')||'skill'}
function exportMarkdown(skill,name){
 const raw=skill.package?.frontmatter??'',metadata=readFrontmatter(raw);
 let description=Array.from(skill.description.trim()?skill.description:`${skill.name.trim()||'Reusable'} skill.`).slice(0,1024).join('');while(Buffer.byteLength(description)>4096)description=Array.from(description).slice(0,-1).join('');
 const frontmatter=metadata.name===name&&metadata.description===description?raw:yaml.dump({...metadata,name,description},{schema:yaml.JSON_SCHEMA,noRefs:true,lineWidth:-1,sortKeys:false});
 readFrontmatter(frontmatter);
 const body='---\n'+frontmatter+(frontmatter&&!frontmatter.endsWith('\n')?'\n':'')+'---\n'+skill.instructions;
 if(Buffer.byteLength(body)>MAX_IMPORT_BYTES)throw Error('The exported SKILL.md exceeds 1 MB. Shorten its instructions or metadata.');return Buffer.from(body);
}
async function exportSkillPackage(skill,readResource){
 if(!skill||typeof skill.name!=='string'||typeof skill.description!=='string'||typeof skill.instructions!=='string'||!Array.isArray(skill.files))throw Error('Invalid skill to export.');
 const name=slug(skill.name),document=exportMarkdown(skill,name),entries=new Map();let total=document.length;
 const add=(resourcePath,bytes)=>{if(!validResourcePath(resourcePath)||entries.has(key(resourcePath)))throw Error('Skill package contains duplicate or unsafe resource paths.');if(entries.size>=MAX_PACKAGE_FILES-1)throw Error('Skill packages can contain up to 200 entries.');if(!(bytes instanceof Uint8Array)||(total+=bytes.byteLength)>MAX_PACKAGE_BYTES)throw Error('Skill packages can be up to 10 MB.');entries.set(key(resourcePath),{path:resourcePath,bytes:Buffer.from(bytes)})};
 for(const resource of skill.package?.resources??[]){const bytes=await readResource(resource);if(!(bytes instanceof Uint8Array)||bytes.byteLength!==resource.size)throw Error('A skill resource is missing or changed.');add(resource.path,bytes)}
 for(const file of skill.files){
  if(file.resourcePath&&entries.has(key(file.resourcePath)))continue;
  if(typeof file.text!=='string')throw Error('A skill reference has no extracted text to export.');
  let basename=path.basename(file.name.replace(/\\/g,'/')).replace(/[\x00-\x1f\x7f:]/g,'_')||'reference';if(file.kind==='pdf')basename+='.txt';
  let resourcePath='references/'+basename,index=2;while(entries.has(key(resourcePath))){const extension=path.extname(basename);resourcePath='references/'+basename.slice(0,basename.length-extension.length)+'-'+index+++extension}
  add(resourcePath,Buffer.from(file.text));
 }
 if(!entries.size)return{name:'SKILL.md',mime:'text/markdown',bytes:document};
 const archive=new JSZip();archive.file(name+'/SKILL.md',document,{createFolders:false,unixPermissions:0o100644});for(const resource of entries.values())archive.file(name+'/'+resource.path,resource.bytes,{createFolders:false,unixPermissions:0o100644});
 const bytes=await archive.generateAsync({type:'nodebuffer',compression:'DEFLATE',platform:'UNIX'});if(bytes.length>MAX_PACKAGE_BYTES)throw Error('Skill packages can be up to 10 MB.');return{name:name+'.zip',mime:'application/zip',bytes};
}
module.exports={parseSkillPackage,parseSkillEntries,exportSkillPackage,validResourcePath,MAX_PACKAGE_BYTES,MAX_PACKAGE_FILES};
