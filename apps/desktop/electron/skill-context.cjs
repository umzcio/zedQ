'use strict';
const {validSkillIds}=require('./skill-schema.cjs');
function resolveSkills(state,selection,project){
 if(!validSkillIds(selection,{nullable:true}))throw Error('Select up to ten unique skills.');
 const ids=selection??project?.skillIds??[];
 return ids.map(id=>{const skill=(state.skills??[]).find(s=>s.id===id);if(!skill)throw Error('A selected skill is no longer available. Choose your skills again.');return structuredClone(skill)});
}
const skillReferences=skills=>(skills??[]).flatMap(skill=>skill.files.map(f=>({name:`${skill.name} / ${f.name}`,text:f.text??''})));
const skillInstructions=skills=>(skills??[]).map(s=>`Skill: ${s.name}\n${s.instructions}${s.package?.resources.length?"\n\nThis skill includes packaged resources. Only its attached reference text is available in this request. Loaded instructions can guide the fixed document tools when available. Importing this package does not grant new tools, executable access or missing dependencies; do not claim to run its scripts or open its binary assets. Explain unsupported requirements.":""}`).join('\n\n');
const skillBytes=skills=>skills?.length?Buffer.byteLength(skillInstructions(skills))+Buffer.byteLength(JSON.stringify(skillReferences(skills))):0;
module.exports={resolveSkills,skillReferences,skillInstructions,skillBytes};
