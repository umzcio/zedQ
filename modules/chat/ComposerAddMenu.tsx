import { useRef, useState } from 'react'
import type { ChatSkill } from '@zq/module-api'
import { Plus, UploadSimple, NotePencil, Info, Scroll, CaretRight, Check, GearSix, MagnifyingGlass } from '@phosphor-icons/react'
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuSub, DropdownMenuSubTrigger, DropdownMenuSubContent } from '@zq/ui'
import { SkillMenus, type SkillAction } from './SkillActions'
type Props = { skills: ChatSkill[]; selected: string[] | null; inherited: string[]; inheritedConfigured?: boolean; disabled: boolean; skillDisabled: boolean; open: boolean; onOpenChange: (open: boolean) => void; onChange: (ids: string[] | null) => void; onUpload: () => void; onNotes: () => void; onContext: () => void; onManage: () => void; onBrowse: () => void; approvalMode?: 'auto'|'ask'; approvalDisabled?: boolean; onApprovalMode?: (mode:'auto'|'ask')=>void; onSkillAction: (action: SkillAction, skill: ChatSkill) => void }
export default function ComposerAddMenu({ skills, selected, inherited, inheritedConfigured = inherited.length > 0, disabled, skillDisabled, open, onOpenChange, onChange, onUpload, onNotes, onContext, onManage, onBrowse, onSkillAction, approvalMode, approvalDisabled, onApprovalMode }: Props) {
 const opening = useRef(false), [subOpen, setSubOpen] = useState(false)
 const defaultLabel = inheritedConfigured ? 'Use project skills' : 'Automatic'
 const defaultDescription = inheritedConfigured ? (inherited.length ? `${inherited.length} enabled by this project` : 'No skills enabled by this project') : 'Choose relevant installed skills for each message'
 const active = (selected ?? inherited).filter(id => skills.some(skill => skill.id === id))
 function choose(run: () => void, dialog = false) { opening.current = dialog; onOpenChange(false); run() }
 function toggle(id: string) { if (skillDisabled) return; onChange(active.includes(id) ? active.filter(value => value !== id) : active.length < 10 ? [...active, id] : active) }
 return <DropdownMenu open={open && !disabled} onOpenChange={value => { onOpenChange(value); if (!value) setSubOpen(false) }}><DropdownMenuTrigger asChild><button type="button" className="chat-attach" aria-label={open ? 'Close attachments menu' : 'Add attachments'} title="Add attachments and skills" disabled={disabled}><Plus size={21}/></button></DropdownMenuTrigger><DropdownMenuContent side="top" align="start" className="composer-add-menu" aria-label="Add attachments and skills" onCloseAutoFocus={event => { if (opening.current) { event.preventDefault(); opening.current = false } }}>
  <DropdownMenuItem onSelect={() => choose(onUpload)}><UploadSimple size={17}/><span>Upload files<small>Images, PDFs, text &amp; code</small></span></DropdownMenuItem>
  <DropdownMenuItem onSelect={() => choose(onNotes, true)}><NotePencil size={17}/>Add from Notes</DropdownMenuItem>
  <DropdownMenuSub open={subOpen} onOpenChange={setSubOpen}><DropdownMenuSubTrigger className="composer-skills-subtrigger" disabled={skillDisabled}><Scroll size={17}/><span>Skills</span>{active.length > 0 && <small>{active.length} enabled</small>}<CaretRight size={13}/></DropdownMenuSubTrigger><DropdownMenuSubContent className="composer-skills-submenu" aria-label="Choose skills">
   <DropdownMenuItem role="menuitemcheckbox" aria-checked={selected === null} disabled={skillDisabled} onSelect={event => { event.preventDefault(); onChange(selected === null ? [...active] : null) }}><span className="composer-skill-check">{selected === null && <Check size={14}/>}</span><span>{defaultLabel}<small>{defaultDescription}</small></span></DropdownMenuItem>
   <DropdownMenuSeparator/>
   <div className="composer-skills-list">{skills.map(skill => <SkillMenus key={skill.id} skill={skill} disabled={skillDisabled} onAction={(action, target) => choose(() => onSkillAction(action, target), true)}><DropdownMenuItem role="menuitemcheckbox" aria-checked={active.includes(skill.id)} disabled={skillDisabled || active.length >= 10 && !active.includes(skill.id)} onSelect={event => { event.preventDefault(); toggle(skill.id) }} className="composer-skill-option"><span className="composer-skill-check">{active.includes(skill.id) ? <Check size={14}/> : <Scroll size={15}/>}</span><span>{skill.name}{selected === null && active.includes(skill.id) && <small>From project</small>}</span></DropdownMenuItem></SkillMenus>)}</div>
   {!skills.length && <p className="skill-help composer-skills-empty">No installed skills yet.</p>}
   {active.length >= 10 && <p className="skill-help composer-skills-empty">Turn off a skill to enable another.</p>}
   <DropdownMenuSeparator/>
   <DropdownMenuItem disabled={skillDisabled} onSelect={event => { event.preventDefault(); onChange([]) }}>No skills</DropdownMenuItem>
   <DropdownMenuItem onSelect={() => choose(onManage, true)}><GearSix size={15}/>Manage skills</DropdownMenuItem>
   <DropdownMenuItem onSelect={() => choose(onBrowse, true)}><MagnifyingGlass size={15}/>Browse skills</DropdownMenuItem>
  </DropdownMenuSubContent></DropdownMenuSub>
  {onApprovalMode&&<DropdownMenuItem role="menuitemcheckbox" aria-checked={approvalMode==='ask'} disabled={approvalDisabled} onSelect={event=>{event.preventDefault();onApprovalMode(approvalMode==='ask'?'auto':'ask')}}><span className="composer-skill-check">{approvalMode==='ask'&&<Check size={14}/>}</span>Ask before tool actions</DropdownMenuItem>}
  <DropdownMenuItem onSelect={() => choose(onContext, true)}><Info size={17}/>View context</DropdownMenuItem>
  <p className="skill-help composer-skills-empty">Drop files here or paste screenshots with ⌘V.</p>
 </DropdownMenuContent></DropdownMenu>
}
