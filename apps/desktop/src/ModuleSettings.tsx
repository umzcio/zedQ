import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import ModulePendingVersion,{type PendingCue} from './ModulePendingVersion'
import { unwrap, type ModuleStatus } from '@zq/module-api'
import {
 ControlTooltip, Button, Input, Dialog, DialogContent, DialogTitle, DialogDescription,
 ContextMenu, ContextMenuTrigger, ContextMenuContent, ContextMenuItem,
 DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
} from '@zq/ui'
import { ArrowCounterClockwise, CaretDown, ChatCircle, DotsThree, DownloadSimple, House, Kanban, NotePencil, Package } from '@phosphor-icons/react'

function ModuleRow({row,disabled,onRollback,onDownload,cue,cueReady,consume}:{row:ModuleStatus;disabled:boolean;onRollback:()=>void;onDownload:(opener:HTMLElement|null)=>void;cue?:PendingCue;cueReady:boolean;consume:(generation:number)=>void}){
 const rowRef=useRef<HTMLDivElement>(null),actionsRef=useRef<HTMLButtonElement>(null),openingDialog=useRef(false)
 const Icon=({'zq.hq':House,'zq.notes':NotePencil,'zq.tasks':Kanban,'zq.chat':ChatCircle}[row.id])??Package
 const rollbackDisabled=disabled||(!row.previousVersion&&row.source==='bundled'&&!row.pendingVersion)
 function download(opener:HTMLElement|null){openingDialog.current=true;onDownload(opener)}
 function closeMenu(event:Event){if(openingDialog.current){event.preventDefault();openingDialog.current=false}}
 return <ContextMenu><ContextMenuTrigger asChild><div ref={rowRef} className="settings-resource-row module-version-row" tabIndex={0}>
  <span className="settings-resource-icon"><Icon size={20} weight="light"/></span>
  <div className="settings-resource-copy"><strong>{row.title}</strong><ControlTooltip content={`Running ${row.title} ${row.version}. ${row.source==='bundled'?'Included with this zQ release.':'Loaded from a signed module update.'}`}><span style={{alignSelf:'flex-start',width:'fit-content'}} tabIndex={0}>{row.version}{row.source==='bundled'?' · Included with zQ':''}</span></ControlTooltip>{row.pendingVersion&&<ModulePendingVersion version={row.pendingVersion} cue={cue} ready={cueReady} consume={consume}/>}{row.error&&<small className="module-update-error" role="alert">{row.error}</small>}</div>
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
 const [cue,setCue]=useState<PendingCue>(),[dialogPresent,setDialogPresent]=useState(false)
 const sectionRef=useRef<HTMLElement>(null),visibilityEpoch=useRef(0)
 const generation=useRef(0),loadGeneration=useRef(0),mounted=useRef(false),rowsRef=useRef(rows),filePointer=useRef(false),submitPointer=useRef(false)
 const consume=useCallback((token:number)=>setCue(old=>old?.generation===token?undefined:old),[])
 const dialogNode=useCallback((node:HTMLDivElement|null)=>setDialogPresent(!!node),[])
 useLayoutEffect(()=>{rowsRef.current=rows},[rows])
 useLayoutEffect(()=>{mounted.current=true;return()=>{mounted.current=false;++generation.current;++loadGeneration.current}},[])
 useLayoutEffect(()=>{if(closing){++visibilityEpoch.current;setCue(undefined)}},[closing])
 useEffect(()=>{
  const hidden=()=>{if(document.hidden||!sectionRef.current?.getClientRects().length||sectionRef.current.closest('[hidden],[inert]')){++visibilityEpoch.current;setCue(undefined)}}
  const observer=new MutationObserver(hidden)
  for(let node:HTMLElement|null=sectionRef.current;node;node=node.parentElement)observer.observe(node,{attributes:true,attributeFilter:['hidden','inert','style','class']})
  document.addEventListener('visibilitychange',hidden)
  return()=>{observer.disconnect();document.removeEventListener('visibilitychange',hidden)}
 },[])
 const load=useCallback(async()=>{
  const token=++loadGeneration.current
  setLoading(true);setListError('')
  try{const next=await unwrap(window.zq.modules.list());if(mounted.current&&token===loadGeneration.current)setRows(next);return next}catch(e){if(mounted.current&&token===loadGeneration.current)setListError((e as Error).message);return null}finally{if(mounted.current&&token===loadGeneration.current)setLoading(false)}
 },[])
 useEffect(()=>{void load()},[load])
 function openDownload(opener:HTMLElement|null){if(busyRef.current||closing)return;submitPointer.current=false;dialogOpener.current=opener;setError('');setDownload(true)}
 async function action(kind:'install'|'download'|'rollback',id?:string,pointer=false){
  if(busyRef.current||closing)return
  const token=++generation.current,before=rowsRef.current,visibleAtStart=visibilityEpoch.current
  busyRef.current=true;setBusy(true);setError('');setMessage('');setCue(undefined)
  try{
   const result=await unwrap(kind==='rollback'?window.zq.modules.rollback(id!):kind==='download'?window.zq.modules.download(url.trim()):window.zq.modules.install())
   if(!mounted.current||token!==generation.current)return
   if(result){
    setMessage(`${result.title} ${result.pendingVersion??result.version} is ready. Quit and reopen zQ to apply it.`)
    const next=await load()
    if(!mounted.current||token!==generation.current)return
    const pending=result.pendingVersion
    if(pointer&&visibleAtStart===visibilityEpoch.current&&document.visibilityState==='visible'&&kind!=='rollback'&&pending&&before.find(row=>row.id===result.id)?.pendingVersion!==pending&&next?.find(row=>row.id===result.id)?.pendingVersion===pending)setCue({id:result.id,version:pending,generation:token})
    setDownload(false);setUrl('')
   }
  }catch(e){if(mounted.current&&token===generation.current)setError((e as Error).message)}finally{if(mounted.current&&token===generation.current){busyRef.current=false;setBusy(false)}}
 }
 const disabled=closing||busy||loading
 return <section id="modules" ref={sectionRef}>
  <div className="settings-panel-header module-settings-heading"><div><h2>Modules</h2><p>Manage installed modules and updates.</p></div>
   <DropdownMenu onOpenChange={()=>{filePointer.current=false}}><DropdownMenuTrigger asChild><Button tooltip="Choose a signed module update from a file or HTTPS link" ref={installRef} variant="outline" disabled={disabled}><Package size={16}/>Install update…<CaretDown size={13}/></Button></DropdownMenuTrigger><DropdownMenuContent align="end" onKeyDownCapture={()=>{filePointer.current=false}} onCloseAutoFocus={event=>{if(openingDialog.current){event.preventDefault();openingDialog.current=false}}}>
    <DropdownMenuItem disabled={disabled} onClickCapture={event=>{filePointer.current=event.detail>0}} onSelect={()=>{const pointer=filePointer.current;filePointer.current=false;void action('install',undefined,pointer)}}><Package size={15}/>From file…</DropdownMenuItem>
    <DropdownMenuItem disabled={disabled} onSelect={()=>{openingDialog.current=true;openDownload(installRef.current)}}><DownloadSimple size={15}/>From URL…</DropdownMenuItem>
   </DropdownMenuContent></DropdownMenu>
  </div>
  <div className="module-version-list" aria-busy={loading}>
   {loading&&rows.length===0&&<p className="settings-muted" role="status">Loading modules…</p>}
   {rows.map(row=><ModuleRow key={row.id} row={row} disabled={disabled} onRollback={()=>void action('rollback',row.id)} onDownload={openDownload} cue={cue?.id===row.id&&cue.version===row.pendingVersion?cue:undefined} cueReady={!dialogPresent} consume={consume}/>)}
   {!loading&&!listError&&rows.length===0&&<p className="settings-muted">No modules are installed.</p>}
  </div>
  {listError&&<div className="module-update-error" role="alert"><p>Couldn’t load modules. {listError}</p><Button tooltip="Reload the installed module list" variant="outline" disabled={disabled} onClick={()=>void load()}>Retry</Button></div>}
  {message&&<p className="module-update-status" role="status">{message}</p>}{error&&!download&&<p className="module-update-error" role="alert">{error}</p>}
  <p className="settings-panel-footer">Updates take effect after restarting zQ.</p>
  <Dialog open={download} onOpenChange={open=>{if(!busyRef.current&&!closing)setDownload(open)}}><DialogContent ref={dialogNode} showCloseButton={!busy&&!closing} onCloseAutoFocus={event=>{event.preventDefault();const opener=dialogOpener.current?.isConnected?dialogOpener.current:installRef.current;opener?.focus()}}><DialogTitle>Download module update</DialogTitle><DialogDescription>Paste the HTTPS link to a signed zQ module package.</DialogDescription>
   <form onInvalidCapture={()=>{submitPointer.current=false}} onKeyDownCapture={()=>{submitPointer.current=false}} onSubmit={e=>{e.preventDefault();const pointer=submitPointer.current;submitPointer.current=false;void action('download',undefined,pointer)}}><Input aria-label="Module update URL" type="url" placeholder="https://…/chat.zqmodule" value={url} onChange={e=>setUrl(e.target.value)} required disabled={busy||closing}/>{error&&<p role="alert" className="module-update-error">{error}</p>}<div className="dialog-actions"><Button tooltip="Close without downloading an update" type="button" variant="ghost" disabled={busy||closing} onClick={()=>setDownload(false)}>Cancel</Button><Button tooltip={!url.trim()?"Enter an HTTPS link to a signed module package":"Download and verify the update for the next launch"} type="submit" onClickCapture={event=>{submitPointer.current=event.detail>0}} disabled={busy||closing||!url.trim()}>{busy?'Downloading…':'Download update'}</Button></div></form>
  </DialogContent></Dialog>
 </section>
}
