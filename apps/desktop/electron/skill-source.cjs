'use strict';
const {createHash}=require('node:crypto');
const hash=value=>createHash('sha256').update(value).digest('hex');
function validSkillSource(source){return !!source&&typeof source==='object'&&!Array.isArray(source)&&Object.keys(source).every(key=>['catalogId','revision','contentHash'].includes(key))&&typeof source.catalogId==='string'&&source.catalogId.length<=200&&/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_-]+$/.test(source.catalogId)&&typeof source.revision==='string'&&/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(source.revision)&&typeof source.contentHash==='string'&&/^[a-f0-9]{64}$/.test(source.contentHash)}
// Portable content only: native IDs, timestamps and provenance do not affect
// whether the installed instructions, references, or resources were edited.
function skillContentHash(skill){
 const resources=(skill.package?.resources??[]).map(r=>({path:r.path,size:r.size,digest:r.digest??hash(Buffer.from(r.data,'base64'))})).sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
 const files=skill.files.map(f=>({name:f.name,kind:f.kind,mime:f.mime,size:f.size,text:f.text,pages:f.pages??null,resourcePath:f.resourcePath??null}));
 return hash(JSON.stringify({name:skill.name.trim(),description:skill.description,instructions:skill.instructions,frontmatter:skill.package?.frontmatter??null,resources,files}));
}
function skillPackageHash(skill){
 if(!skill.package)return null;
 const resources=skill.package.resources.map(r=>({path:r.path,size:r.size,digest:r.digest??hash(Buffer.from(r.data,'base64'))})).sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
 return hash(JSON.stringify({instructions:skill.instructions,frontmatter:skill.package.frontmatter,resources}));
}
module.exports={validSkillSource,skillContentHash,skillPackageHash};
