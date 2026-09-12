import { useRef, useState } from 'react'
import type { ChatSkill } from '@zq/module-api'
import { Scroll, CaretDown, MagnifyingGlass, GearSix } from '@phosphor-icons/react'
import { Button, Checkbox, Input, Popover, PopoverContent, PopoverTrigger } from '@zq/ui'
import { SkillMenus, useSkillActions } from './SkillActions'
import './skills.css'
import {requestSkillSettingsPage} from './skills-navigation'

export type SkillPickerProps = { skills: ChatSkill[]; selected: string[] | null; inherited: string[]; inheritedConfigured?: boolean; onChange: (ids: string[] | null) => void; disabled: boolean; allowInherit?: boolean; onManage: () => void }
export default function SkillPicker({ skills, selected, inherited, inheritedConfigured = inherited.length > 0, onChange, disabled, allowInherit = true, onManage }: SkillPickerProps) {
 const [open, setOpen] = useState(false), [query, setQuery] = useState('')
 const opening = useRef(false), trigger = useRef<HTMLButtonElement>(null)
 const actions = useSkillActions(disabled)
 const defaultLabel = inheritedConfigured ? 'Use project skills' : 'Automatic'
 const defaultDescription = inheritedConfigured ? (inherited.length ? `${inherited.length} enabled by this project` : 'No skills enabled by this project') : 'Choose relevant installed skills for each message'
 const active = (selected === null && allowInherit ? inherited : selected ?? []).filter(id => skills.some(skill => skill.id === id))
 const filtered = skills.filter(skill => `${skill.name} ${skill.description}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
 const blocked = disabled || actions.busy
 function toggle(id: string, enabled: boolean) { if (blocked || enabled && active.length >= 10) return; onChange(enabled ? [...active, id] : active.filter(value => value !== id)) }
 return <><Popover open={open} onOpenChange={value => { if (!blocked) { setOpen(value); if (!value) setQuery('') } }}><PopoverTrigger asChild><Button ref={trigger} type="button" variant="ghost" className="skill-picker-trigger" disabled={blocked} aria-label={`Skills${active.length ? `, ${active.length} enabled` : ''}`}><Scroll size={15}/><span>Skills</span>{active.length > 0 && <span className="skill-count">{active.length}</span>}<CaretDown size={12}/></Button></PopoverTrigger><PopoverContent className="skill-picker" align="start" onCloseAutoFocus={event => { if (opening.current) { event.preventDefault(); opening.current = false } }}>
  <div className="skill-picker-heading"><strong>Skills</strong><span>{active.length}/10 enabled</span></div>
  {allowInherit && <label className="skill-inherit"><Checkbox aria-label={defaultLabel} checked={selected === null} disabled={blocked} onCheckedChange={checked => onChange(checked === true ? null : [...active])}/><span>{defaultLabel}<small>{defaultDescription}</small></span></label>}
  {skills.length > 0 && <div className="skills-search"><MagnifyingGlass size={15}/><Input value={query} onChange={event => setQuery(event.target.value)} aria-label="Find a skill" placeholder="Find a skill…" disabled={blocked}/></div>}
  <div className="skill-picker-list">{filtered.map(skill => <SkillMenus key={skill.id} skill={skill} disabled={blocked} onAction={(action, target) => { opening.current = true; trigger.current?.focus(); setOpen(false); void actions.act(action, target) }}><label className="skill-choice"><Checkbox aria-label={`Enable skill ${skill.name}`} checked={active.includes(skill.id)} disabled={blocked || active.length >= 10 && !active.includes(skill.id)} onCheckedChange={checked => toggle(skill.id, checked === true)}/><span><strong>{skill.name}</strong>{skill.description && <small>{skill.description}</small>}{selected === null && allowInherit && active.includes(skill.id) && <small>From project</small>}</span></label></SkillMenus>)}</div>
  {!filtered.length && <p className="skill-picker-empty">{skills.length ? 'No matching skills.' : 'Create reusable instructions and reference files in your Skills library.'}</p>}
  {active.length >= 10 && <p className="skill-help">Turn off a skill to enable another.</p>}
  <div className="skill-picker-footer"><Button type="button" variant="ghost" disabled={blocked || selected !== null && active.length === 0} onClick={() => onChange([])}>No skills</Button><Button type="button" variant="ghost" disabled={blocked} onClick={() => { setOpen(false); requestSkillSettingsPage('library'); onManage() }}><GearSix size={14}/>Manage skills</Button></div>
 </PopoverContent></Popover>
 {actions.error && <span className="chat-action-error skill-picker-error" role="alert">{actions.error}</span>}
 {actions.status && <span className="skill-picker-status" role="status">{actions.status}</span>}
 {actions.dialogs}
 </>
}
export { SkillPicker }
