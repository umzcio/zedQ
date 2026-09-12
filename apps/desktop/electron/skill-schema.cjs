'use strict';
const {validSkillPackage,validResourcePath}=require('./skill-package-schema.cjs');
const {validSkillSource}=require('./skill-source.cjs');
const {isAttachment,publicAttachment}=require('./attachment-schema.cjs');
const MAX_SKILLS=100,MAX_SKILL_FILES=10,MAX_SKILL_CONTEXT=2000000,MAX_SKILL_INSTRUCTIONS=1000000;
const text=(value,max)=>typeof value==='string'&&Buffer.byteLength(value)<=max&&!value.includes('\0')&&value.isWellFormed();
const id=value=>text(value,256)&&value.length>0;
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const stamp=value=>Number.isFinite(value)&&value>=0;
function validSkillIds(ids,{nullable=false}={}){
 return ids===undefined||nullable&&ids===null||Array.isArray(ids)&&ids.length<=10&&ids.every(id)&&new Set(ids).size===ids.length;
}
function validSkill(skill){
 return Boolean(object(skill)&&Object.keys(skill).every(key=>['id','name','description','instructions','files','createdAt','updatedAt','package','source','sourceDetached'].includes(key))&&id(skill.id)&&text(skill.name,256)&&skill.name.trim()&&text(skill.description,4096)&&text(skill.instructions,MAX_SKILL_INSTRUCTIONS)&&(skill.package===undefined||validSkillPackage(skill.package))&&(skill.sourceDetached===undefined||typeof skill.sourceDetached==='boolean')&&(skill.source===undefined||validSkillSource(skill.source))&&stamp(skill.createdAt)&&stamp(skill.updatedAt)&&Array.isArray(skill.files)&&skill.files.length<=MAX_SKILL_FILES&&skill.files.every(file=>isAttachment(file)&&(file.resourcePath===undefined||validResourcePath(file.resourcePath))&&['text','pdf'].includes(file.kind)&&Object.keys(file).every(key=>['id','name','kind','mime','size','preview','text','pages','width','height','resourcePath'].includes(key)))&&new Set(skill.files.map(file=>file.id)).size===skill.files.length&&Buffer.byteLength(skill.instructions)+skill.files.reduce((total,file)=>total+Buffer.byteLength(file.text),0)<=MAX_SKILL_CONTEXT);
}
function validSkills(skills,{max=MAX_SKILLS}={}){
 return Array.isArray(skills)&&skills.length<=max&&skills.every(validSkill)&&new Set(skills.map(skill=>skill.id)).size===skills.length;
}
function publicSkill(skill){
 return{...(skill.source?{source:structuredClone(skill.source)}:{}),...(skill.package?{package:structuredClone(skill.package)}:{}),id:skill.id,name:skill.name,description:skill.description,instructions:skill.instructions,files:skill.files.map(publicAttachment),createdAt:skill.createdAt,updatedAt:skill.updatedAt};
}
module.exports={validSkill,validSkills,validSkillIds,publicSkill,MAX_SKILLS,MAX_SKILL_FILES,MAX_SKILL_CONTEXT,MAX_SKILL_INSTRUCTIONS};
