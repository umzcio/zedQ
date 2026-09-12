import { useEffect, useId, useRef, useState } from 'react'
import { useHost, unwrap, type SkillImport, type SkillCatalogEntry, type ChatSkill, type SkillUpdatePreview } from '@zq/module-api'
import { ArrowLeft, ArrowUpRight, DotsThree, Eye, ArrowClockwise, MagnifyingGlass, Scroll } from '@phosphor-icons/react'
import { Button, Input, ContextMenu, ContextMenuTrigger, ContextMenuContent, ContextMenuItem, DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from '@zq/ui'
import SkillImportControl from './SkillImport'

export default function SkillBrowser({ disabled, skills, libraryFull = false, onBack }: { disabled: boolean; skills: ChatSkill[]; libraryFull?: boolean; onBack: () => void }) {
 const host = useHost(), id = useId(), mounted = useRef(true), lock = useRef(false), opening = useRef(false)
 const [entries, setEntries] = useState<SkillCatalogEntry[]>([]), [query, setQuery] = useState(''), [loading, setLoading] = useState(true), [busy, setBusy] = useState(''), [error, setError] = useState(''), [refresh, setRefresh] = useState(0)
 const [candidate, setCandidate] = useState<SkillImport | null>(null), [updatePreview, setUpdatePreview] = useState<SkillUpdatePreview | null>(null), [updateAllowed, setUpdateAllowed] = useState(false), [checkFailed, setCheckFailed] = useState(false)
 const origin = useRef<HTMLButtonElement | null>(null), rows = useRef(new Map<string, HTMLButtonElement>()), back = useRef<HTMLButtonElement>(null)
 const blocked = disabled || host.closing || !!busy || !!candidate
 useEffect(() => { mounted.current = true; back.current?.focus(); return () => { mounted.current = false } }, [])
 useEffect(() => { let live = true; setLoading(true); setError(''); unwrap(host.services.chat.browseSkills({})).then(value => { if (live) setEntries(value) }).catch(e => { if (live) setError(e.message) }).finally(() => { if (live) setLoading(false) }); return () => { live = false } }, [refresh])
 useEffect(() => host.registerFlush(`skill-browser-${id}`, async () => { if (lock.current) throw Error('Wait for the skill operation to finish before closing zQ.') }), [host.registerFlush, id])
 function recordPreview(value: SkillImport) { if (value.source) { const source = value.source; setEntries(old => old.map(entry => entry.id === source.catalogId ? { ...entry, revision: source.revision, checkedAt: Date.now(), checkError: undefined } : entry)) } }
 async function preview(entry: SkillCatalogEntry) {
  if (blocked || lock.current) return
  origin.current = rows.current.get(entry.id) ?? null; origin.current?.focus(); lock.current = true; setBusy(entry.id); setError('')
  try { const installed = skills.find(skill => skill.source?.catalogId === entry.id); if (installed) { const value = await unwrap(host.services.chat.previewSkillUpdate(installed.id)); if (mounted.current) { recordPreview(value.candidate); setUpdatePreview(value); setUpdateAllowed(!!value.candidate.source?.revision && value.candidate.source.revision !== installed.source?.revision); setCandidate(value.candidate) } } else { const value = await unwrap(host.services.chat.previewCatalogSkill(entry.id)); if (mounted.current) { recordPreview(value); setUpdatePreview(null); setCandidate(value) } } }
  catch (e) { if (mounted.current) setError((e as Error).message) }
  finally { lock.current = false; if (mounted.current) setBusy('') }
 }
 async function checkUpdates() {
  if (blocked || lock.current) return
  lock.current = true; setBusy('check'); setError('')
  try { const value = await unwrap(host.services.chat.checkSkillUpdates()); if (mounted.current) { setEntries(value); setCheckFailed(false) } }
  catch (e) { if (mounted.current) { setCheckFailed(true); setError((e as Error).message) } }
  finally { lock.current = false; if (mounted.current) setBusy('') }
 }
 async function openLink(url: string) { if (blocked) return; try { await unwrap(host.services.chat.openLink(url)) } catch (e) { if (mounted.current) setError((e as Error).message) } }
 function closeMenu(event: Event) { if (opening.current) { event.preventDefault(); opening.current = false } }
 const filtered = entries.filter(entry => `${entry.name} ${entry.description} ${entry.category} ${entry.requirements}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
 const alreadyInstalled = !updatePreview && !!candidate?.source && skills.some(skill => skill.source?.catalogId === candidate.source?.catalogId)
 const lastChecked = Math.max(0, ...entries.map(entry => entry.checkedAt ?? 0)), entryFailures = entries.some(entry => !!entry.checkError)
 return <section className="skills-settings skill-browser" aria-label="Browse skills">
  <Button ref={back} type="button" className="skill-browser-back" variant="ghost" disabled={blocked} onClick={onBack}><ArrowLeft size={14}/>Back to library</Button>
  <div className="settings-panel-header"><div><h2>Browse skills</h2><p>Curated for zQ. Preview a skill, then add it to your library.</p></div><Button type="button" variant="outline" disabled={blocked} onClick={() => void openLink('https://skills.sh')}>Explore skills.sh<ArrowUpRight size={14}/></Button></div>
  <div className="skill-update-toolbar"><Button type="button" variant="ghost" disabled={blocked||loading||!entries.length} onClick={()=>void checkUpdates()}><ArrowClockwise size={14}/>{busy==='check'?'Checking…':'Check for updates'}</Button><span role="status">{checkFailed?'Update check failed. Try again.':entryFailures?'Some update checks failed. Try again.':lastChecked?`Last checked ${new Date(lastChecked).toLocaleString(undefined,{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})}`:'Updates have not been checked.'}</span></div>
  <div className="skills-search"><MagnifyingGlass size={16}/><Input aria-label="Search curated skills" value={query} disabled={blocked} onChange={event => setQuery(event.target.value)} placeholder="Search curated skills…"/></div>
  <p className="skill-help">This is a curated starter list. Explore skills.sh for the full catalog. Relevant installed skills can be selected automatically. Choose specific skills in a chat or project to limit selection, or choose No skills to turn them off.</p>
  {loading && <p className="skill-help" role="status">Loading curated skills…</p>}
  {error && <div className="skill-browser-error"><p className="chat-action-error" role="alert">{error}</p>{!entries.length && <Button type="button" variant="ghost" disabled={blocked || loading} onClick={() => setRefresh(value => value + 1)}>Try again</Button>}</div>}
  <div className="skills-list skill-catalog-list">{filtered.map(entry => {
   const installed = skills.find(skill => skill.source?.catalogId === entry.id), failed = checkFailed || !!entry.checkError, updateAvailable = !!installed && !failed && !!entry.revision && installed.source?.revision !== entry.revision
   const badge = !installed ? '' : failed || !entry.revision ? 'Installed' : updateAvailable ? 'Update available' : 'Up to date'
   const actions = [{ label: updateAvailable ? 'Preview update' : 'Preview', run: () => { opening.current = true; void preview(entry) } }, { label: 'View on skills.sh', run: () => void openLink(entry.url) }, { label: 'View source', run: () => void openLink(entry.source) }]
   return <ContextMenu key={entry.id}><ContextMenuTrigger asChild disabled={blocked}><div className="skill-menu-row skill-catalog-row"><span className="settings-resource-icon"><Scroll size={21} weight="light"/></span><button ref={node => { if (node) rows.current.set(entry.id, node); else rows.current.delete(entry.id) }} type="button" className="skill-summary skill-catalog-summary" disabled={blocked} onClick={() => void preview(entry)} aria-label={`Preview skill ${entry.name}`}><strong>{entry.name}<small>{entry.category}</small>{badge&&<span className="skill-installed-badge" data-update={updateAvailable||undefined}>{badge}</span>}</strong><span>{entry.description}</span>{entry.requirements && <span className="skill-catalog-requirements">{entry.requirements}</span>}{installed&&failed&&<span className="skill-catalog-check-error">{entry.checkError||'Update check failed. Try again.'}</span>}</button><Button type="button" className="skill-catalog-preview" variant="ghost" disabled={blocked} onClick={() => void preview(entry)}>{busy === entry.id ? 'Loading…' : updateAvailable ? 'Preview update' : 'Preview'}<Eye size={14}/></Button><DropdownMenu><DropdownMenuTrigger asChild><Button type="button" variant="ghost" size="icon" className="settings-more-button" aria-label={`Actions for catalog skill ${entry.name}`} disabled={blocked}><DotsThree size={18}/></Button></DropdownMenuTrigger><DropdownMenuContent align="end" onCloseAutoFocus={closeMenu}>{actions.map(action => <DropdownMenuItem key={action.label} disabled={blocked} onSelect={action.run}>{action.label}</DropdownMenuItem>)}</DropdownMenuContent></DropdownMenu></div></ContextMenuTrigger><ContextMenuContent aria-label={`Catalog skill actions for ${entry.name}`} onCloseAutoFocus={closeMenu}>{actions.map(action => <ContextMenuItem key={action.label} disabled={blocked} onSelect={action.run}>{action.label}</ContextMenuItem>)}</ContextMenuContent></ContextMenu>
  })}</div>
  {!loading && !error && !filtered.length && <p className="skill-empty">{query.trim() ? `No curated skills match “${query}”. Try another search or explore skills.sh.` : 'No curated skills are available.'}</p>}
  <SkillImportControl disabled={disabled || host.closing} externalCandidate={candidate} updatePreview={updatePreview} updateAllowed={updateAllowed} importDisabled={libraryFull || alreadyInstalled} importDisabledReason={alreadyInstalled ? 'This source is already installed. Cancel and preview the installed skill to check for updates.' : undefined} hideTrigger onReviewClose={() => { setCandidate(null); setUpdatePreview(null) }} onReviewCloseAutoFocus={() => (origin.current?.isConnected ? origin.current : back.current)?.focus({ preventScroll: true })}/>
 </section>
}
