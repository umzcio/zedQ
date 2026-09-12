import type {ChatSkill} from '@zq/module-api'
const commandName=(skill:ChatSkill)=>skill.name.trim().toLocaleLowerCase().replace(/[^\p{L}\p{N}_.-]+/gu,'-').replace(/^-+|-+$/g,'')||'skill'
export function skillCommand(skill:ChatSkill,skills:ChatSkill[]=[]){
 const name=commandName(skill),collisions=skills.filter(other=>commandName(other)===name)
 if(collisions.length<2)return '/'+name
 const identity=encodeURIComponent(skill.id);let length=Math.min(6,identity.length)
 while(length<identity.length&&collisions.some(other=>other.id!==skill.id&&encodeURIComponent(other.id).slice(0,length)===identity.slice(0,length)))length++
 return '/'+name+'--'+identity.slice(0,length)
}
export function skillCommandRanges(text:string,skills:ChatSkill[],active:string[]){
 const ranges:{start:number;end:number;id:string;text:string}[]=[]
 for(const skill of skills){if(!active.includes(skill.id))continue;const command=skillCommand(skill,skills),escaped=command.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),pattern=new RegExp('(^|\\s)('+escaped+')(?=\\s|$)','g');for(const match of text.matchAll(pattern)){const start=match.index+match[1].length;ranges.push({start,end:start+command.length,id:skill.id,text:command})}}
 return ranges.sort((a,b)=>a.start-b.start)
}
