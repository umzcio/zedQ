import { forwardRef, useEffect, useId, useImperativeHandle, useRef, useState } from 'react'
import { useHost, unwrap } from '@zq/module-api'
import { DotsThree, DownloadSimple, Eye, File } from '@phosphor-icons/react'
import { Button, Dialog, DialogContent, DialogTitle, DialogDescription, ContextMenu, ContextMenuTrigger, ContextMenuContent, ContextMenuItem, DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from '@zq/ui'

type PackageResource = { path: string; size: number; data?: string; digest?: string }
export type SkillPackageFilesHandle = { closePreview: () => void }
type Props = { resources: PackageResource[]; frontmatter?: string; activePaths: string[]; skillId?: string; disabled: boolean; onBusyChange: (busy: boolean) => void; onPreviewChange: (open: boolean) => void }
const MAX_PREVIEW_BYTES = 1024 * 1024
function localPreview(resource: PackageResource): { name: string; size: number; text?: string } {
 const result = { name: resource.path, size: resource.size }
 if (resource.size === 0) return { ...result, text: '' }
 if (resource.size > MAX_PREVIEW_BYTES || !resource.data || resource.data.length > Math.ceil(MAX_PREVIEW_BYTES / 3) * 4 + 4) return result
 try {
  const bytes = Uint8Array.from(atob(resource.data), char => char.charCodeAt(0))
  if (bytes.length > MAX_PREVIEW_BYTES) return result
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  return /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text) ? result : { ...result, text }
 } catch { return result }
}

/** Package source files remain intact when active chat references are removed. */
export const SkillPackageFiles = forwardRef<SkillPackageFilesHandle, Props>(function SkillPackageFiles({ resources, frontmatter, activePaths, skillId, disabled, onBusyChange, onPreviewChange }, ref) {
 const host = useHost(), id = useId(), lock = useRef(false), mounted = useRef(true)
 const [busy, setBusy] = useState(false), [error, setError] = useState(''), [status, setStatus] = useState('')
 const [preview, setPreview] = useState<{ name: string; size: number; text?: string } | null>(null)
 const rows = useRef(new Map<string, HTMLButtonElement>()), origin = useRef<HTMLButtonElement | null>(null), opening = useRef(false)
 const blocked = disabled || host.closing || busy
 const latestCallbacks = useRef({ onBusyChange, onPreviewChange }); latestCallbacks.current = { onBusyChange, onPreviewChange }
 useEffect(() => { mounted.current = true; return () => { mounted.current = false; latestCallbacks.current.onBusyChange(false); latestCallbacks.current.onPreviewChange(false) } }, [])
 useEffect(() => host.registerFlush(`skill-package-${id}`, async () => { if (lock.current) throw Error('Wait for the package file operation to finish before closing zQ.') }), [host.registerFlush, id])
 function closePreview() { if (!lock.current) { setPreview(null); onPreviewChange(false) } }
 useImperativeHandle(ref, () => ({ closePreview }))
 function setPending(value: boolean) { lock.current = value; if (mounted.current) { setBusy(value); onBusyChange(value) } }
 async function openFile(resource: PackageResource) {
  if (blocked || lock.current) return
  origin.current = rows.current.get(resource.path) ?? null; origin.current?.focus(); setError(''); setStatus(''); setPending(true)
  try {
   const result = skillId ? await unwrap(host.services.chat.previewSkillResource({ id: skillId, path: resource.path })) : localPreview(resource)
   if (mounted.current) { setPreview({ ...result, name: resource.path }); onPreviewChange(true) }
  } catch (e) { if (mounted.current) setError((e as Error).message) }
  finally { setPending(false) }
 }
 async function saveFile(resource: PackageResource) {
  if (!skillId || blocked || lock.current) return
  setError(''); setStatus(''); setPending(true)
  try { if (await unwrap(host.services.chat.saveSkillResource({ id: skillId, path: resource.path })) && mounted.current) setStatus(`${resource.path} saved.`) }
  catch (e) { if (mounted.current) setError((e as Error).message) }
  finally { setPending(false) }
 }
 function closeMenu(event: Event) { if (opening.current) { event.preventDefault(); opening.current = false } }
 return <section className="skill-package-files" aria-label="Skill package files">
  {resources.length > 0 && <><div className="skill-files-heading"><label>Package files <span className="skill-optional">{resources.length}</span></label></div><p className="skill-help">Original paths and file contents are preserved for export. Only active references are included in chat context. Scripts are never run.</p>
   <div className="skill-files">{resources.map(resource => <ContextMenu key={resource.path}><ContextMenuTrigger asChild disabled={blocked}><div className="skill-file skill-package-file"><button ref={node => { if (node) rows.current.set(resource.path, node); else rows.current.delete(resource.path) }} type="button" className="skill-file-name" disabled={blocked} aria-label={`Preview package file ${resource.path}`} title={resource.path} onClick={() => void openFile(resource)}><File size={16}/><span><strong>{resource.path}</strong><small>{activePaths.includes(resource.path) ? 'Active context' : 'Preserved for export'} · {resource.size < 1024 ? `${resource.size} B` : `${(resource.size / 1024).toFixed(1)} KB`}</small></span></button><DropdownMenu><DropdownMenuTrigger asChild><Button type="button" variant="ghost" size="icon" disabled={blocked} aria-label={`Actions for package file ${resource.path}`}><DotsThree size={17}/></Button></DropdownMenuTrigger><DropdownMenuContent align="end" onCloseAutoFocus={closeMenu}><DropdownMenuItem disabled={blocked} onSelect={() => { opening.current = true; void openFile(resource) }}><Eye size={15}/>Preview</DropdownMenuItem>{skillId && <DropdownMenuItem disabled={blocked} onSelect={() => void saveFile(resource)}><DownloadSimple size={15}/>Save file</DropdownMenuItem>}</DropdownMenuContent></DropdownMenu></div></ContextMenuTrigger><ContextMenuContent onCloseAutoFocus={closeMenu} aria-label={`Package file actions for ${resource.path}`}><ContextMenuItem disabled={blocked} onSelect={() => { opening.current = true; void openFile(resource) }}><Eye size={15}/>Preview</ContextMenuItem>{skillId && <ContextMenuItem disabled={blocked} onSelect={() => void saveFile(resource)}><DownloadSimple size={15}/>Save file</ContextMenuItem>}</ContextMenuContent></ContextMenu>)}</div>
  </>}
  {frontmatter && <details className="skill-package-metadata"><summary>Package metadata</summary><p className="skill-help">Original metadata is retained for export, including compatibility requirements. Importing it does not grant tools or permissions.</p><pre className="skill-import-text">{frontmatter}</pre></details>}
  {error && <p className="chat-action-error" role="alert">{error}</p>}{status && <p className="skill-help" role="status">{status}</p>}
  <Dialog open={!!preview} onOpenChange={open => { if (!open) closePreview() }}><DialogContent className="skill-editor skill-package-preview" showCloseButton={!blocked} onCloseAutoFocus={event => { event.preventDefault(); (origin.current?.isConnected ? origin.current : rows.current.values().next().value)?.focus({ preventScroll: true }) }}><DialogTitle>{preview?.name}</DialogTitle><DialogDescription>Original package file. Previewing does not run scripts or activate this file as chat context.</DialogDescription>{preview && (preview.text !== undefined ? <pre className="skill-import-text">{preview.text || 'This file is empty.'}</pre> : <p className="skill-help">{preview.size > MAX_PREVIEW_BYTES ? 'This file is too large for a text preview.' : 'This file cannot be previewed as text.'} Its original bytes are preserved for export.{skillId ? ' Use Save file to open it in another app.' : ''}</p>)}</DialogContent></Dialog>
 </section>
})
