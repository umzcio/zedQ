import { useCallback, useEffect, useRef, useState } from 'react'
import { unwrap, type ModuleStatus } from '@zq/module-api'
import {
 ControlTooltip, Button, Input, Dialog, DialogContent, DialogTitle, DialogDescription,
 ContextMenu, ContextMenuTrigger, ContextMenuContent, ContextMenuItem,
 DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
} from '@zq/ui'
import { ArrowCounterClockwise, CaretDown, ChatCircle, DotsThree, DownloadSimple, House, Kanban, NotePencil, Package } from '@phosphor-icons/react'

function ModuleRow({row,disabled,onRollback,onDownload}:{row:ModuleStatus;disabled:boolean;onRollback:()=>void;onDownload:(opener:HTMLElement|null)=>void}){
 const rowRef=useRef<HTMLDivElement>(null),actionsRef=useRef<HTMLButtonElement>(null),openingDialog=useRef(false)
 const Icon=({'zq.hq':House,'zq.notes':NotePencil,'zq.tasks':Kanban,'zq.chat':ChatCircle}[row.id])??Package
 const rollbackDisabled=disabled||(!row.previousVersion&&row.source==='bundled'&&!row.pendingVersion)
 function download(opener:HTMLElement|null){openingDialog.current=true;onDownload(opener)}
 function closeMenu(event:Event){if(openingDialog.current){event.preventDefault();openingDialog.current=false}}
 return <ContextMenu><ContextMenuTrigger asChild><div ref={rowRef} className="settings-resource-row module-version-row" tabIndex={0}>
  <span className="settings-resource-icon"><Icon size={20} weight="light"/></span>
  <div className="settings-resource-copy"><strong>{row.title}</strong><ControlTooltip content={`Running ${row.title} ${row.version}. ${row.source==='bundled'?'Included with this zQ release.':'Loaded from a signed module update.'}`}><span tabIndex={0}>{row.version}{row.source==='bundled'?' · Included with zQ':''}</span></ControlTooltip>{row.pendingVersion&&<ControlTooltip content="This signed update will activate after you quit and reopen zQ"><small tabIndex={0} className="module-update-pending">{row.pendingVersion} ready for next launch</small></ControlTooltip>}{row.error&&<small className="module-update-error" role="alert">{row.error}</small>}</div>
  <DropdownMenu><DropdownMenuTrigger asChild><Button ref={actionsRef} variant="ghost" size="icon" className="settings-more-button" aria-label={`Actions for ${row.title}`} disabled={disabled}><DotsThree size={20}/></Button></DropdownMenuTrigger><DropdownMenuContent align="end" onCloseAutoFocus={closeMenu}>
   <DropdownMenuItem disabled={rollbackDisabled} onSelect={onRollback}><ArrowCounterClockwise size={15}/>Roll back {row.title}</DropdownMenuItem>
   <DropdownMenuItem disabled={disabled} onSelect={()=>download(actionsRef.current)}><DownloadSimple size={15}/>Install update from URL…</DropdownMenuItem>
  </DropdownMenuContent></DropdownMenu>
 </div></ContextMenuTrigger><ContextMenuContent onCloseAutoFocus={closeMenu}>
  <ContextMenuItem disabled={rollbackDisabled} onSelect={onRollback}><ArrowCounterClockwise size={15}/>Roll back {row.title}</ContextMenuItem>
  <ContextMenuItem disabled={disabled} onSelect={()=>download(rowRef.current)}><DownloadSimple size={15}/>Install update from URL…</ContextMenuItem>
 </ContextMenuContent></ContextMenu>
}

export default function ModuleSettings({closing}:{closing:boolean}){
 const [rows,setRows]=useState<ModuleStatus[]>([]),[loading,setLoading]=useState(true),[listError,setListError]=useState('')
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState(''),[download,setDownload]=useState(false),[url,setUrl]=useState('')
 const busyRef=useRef(false),installRef=useRef<HTMLButtonElement>(null),dialogOpener=useRef<HTMLElement|null>(null),openingDialog=useRef(false)
 const load=useCallback(async()=>{
  setLoading(true);setListError('')
  try{setRows(await unwrap(window.zq.modules.list()))}catch(e){setListError((e as Error).message)}finally{setLoading(false)}
 },[])
 useEffect(()=>{void load()},[load])
 function openDownload(opener:HTMLElement|null){if(busyRef.current||closing)return;dialogOpener.current=opener;setError('');setDownload(true)}
 async function action(kind:'install'|'download'|'rollback',id?:string){
  if(busyRef.current||closing)return
  busyRef.current=true;setBusy(true);setError('');setMessage('')
  try{
   const result=await unwrap(kind==='rollback'?window.zq.modules.rollback(id!):kind==='download'?window.zq.modules.download(url.trim()):window.zq.modules.install())
   if(result){
    setMessage(`${result.title} ${result.pendingVersion??result.version} is ready. Quit and reopen zQ to apply it.`)
    await load();setDownload(false);setUrl('')
   }
  }catch(e){setError((e as Error).message)}finally{busyRef.current=false;setBusy(false)}
 }
 const disabled=closing||busy||loading
 return <section id="modules">
  <div className="settings-panel-header module-settings-heading"><div><h2>Modules</h2><p>Manage installed modules and updates.</p></div>
   <DropdownMenu><DropdownMenuTrigger asChild><Button tooltip="Choose a signed module update from a file or HTTPS link" ref={installRef} variant="outline" disabled={disabled}><Package size={16}/>Install update…<CaretDown size={13}/></Button></DropdownMenuTrigger><DropdownMenuContent align="end" onCloseAutoFocus={event=>{if(openingDialog.current){event.preventDefault();openingDialog.current=false}}}>
    <DropdownMenuItem disabled={disabled} onSelect={()=>void action('install')}><Package size={15}/>From file…</DropdownMenuItem>
    <DropdownMenuItem disabled={disabled} onSelect={()=>{openingDialog.current=true;openDownload(installRef.current)}}><DownloadSimple size={15}/>From URL…</DropdownMenuItem>
   </DropdownMenuContent></DropdownMenu>
  </div>
  <div className="module-version-list" aria-busy={loading}>
   {loading&&rows.length===0&&<p className="settings-muted" role="status">Loading modules…</p>}
   {rows.map(row=><ModuleRow key={row.id} row={row} disabled={disabled} onRollback={()=>void action('rollback',row.id)} onDownload={openDownload}/>)}
   {!loading&&!listError&&rows.length===0&&<p className="settings-muted">No modules are installed.</p>}
  </div>
  {listError&&<div className="module-update-error" role="alert"><p>Couldn’t load modules. {listError}</p><Button tooltip="Reload the installed module list" variant="outline" disabled={disabled} onClick={()=>void load()}>Retry</Button></div>}
  {message&&<p className="module-update-status" role="status">{message}</p>}{error&&!download&&<p className="module-update-error" role="alert">{error}</p>}
  <p className="settings-panel-footer">Updates take effect after restarting zQ.</p>
  <Dialog open={download} onOpenChange={open=>{if(!busyRef.current&&!closing)setDownload(open)}}><DialogContent showCloseButton={!busy&&!closing} onCloseAutoFocus={event=>{event.preventDefault();const opener=dialogOpener.current?.isConnected?dialogOpener.current:installRef.current;opener?.focus()}}><DialogTitle>Download module update</DialogTitle><DialogDescription>Paste the HTTPS link to a signed zQ module package.</DialogDescription>
   <form onSubmit={e=>{e.preventDefault();void action('download')}}><Input aria-label="Module update URL" type="url" placeholder="https://…/chat.zqmodule" value={url} onChange={e=>setUrl(e.target.value)} required disabled={busy||closing}/>{error&&<p role="alert" className="module-update-error">{error}</p>}<div className="dialog-actions"><Button tooltip="Close without downloading an update" type="button" variant="ghost" disabled={busy||closing} onClick={()=>setDownload(false)}>Cancel</Button><Button tooltip={!url.trim()?"Enter an HTTPS link to a signed module package":"Download and verify the update for the next launch"} type="submit" disabled={busy||closing||!url.trim()}>{busy?'Downloading…':'Download update'}</Button></div></form>
  </DialogContent></Dialog>
 </section>
}
