import { useRef, useState } from 'react'
import { Plus, MagnifyingGlass, Scroll } from '@phosphor-icons/react'
import { TooltipButton, Button, Input } from '@zq/ui'
import type { ChatController } from './useChat'
import SkillImportControl from './SkillImport'
import SkillBrowser from './SkillBrowser'
import { SkillMenus, useSkillActions } from './SkillActions'
import './skills.css'
import {useSkillSettingsBrowser} from './skills-navigation'

export default function SkillsSettings({ chat, closing }: { chat: ChatController; closing: boolean }) {
 const [query, setQuery] = useState(''), [browsing, setBrowsing] = useSkillSettingsBrowser()
 const browseButton = useRef<HTMLButtonElement>(null)
 const stateError = chat.error || chat.state.error
 const disabled = closing || chat.loading || !!stateError
 const actions = useSkillActions(disabled)
 const skills = chat.state.skills ?? []
 const filtered = skills.filter(skill => `${skill.name} ${skill.description}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
 if (browsing) return <SkillBrowser skills={skills} disabled={disabled} libraryFull={skills.length >= 100} onBack={() => { setBrowsing(false); requestAnimationFrame(() => browseButton.current?.focus()) }}/>
 return <section className="skills-settings" id="chat-skills">
  <div className="settings-panel-header"><div><h2>Skills</h2><p>Instructions and references you can reuse across chats and projects.</p></div><div className="skill-library-actions"><Button tooltip="Explore curated skills and preview their instructions before importing" ref={browseButton} type="button" variant="ghost" disabled={disabled||actions.busy} onClick={()=>setBrowsing(true)}>Browse skills</Button><SkillImportControl disabled={disabled||actions.busy||skills.length>=100}/><Button tooltip={skills.length >= 100 ? 'Delete a library skill before creating another; the limit is 100' : 'Create reusable instructions and reference files'} variant="outline" disabled={disabled || actions.busy || skills.length >= 100} onClick={actions.create}><Plus size={15}/>New skill</Button></div></div>
  {stateError && <p className="chat-error" role="alert">{stateError}</p>}
  {chat.loading ? <p role="status">Loading skills…</p> : skills.length ? <>
   <div className="skills-search"><MagnifyingGlass size={16} aria-hidden="true"/><Input value={query} onChange={event => setQuery(event.target.value)} aria-label="Search skills" placeholder="Search skills…" disabled={closing}/><span>{skills.length}/100</span></div>
   <div className="skills-list">{filtered.map(skill => <SkillMenus key={skill.id} skill={skill} disabled={disabled || actions.busy} onAction={(action, target) => void actions.act(action, target)}><span className="settings-resource-icon"><Scroll size={21} weight="light"/></span><TooltipButton tooltip={`Edit ${skill.name} instructions and reference files`} type="button" className="skill-summary" disabled={disabled || actions.busy} onClick={() => void actions.act('edit', skill)} aria-label={`Edit skill ${skill.name}`}><strong>{skill.name}</strong><span>{skill.description || `${skill.files.length} reference ${skill.files.length === 1 ? 'file' : 'files'}`}</span></TooltipButton></SkillMenus>)}</div>
   {!filtered.length && <p className="skill-empty">No skills match “{query}”. Try another name or description.</p>}
  </> : !stateError && <div className="skill-empty"><Scroll size={26} weight="light"/><p>No skills yet.</p><span>Create a skill for your writing style, review process, or project knowledge. Enable it from a chat or project when you need it.</span></div>}
  {skills.length >= 100 && <p className="skill-help">Your library has 100 skills. Delete a skill to create another.</p>}
  {actions.error && <p className="chat-error" role="alert">{actions.error}</p>}
  {actions.status && <p className="skill-result" role="status">{actions.status}</p>}
  {actions.dialogs}
 </section>
}
