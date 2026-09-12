import { TooltipButton } from '@zq/ui'
import { useEffect, useLayoutEffect, useId, useRef, useState, type KeyboardEvent, type RefObject } from 'react'
import type { ChatSkill } from '@zq/module-api'
import { Check, Scroll } from '@phosphor-icons/react'
import { SkillMenus, type SkillAction } from './SkillActions'
import {skillCommand,skillCommandRanges} from './skill-commands'
export type SlashToken = { start: number; end: number; query: string }
export function skillSlashToken(text: string, caret: number): SlashToken | null {
 const before = text.slice(0, caret), match = /(?:^|\s)\/([^\s/][^\n/]*|)$/.exec(before)
 return match ? { start: caret - match[1].length - 1, end: caret, query: match[1] } : null
}
export function useSkillSlash({ text, draftId, input, skills, active, disabled, onText, onEnable }: { text: string; draftId: string; input: RefObject<HTMLTextAreaElement | null>; skills: ChatSkill[]; active: string[]; disabled: boolean; onText: (text: string) => void; onEnable: (ids: string[]) => void }) {
 const context = useRef({ draftId, disabled }); context.current = { draftId, disabled }
 const [caret, setCaret] = useState(0), [focused, setFocused] = useState(false), [dismissed, setDismissed] = useState(''), [index, setIndex] = useState(0), [status, setStatus] = useState('')
 const ranges=skillCommandRanges(text,skills,active),candidate=focused&&!disabled?skillSlashToken(text,caret):null
 const token = candidate&&!ranges.some(range=>range.start===candidate.start)?candidate:null, key = token ? `${draftId}:${token.start}:${token.end}:${token.query}` : ''
 const open = !!token && key !== dismissed
 const filtered = skills.filter(skill => `${skill.name} ${skillCommand(skill,skills)} ${skill.description}`.toLocaleLowerCase().includes(token?.query.toLocaleLowerCase().trim() ?? ''))
 const choices = filtered.filter(skill => active.includes(skill.id) || active.length < 10)
 const listId = useId(), activeSkill = choices[Math.min(index, Math.max(0, choices.length - 1))]
 useEffect(() => { setIndex(0) }, [key])
 useEffect(() => { if (open && activeSkill) document.getElementById(`${listId}-${activeSkill.id}`)?.scrollIntoView({ block: 'nearest' }) }, [open, activeSkill?.id, listId])
 useEffect(() => { setDismissed(''); setIndex(0); setStatus(''); setCaret(input.current?.selectionStart ?? 0) }, [draftId])
 function dismiss() { setDismissed(key); setIndex(0) }
 function dismissToInput() { dismiss(); input.current?.focus({ preventScroll: true }) }
 function edit(nextText:string,nextCaret:number){const nextRanges=skillCommandRanges(nextText,skills,active),removed=new Set(ranges.filter(range=>!nextRanges.some(next=>next.id===range.id)).map(range=>range.id));if(removed.size)onEnable(active.filter(id=>!removed.has(id)));onText(nextText);setCaret(nextCaret)}
 function pick(skill: ChatSkill) {
  if (!token || disabled || !active.includes(skill.id) && active.length >= 10) return
  const next = active.includes(skill.id) ? active : [...active, skill.id]
  const command=skillCommand(skill,skills),after=text.slice(token.end),space=after.startsWith(' ')?'':' ',nextText=text.slice(0,token.start)+command+space+after,nextCaret=token.start+command.length+1
  onEnable(next); onText(nextText); setStatus(`${skill.name} enabled.`); dismiss()
  requestAnimationFrame(() => { if (context.current.draftId !== draftId || context.current.disabled || input.current?.value !== nextText) return; input.current?.focus({ preventScroll: true }); input.current?.setSelectionRange(nextCaret, nextCaret); setCaret(nextCaret) })
 }
 function keyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
  if (!open || event.nativeEvent.isComposing) return false
  if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); dismiss(); return true }
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setIndex(value => choices.length ? (value + (event.key === 'ArrowDown' ? 1 : -1) + choices.length) % choices.length : 0); return true }
  if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); if (activeSkill) pick(activeSkill); return true }
  return false
 }
 return { open, token, filtered, activeSkill, listId, status, pick, edit, ranges, dismiss, dismissToInput, keyDown, setFocused, setCaret, blockBareSlash: text.trim() === '/', activeDescendant: open && activeSkill ? `${listId}-${activeSkill.id}` : undefined }
}
export function SkillSlashMenu({ slash, active, disabled, onAction }: { slash: ReturnType<typeof useSkillSlash>; active: string[]; disabled: boolean; onAction: (action: SkillAction, skill: ChatSkill) => void }) {
 const menu = useRef<HTMLDivElement>(null), [placement, setPlacement] = useState({ side: 'top', height: 280 })
 useLayoutEffect(() => {
  if (!slash.open) return
  function measure() { const rect = menu.current?.parentElement?.getBoundingClientRect(); if (!rect) return; const above = rect.top - 16, below = window.innerHeight - rect.bottom - 16, side = above >= 250 || above >= below ? 'top' : 'bottom'; setPlacement({ side, height: Math.max(70, Math.min(280, (side === 'top' ? above : below) - 62)) }) }
  measure(); window.addEventListener('resize', measure); return () => window.removeEventListener('resize', measure)
 }, [slash.open, slash.filtered.length])
 if (!slash.open) return null
 return <div ref={menu} data-side={placement.side} className="skill-slash-menu" onMouseDown={event => event.preventDefault()} onKeyDown={event => { if (event.key === 'Escape' && !event.defaultPrevented) { event.preventDefault(); event.stopPropagation(); slash.dismissToInput() } }}>
  <div className="skill-picker-heading"><strong>Skills</strong><span>Enter to enable</span></div>
  <div role="listbox" id={slash.listId} aria-label="Installed skills" className="skill-slash-list" style={{ maxHeight: placement.height }}>{slash.filtered.map(skill => <SkillMenus key={skill.id} skill={skill} disabled={disabled} onAction={(action, target) => { slash.dismiss(); onAction(action, target) }}><TooltipButton tooltip={active.length >= 10 && !active.includes(skill.id) ? 'Turn off a skill before enabling another; up to 10 can be enabled' : `Insert ${skill.name} into your message and enable its instructions`} type="button" role="option" id={`${slash.listId}-${skill.id}`} aria-selected={slash.activeSkill?.id === skill.id} disabled={disabled || active.length >= 10 && !active.includes(skill.id)} className="skill-slash-option" onClick={() => slash.pick(skill)}><Scroll size={15}/><span><strong>{skill.name}</strong>{skill.description && <small>{skill.description}</small>}</span>{active.includes(skill.id) && <Check size={13}/>}</TooltipButton></SkillMenus>)}</div>
  {!slash.filtered.length && <p className="skill-help">No matching installed skills.</p>}
  {active.length >= 10 && <p className="skill-help">Turn off a skill in + → Skills to enable another.</p>}
 </div>
}
