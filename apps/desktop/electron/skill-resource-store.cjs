'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {validSkillPackage,MAX_PACKAGE_BYTES}=require('./skill-package-schema.cjs');
class SkillResourceStore{
 constructor(directory){this.directory=directory}
 ensure(){fs.mkdirSync(this.directory,{recursive:true,mode:0o700});const stat=fs.lstatSync(this.directory);if(!stat.isDirectory()||stat.isSymbolicLink())throw Error('Skill resource storage is unavailable.')}
 read(resource){
  if(!validSkillPackage({frontmatter:'',resources:[resource]}))throw Error('Invalid skill resource.');this.ensure();
  const fd=fs.openSync(path.join(this.directory,resource.digest),fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
  try{const stat=fs.fstatSync(fd);if(!stat.isFile()||stat.size!==resource.size||stat.size>MAX_PACKAGE_BYTES)throw Error('The skill resource is damaged. Import the package again.');const bytes=Buffer.alloc(stat.size);let offset=0;while(offset<bytes.length){const count=fs.readSync(fd,bytes,offset,bytes.length-offset,null);if(!count)throw Error('The skill resource is damaged. Import the package again.');offset+=count}if(crypto.createHash('sha256').update(bytes).digest('hex')!==resource.digest)throw Error('The skill resource is damaged. Import the package again.');return bytes}finally{fs.closeSync(fd)}
 }
 stage(input){
  if(!validSkillPackage(input,{incoming:true}))throw Error('Invalid skill package resources.');this.ensure();const created=[],resources=[];
  const rollback=()=>{for(const digest of created){try{fs.unlinkSync(path.join(this.directory,digest))}catch(e){if(e.code!=='ENOENT')throw e}}};
  try{for(const source of input.resources){const bytes=Buffer.from(source.data,'base64'),digest=crypto.createHash('sha256').update(bytes).digest('hex'),resource={path:source.path,size:bytes.length,digest},destination=path.join(this.directory,digest);
   if(fs.existsSync(destination)){this.read(resource);resources.push(resource);continue}
   const temporary=path.join(this.directory,`.${crypto.randomUUID()}.tmp`);let fd;
   try{fd=fs.openSync(temporary,'wx',0o600);fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);fs.closeSync(fd);fd=undefined;try{fs.linkSync(temporary,destination);created.push(digest)}catch(e){if(e.code!=='EEXIST')throw e;this.read(resource)}}finally{if(fd!==undefined)fs.closeSync(fd);try{fs.unlinkSync(temporary)}catch(e){if(e.code!=='ENOENT')throw e}}
   resources.push(resource);
  }
  // Persist the blob names and the resource directory itself before chat.json
  // can durably reference them. A failed flush is still safe to roll back.
  for(const directory of [this.directory,path.dirname(this.directory)]){const fd=fs.openSync(directory,'r');try{fs.fsyncSync(fd)}finally{fs.closeSync(fd)}}
  return {package:{frontmatter:input.frontmatter,resources},created,rollback}}catch(e){rollback();throw e}
 }
}
module.exports={SkillResourceStore};
