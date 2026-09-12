'use strict';
const {skillContentHash,skillPackageHash,validSkillSource}=require('./skill-source.cjs');
const {randomUUID}=require('node:crypto');
const {validSkill,MAX_SKILLS}=require('./skill-schema.cjs');
function findSkill(state,id){const skill=state.skills?.find(skill=>skill.id===id);if(!skill)throw Error('Skill not found.');return skill}
function validate(skill){if(!validSkill(skill))throw Error('Skills need a name up to 256 bytes, description up to 4 KB, instructions up to 1 MB, and at most 10 active text/PDF references with 2 MB total stored text.')}
function duplicateName(name){let value=name;while(Buffer.byteLength(value+' copy')>256)value=Array.from(value).slice(0,-1).join('');return value+' copy'}
const methods={
 importSkill(input){
  const portable=require('./skill-import.cjs').validateSkillImport(input);
  let staged;
  try{return this.change(state=>{
   state.skills??=[];if(portable.source&&state.skills.some(skill=>skill.source?.catalogId===portable.source.catalogId))throw Error('This catalog skill is already installed. Open Browse to review updates.');if(state.skills.length>=MAX_SKILLS)throw Error('The Skills library holds up to 100 skills.');
   if(portable.package)staged=this.skillResources.stage(portable.package);
   const now=Date.now(),skill={...portable,...(staged?{package:staged.package}:{}),name:portable.name.trim(),id:randomUUID(),createdAt:now,updatedAt:now,files:portable.files.map(file=>({...file,id:randomUUID(),preview:''}))};
   validate(skill);state.skills.push(skill);return skill;
  })}catch(e){if(!e.committed)staged?.rollback();throw e}
 },
 reconcileSkillSources(receipts=require('./skill-catalog-receipts.json')){
  const sources=new Set((this.state.skills??[]).flatMap(skill=>skill.source?[skill.source.catalogId]:[])),matches=[];
  for(const receipt of receipts){
   if(!validSkillSource(receipt.source)||sources.has(receipt.source.catalogId))continue;
   const candidates=(this.state.skills??[]).filter(skill=>!skill.source&&!skill.sourceDetached&&skillPackageHash(skill)===receipt.packageHash);
   if(candidates.length!==1)continue;
   matches.push({id:candidates[0].id,source:receipt.source});sources.add(receipt.source.catalogId);
  }
  if(!matches.length)return null;
  return this.change(state=>{for(const match of matches)findSkill(state,match.id).source=structuredClone(match.source);return null});
 },
 prepareSkillUpdate(id){
  const skill=findSkill(this.state,id);if(!skill.source)throw Error('This skill has no tracked catalog source.');
  const expectedHash=skillContentHash(skill);
  return {id,catalogId:skill.source.catalogId,name:skill.name,expectedHash,modified:expectedHash!==skill.source.contentHash};
 },
 updateCatalogSkill({id,expectedHash,candidate}={}){
  const portable=require('./skill-import.cjs').validateSkillImport(candidate);let staged;
  try{return this.change(state=>{
   const current=findSkill(state,id);
   if(!current.source||!portable.source||current.source.catalogId!==portable.source.catalogId)throw Error('The update must come from this skill’s tracked catalog source.');
   if(typeof expectedHash!=='string'||expectedHash!==skillContentHash(current))throw Error('This skill changed while the update was open. Close this preview and review the update again.');
   if(portable.package)staged=this.skillResources.stage(portable.package);
   const updated={...portable,...(staged?{package:staged.package}:{}),id:current.id,createdAt:current.createdAt,updatedAt:Date.now(),name:portable.name.trim(),files:portable.files.map(file=>({...file,id:randomUUID(),preview:''}))};
   validate(updated);state.skills[state.skills.indexOf(current)]=updated;return updated;
  })}catch(e){if(!e.committed)staged?.rollback();throw e}
 },
 skillResource({id,path}={}){const skill=findSkill(this.state,id),resource=skill.package?.resources.find(file=>file.path===path);if(!resource)throw Error('Skill package file not found.');return {name:resource.path,bytes:this.skillResources.read(resource)}},
 previewSkillResource(input){const {name,bytes}=this.skillResource(input);let text;try{const value=new TextDecoder('utf-8',{fatal:true}).decode(bytes);if(!/[\x00-\x08\x0b\x0e-\x1f]/.test(value))text=value.length>1000000?value.slice(0,1000000)+'\n\n[Preview shortened. Save the file to view its full contents.]':value}catch{}return{name,size:bytes.length,...(text===undefined?{}:{text})}},
 exportSkillPackage(id){return require('./skill-package.cjs').exportSkillPackage(findSkill(this.state,id),resource=>this.skillResources.read(resource))},
 saveSkill(input={}){
  if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(key=>!['id','name','description','instructions'].includes(key)))throw Error('Invalid skill changes.');
  return this.change(state=>{
   state.skills??=[];const old=input.id===undefined?null:findSkill(state,input.id);
   if(!old&&state.skills.length>=MAX_SKILLS)throw Error('The Skills library holds up to 100 skills.');
   const now=Date.now(),skill=old??{id:randomUUID(),name:'',description:'',instructions:'',files:[],createdAt:now,updatedAt:now};
   for(const key of ['name','description','instructions'])if(input[key]!==undefined)skill[key]=input[key];
   validate(skill);skill.name=skill.name.trim();skill.updatedAt=now;if(!old)state.skills.push(skill);return skill;
  });
 },
 duplicateSkill(id){return this.change(state=>{
  const original=findSkill(state,id);if(state.skills.length>=MAX_SKILLS)throw Error('The Skills library holds up to 100 skills.');
  const now=Date.now(),copy={...structuredClone(original),id:randomUUID(),name:duplicateName(original.name),createdAt:now,updatedAt:now};
  delete copy.source;copy.sourceDetached=true;copy.files=copy.files.map(file=>({...file,id:randomUUID()}));validate(copy);state.skills.push(copy);return copy;
 })},
 deleteSkill(id){return this.change(state=>{
  findSkill(state,id);state.skills=state.skills.filter(skill=>skill.id!==id);
  for(const owner of [...(state.projects??[]),...(state.conversations??[]),...Object.values(state.drafts??{})])if(Array.isArray(owner.skillIds))owner.skillIds=owner.skillIds.filter(value=>value!==id);
  // Sent snapshots, including preserved branches, deliberately outlive the library entry.
  return null;
 })},
 addSkillFiles({id,attachmentIds}={}){
  const files=this.attachments.resolve(attachmentIds);
  const result=this.change(state=>{
   const skill=findSkill(state,id);skill.files.push(...files.filter(file=>!skill.files.some(existing=>existing.id===file.id)));validate(skill);skill.updatedAt=Date.now();return null;
  });
  // Retain prepared files if validation or durable storage fails.
  for(const file of files)this.attachments.discard(file.id);return result;
 },
 removeSkillFile({id,attachmentId}={}){return this.change(state=>{
  const skill=findSkill(state,id);if(!skill.files.some(file=>file.id===attachmentId))throw Error('Skill reference not found.');skill.files=skill.files.filter(file=>file.id!==attachmentId);skill.updatedAt=Date.now();return null;
 })},

};
module.exports=methods;
