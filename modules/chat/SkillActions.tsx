import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { useHost, unwrap, type Attachment, type ChatSkill } from '@zq/module-api'
import { DotsThree, PencilSimple, Copy, Export, Trash, TextT, Paperclip, FileText } from '@phosphor-icons/react'
import { Button, Input, Textarea, Dialog, DialogContent, DialogTitle, DialogDescription, ContextMenu, ContextMenuTrigger, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator } from '@zq/ui'
import AttachmentPreview from './AttachmentPreview'
import { SkillPackageFiles, type SkillPackageFilesHandle } from './SkillPackageFiles'

export type SkillAction = 'edit' | 'rename' | 'duplicate' | 'export' | 'delete'
const actions = [
 { action: 'edit', label: 'Edit', icon: PencilSimple },
 { action: 'rename', label: 'Rename', icon: TextT },
 { action: 'duplicate', label: 'Duplicate', icon: Copy },
 { action: 'export', label: 'Export', icon: Export },
 { action: 'delete', label: 'Delete', icon: Trash },
] as const

/** One action list for library rows and selected-skill rows. Dialogs live outside popovers. */
export function SkillMenus({ skill, disabled, onAction, children }: { skill: ChatSkill; disabled: boolean; onAction: (action: SkillAction, skill: ChatSkill) => void; children: ReactNode }) {
 const opening = useRef(false), row = useRef<HTMLDivElement>(null)
 function choose(action: SkillAction) { opening.current = true; row.current?.querySelector<HTMLButtonElement>('button')?.focus(); onAction(action, skill) }
 function closeMenu(event: Event) { if (opening.current) { event.preventDefault(); opening.current = false } }
 return <ContextMenu><ContextMenuTrigger asChild disabled={disabled}><div ref={row} className="skill-menu-row">{children}
  <DropdownMenu><DropdownMenuTrigger asChild><Button type="button" variant="ghost" size="icon" className="settings-more-button skill-more" aria-label={`Actions for skill ${skill.name}`} disabled={disabled}><DotsThree size={18}/></Button></DropdownMenuTrigger><DropdownMenuContent align="end" onCloseAutoFocus={closeMenu}>
   {actions.map(({ action, label, icon: Icon }) => <span key={action}>{action === 'delete' && <DropdownMenuSeparator/>}<DropdownMenuItem disabled={disabled} className={action === 'delete' ? 'chat-delete-action' : undefined} onSelect={() => choose(action)}><Icon size={15}/>{label}</DropdownMenuItem></span>)}
  </DropdownMenuContent></DropdownMenu>
 </div></ContextMenuTrigger><ContextMenuContent aria-label={`Skill actions for ${skill.name}`} onCloseAutoFocus={closeMenu}>
  {actions.map(({ action, label, icon: Icon }) => <span key={action}>{action === 'delete' && <ContextMenuSeparator/>}<ContextMenuItem disabled={disabled} className={action === 'delete' ? 'chat-delete-action' : undefined} onSelect={() => choose(action)}><Icon size={15}/>{label}</ContextMenuItem></span>)}
 </ContextMenuContent></ContextMenu>
}

export function useSkillActions(disabled: boolean) {
 const host = useHost()
 const [dialog, setDialog] = useState<{ skill?: ChatSkill; action: 'edit' | 'rename' | 'delete' } | null>(null)
 const [busy, setBusy] = useState(false), [error, setError] = useState(''), [status, setStatus] = useState('')
 const lock = useRef(false), origin = useRef<HTMLElement | null>(null), mounted = useRef(true)
 const id = useId()
 useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
 useEffect(() => host.registerFlush(`skill-actions-${id}`, async () => { if (lock.current) throw Error('Wait for the skill operation to finish before closing zQ.') }), [host.registerFlush, id])
 function rememberOrigin() { origin.current = document.activeElement instanceof HTMLElement ? document.activeElement : null }
 function restoreFocus(event: Event) { event.preventDefault(); const target = origin.current?.isConnected ? origin.current : document.querySelector<HTMLElement>('.skills-settings .settings-panel-header button:not(:disabled), .skill-picker-trigger:not(:disabled), [aria-label="Chat message"]'); target?.focus({ preventScroll: true }) }
 async function act(action: SkillAction, skill: ChatSkill) {
  if (disabled || lock.current) return
  rememberOrigin(); setError(''); setStatus('')
  if (action === 'edit' || action === 'rename' || action === 'delete') { setDialog({ action, skill }); return }
  lock.current = true; setBusy(true)
  try {
   if (action === 'duplicate') { const copy = await unwrap(host.services.chat.duplicateSkill(skill.id)); if (mounted.current) setDialog({ action: 'edit', skill: copy }) }
   else if (await unwrap(host.services.chat.exportSkill(skill.id))) { if (mounted.current) setStatus(`${skill.name} exported.`) }
  } catch (e) { if (mounted.current) setError((e as Error).message) }
  finally { lock.current = false; if (mounted.current) setBusy(false) }
 }
 return { busy, error, status, act, create: () => { if (!disabled && !lock.current) { rememberOrigin(); setError(''); setStatus(''); setDialog({ action: 'edit' }) } },
  dialogs: dialog && <SkillEditor key={`${dialog.action}-${dialog.skill?.id ?? 'new'}`} skill={dialog.skill} action={dialog.action} disabled={disabled} onClose={() => setDialog(null)} onSaved={message => { setDialog(null); setStatus(message) }} onCloseAutoFocus={restoreFocus}/>,
 }
}

export function SkillEditor({ skill, action = 'edit', disabled = false, onClose, onSaved, onCloseAutoFocus }: { skill?: ChatSkill; action?: 'edit' | 'rename' | 'delete'; disabled?: boolean; onClose: () => void; onSaved: (message: string) => void; onCloseAutoFocus?: (event: Event) => void }) {
 const host = useHost(), id = useId()
 const [name, setName] = useState(skill?.name ?? ''), [description, setDescription] = useState(skill?.description ?? ''), [instructions, setInstructions] = useState(skill?.instructions ?? '')
 const [files, setFiles] = useState<Attachment[]>(skill?.files ?? []), [busy, setBusy] = useState(false), [error, setError] = useState('')
 const [discarding, setDiscarding] = useState(false), [preview, setPreview] = useState<Attachment | null>(null)
 const savedId = useRef(skill?.id), lock = useRef(false), input = useRef<HTMLInputElement>(null), cancel = useRef<HTMLButtonElement>(null)
 const initial = useRef({ name: skill?.name ?? '', description: skill?.description ?? '', instructions: skill?.instructions ?? '' })
 const staged = useRef<Attachment[]>([]), mounted = useRef(true)
 const dirty = action !== 'delete' && (name !== initial.current.name || description !== initial.current.description || instructions !== initial.current.instructions || staged.current.length > 0)
 const dirtyRef = useRef(dirty); dirtyRef.current = dirty
 const [packageBusy, setPackageBusy] = useState(false), [packagePreview, setPackagePreview] = useState(false), packageFiles = useRef<SkillPackageFilesHandle>(null)
 const blocked = disabled || host.closing || busy || packageBusy
 useEffect(() => {
  mounted.current = true
  return () => { mounted.current = false; for (const file of staged.current) void host.services.attachments.discard(file.id) }
 }, [])
 useEffect(() => host.registerFlush(`skill-editor-${id}`, async () => {
  if (lock.current) throw Error('Wait for the skill operation to finish before closing zQ.')
  if (dirtyRef.current) throw Error('Save or discard your skill changes before closing zQ.')
 }), [host.registerFlush, id])
 function close() { if (blocked || lock.current) return; if (packagePreview) { packageFiles.current?.closePreview(); return }; if (dirty) setDiscarding(true); else onClose() }
 async function save() {
  if (blocked || lock.current) return
  lock.current = true; setBusy(true); setError('')
  try {
   if (action === 'delete' && skill) { await unwrap(host.services.chat.deleteSkill(skill.id)); onSaved(`${skill.name} deleted.`); return }
   const saved = await unwrap(host.services.chat.saveSkill({ id: savedId.current, name, ...(action === 'rename' ? {} : { description, instructions }) }))
   savedId.current = saved.id
   initial.current = { name, description, instructions }
   if (staged.current.length) {
    await unwrap(host.services.chat.addSkillFiles({ id: saved.id, attachmentIds: staged.current.map(file => file.id) }))
    staged.current = []
   }
   if (mounted.current) onSaved(`${saved.name} saved.`)
  } catch (e) { if (mounted.current) setError((e as Error).message) }
  finally { lock.current = false; if (mounted.current) setBusy(false) }
 }
 async function addFiles() {
  if (blocked || lock.current) return
  lock.current = true; setBusy(true); setError('')
  let picked: Attachment[] = []
  try {
   const result = await unwrap(host.services.attachments.pick()); picked = result.items
   if (!mounted.current) { for (const file of picked) await host.services.attachments.discard(file.id); return }
   if (result.errors.length) throw Error(result.errors.map(item => `${item.name}: ${item.message}`).join('\n'))
   if (picked.some(file => file.kind === 'image')) throw Error('Skills accept text and PDF reference files. Choose a text file or PDF instead.')
   if (files.length + picked.length > 10) throw Error('A skill can contain up to ten reference files. Remove a file before adding more.')
   if (!picked.length) return
   if (savedId.current) await unwrap(host.services.chat.addSkillFiles({ id: savedId.current, attachmentIds: picked.map(file => file.id) }))
   else staged.current = [...staged.current, ...picked]
   const added = picked; picked = []; setFiles(old => [...old, ...added])
  } catch (e) { for (const file of picked) await host.services.attachments.discard(file.id); if (mounted.current) setError((e as Error).message) }
  finally { lock.current = false; if (mounted.current) setBusy(false) }
 }
 async function removeFile(file: Attachment) {
  if (blocked || lock.current) return
  lock.current = true; setBusy(true); setError('')
  try {
   if (staged.current.some(item => item.id === file.id)) { await unwrap(host.services.attachments.discard(file.id)); staged.current = staged.current.filter(item => item.id !== file.id) }
   else if (savedId.current) await unwrap(host.services.chat.removeSkillFile({ id: savedId.current, attachmentId: file.id }))
   if (mounted.current) setFiles(old => old.filter(item => item.id !== file.id))
  } catch (e) { if (mounted.current) setError((e as Error).message) }
  finally { lock.current = false; if (mounted.current) setBusy(false) }
 }
 return <><Dialog open onOpenChange={open => { if (!open) close() }}><DialogContent className={`skill-editor ${action === 'delete' ? 'skill-delete-dialog' : ''}`} showCloseButton={!blocked} onEscapeKeyDown={event => { if (packagePreview) { event.preventDefault(); packageFiles.current?.closePreview() } }} onCloseAutoFocus={onCloseAutoFocus} onOpenAutoFocus={event => { event.preventDefault(); if (action === 'delete') cancel.current?.focus(); else { input.current?.focus(); if (action === 'rename') input.current?.select() } }}>
  <DialogTitle>{action === 'delete' ? 'Delete skill?' : action === 'rename' ? 'Rename skill' : skill ? 'Edit skill' : 'New skill'}</DialogTitle>
  <DialogDescription>{action === 'delete' ? `“${skill?.name}” will be removed from your library and future chat and project selections. Previously sent chats retain their skill snapshots. This cannot be undone.` : action === 'rename' ? 'Choose a name that is easy to find in your library.' : 'Reusable instructions and references for the chats you choose. Changes apply to future messages.'}</DialogDescription>
  <form onSubmit={event => { event.preventDefault(); void save() }}>
   {action !== 'delete' && <><label htmlFor={`${id}-name`}>Name</label><Input id={`${id}-name`} ref={input} aria-label="Skill name" value={name} maxLength={256} disabled={blocked} onChange={event => setName(event.target.value)} placeholder="e.g. Writing style"/>
    {action !== 'rename' && <><label htmlFor={`${id}-description`}>Description <span className="skill-optional">Optional</span></label><Input id={`${id}-description`} aria-label="Skill description" value={description} maxLength={1024} disabled={blocked} onChange={event => setDescription(event.target.value)} placeholder="When should this skill be used?"/>
     <label htmlFor={`${id}-instructions`}>Instructions</label><Textarea id={`${id}-instructions`} aria-label="Skill instructions" value={instructions} maxLength={1048576} disabled={blocked} onChange={event => setInstructions(event.target.value)} placeholder="Describe how zQ should approach this work…"/>
     <div className="skill-files-heading"><label>Reference files <span className="skill-optional">{files.length}/10</span></label><Button type="button" variant="ghost" disabled={blocked || files.length >= 10} onClick={() => void addFiles()}><Paperclip size={14}/>Add files</Button></div>
     <p className="skill-help">Active text and PDF references are included when this skill is enabled. Each message can use up to 100 KB of total reference context.{savedId.current ? ' Reference changes save immediately; original package files are kept.' : ''}</p>
     {files.length > 0 && <div className="skill-files" aria-label="Skill reference files">{files.map(file => <ContextMenu key={file.id}><ContextMenuTrigger asChild disabled={blocked}><div className="skill-file"><button type="button" disabled={blocked} className="skill-file-name" onClick={() => setPreview(file)}><FileText size={16}/><span>{file.name}</span></button><DropdownMenu><DropdownMenuTrigger asChild><Button type="button" size="icon" variant="ghost" disabled={blocked} aria-label={`Actions for reference ${file.name}`}><DotsThree size={17}/></Button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuItem onSelect={() => setPreview(file)}>Preview</DropdownMenuItem><DropdownMenuItem className="chat-delete-action" onSelect={() => void removeFile(file)}>Remove</DropdownMenuItem></DropdownMenuContent></DropdownMenu></div></ContextMenuTrigger><ContextMenuContent><ContextMenuItem disabled={blocked} onSelect={() => setPreview(file)}>Preview</ContextMenuItem><ContextMenuItem disabled={blocked} className="chat-delete-action" onSelect={() => void removeFile(file)}>Remove</ContextMenuItem></ContextMenuContent></ContextMenu>)}</div>}
     {skill?.package && <SkillPackageFiles ref={packageFiles} resources={skill.package.resources} frontmatter={skill.package.frontmatter} activePaths={files.map(file => file.resourcePath ?? file.name)} skillId={skill.id} disabled={disabled || host.closing || busy} onBusyChange={setPackageBusy} onPreviewChange={setPackagePreview}/>}
    </>}
   </>}
   {error && <p className="chat-action-error" role="alert">{error}</p>}
   <div className="dialog-actions"><Button type="button" ref={cancel} variant="ghost" disabled={blocked} onClick={close}>Cancel</Button><Button type="submit" variant={action === 'delete' ? 'destructive' : 'default'} disabled={blocked || action !== 'delete' && !name.trim()}>{busy ? 'Saving…' : action === 'delete' ? 'Delete skill' : action === 'rename' ? 'Rename' : 'Save skill'}</Button></div>
  </form>
 </DialogContent></Dialog>
 <Dialog open={discarding} onOpenChange={setDiscarding}><DialogContent className="skill-discard-dialog"><DialogTitle>Discard skill changes?</DialogTitle><DialogDescription>Your unsaved name, description and instructions will be lost. Saved reference file changes are kept.</DialogDescription><div className="dialog-actions"><Button variant="ghost" onClick={() => setDiscarding(false)}>Keep editing</Button><Button variant="destructive" onClick={onClose}>Discard changes</Button></div></DialogContent></Dialog>
 {preview && <AttachmentPreview target={preview} closing={host.closing} onClose={() => setPreview(null)}/>}
 </>
}
