import {useHost,unwrap,type ChatSkillUsage} from '@zq/module-api'
import {CaretRight,Scroll} from '@phosphor-icons/react'
import {Button,Collapsible,CollapsibleContent,CollapsibleTrigger,ContextMenu,ContextMenuContent,ContextMenuItem,ContextMenuTrigger} from '@zq/ui'
import './skill-activity.css'

export default function ChatSkillActivity({skills,closing}:{skills?:ChatSkillUsage[];closing:boolean}){
 const {services,notify}=useHost()
 async function copy(text:string,label:string){if(closing)return;try{await unwrap(services.clipboard.writeText(text));notify(`${label} copied`)}catch{notify(`Couldn’t copy ${label.toLowerCase()}. Try selecting the text.`)}}
 return <>{skills?.map(skill=>{
  const source=skill.source==='automatic'?'Selected automatically':'From your selection'
  const resources='Package resources are preserved. Loaded instructions can guide supported document tools; packaged scripts are not executed and missing dependencies are not installed.'
  const details=[skill.name,skill.description,'Instructions loaded',source,...(skill.referenceNames.length?[`References: ${skill.referenceNames.join(', ')}`]:[]),...(skill.hasResources?[resources]:[])].filter(Boolean).join('\n')
  const actions=[{label:'Copy skill name',text:skill.name,notice:'Skill name'},{label:'Copy details',text:details,notice:'Skill details'}]
  return <ContextMenu key={skill.id}><ContextMenuTrigger asChild><section className="chat-skill-activity"><Collapsible>
   <CollapsibleTrigger tooltip={`Show or hide how ${skill.name} was used in this response`} className="chat-tool-summary" disabled={closing}><Scroll size={15}/><span>Using {skill.name}</span><CaretRight size={12} className="chat-tool-caret"/></CollapsibleTrigger>
   <CollapsibleContent><div className="chat-skill-details"><p>Instructions loaded</p><p>{source}</p>{skill.description&&<p>{skill.description}</p>}{skill.referenceNames.length>0&&<p>References: {skill.referenceNames.map((name,index)=><span key={`${index}-${name}`}>{index>0?', ':''}<span>{name}</span></span>)}</p>}{skill.hasResources&&<p>{resources}</p>}<div className="chat-skill-actions">{actions.map(action=><Button key={action.label} type="button" variant="ghost" size="sm" disabled={closing} onClick={()=>void copy(action.text,action.notice)}>{action.label}</Button>)}</div></div></CollapsibleContent>
  </Collapsible></section></ContextMenuTrigger><ContextMenuContent aria-label={`Skill usage actions for ${skill.name}`}>{actions.map(action=><ContextMenuItem key={action.label} disabled={closing} onSelect={()=>void copy(action.text,action.notice)}>{action.label}</ContextMenuItem>)}</ContextMenuContent></ContextMenu>
 })}</>
}
