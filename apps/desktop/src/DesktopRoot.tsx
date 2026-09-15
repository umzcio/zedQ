import {TooltipButton} from '@zq/ui'
import { useCallback, useEffect, useRef, useState } from 'react'
import App from './App'
import type { LoadedModule } from './module-loader'
import { flushSync } from 'react-dom'
import { freshWorkspace, unwrap, projectWorkspaceDraft, type WorkspaceDraftIssue, type WorkspaceState, type FileDocument } from '@zq/module-api'

export default function DesktopRoot({modules}:{modules:LoadedModule[]}){
 const [loaded,setLoaded]=useState<{workspace:WorkspaceState;files:FileDocument[]}|null>(null)
 const [error,setError]=useState('')
 const [status,setStatus]=useState('Saved on this Mac')
 const [closing,setClosing]=useState(false)
 const [draftIssues,setDraftIssues]=useState<WorkspaceDraftIssue[]>([])
 const accepted=useRef<WorkspaceState|null>(null),issuesRef=useRef<WorkspaceDraftIssue[]>([])
 const latest=useRef<WorkspaceState|null>(null)
 const fileDrafts=useRef<FileDocument[]>([])
 const fileFlush=useRef<(()=>Promise<void>)|null>(null)
 const activeClose=useRef<string|null>(null)
 const revision=useRef(0)
 const pending=useRef<Promise<unknown>>(Promise.resolve())
 useEffect(()=>{
  if(!window.zq){setError('Open zQ as a desktop app to access your local workspace.');return}
  let mounted=true
  Promise.all([unwrap(window.zq.workspace.load()),unwrap(window.zq.files.list())]).then(([workspace,files])=>{
   if(!mounted)return
   const state=workspace??freshWorkspace(); accepted.current=state;latest.current=state;fileDrafts.current=files;setLoaded({workspace:state,files})
  }).catch(e=>{if(mounted)setError(e.message)})
  return()=>{mounted=false}
 },[])
 const save=useCallback((snapshot:WorkspaceState)=>{
  const projected=projectWorkspaceDraft(snapshot,accepted.current??snapshot)
  accepted.current=projected.state;latest.current=projected.state;issuesRef.current=projected.issues;setDraftIssues(projected.issues)
  const sequence=++revision.current
  setStatus('Saving…')
  pending.current=pending.current.catch(()=>{}).then(()=>unwrap(window.zq.workspace.save(projected.state)))
  pending.current.then(()=>{if(sequence===revision.current)setStatus(issuesRef.current.length?'Valid changes saved · drafts need attention':'Saved on this Mac')},()=>{if(sequence===revision.current)setStatus('Unable to save — keep zQ open')})
 },[])
 const flushWorkspace=useCallback(async()=>{await pending.current.catch(()=>{});if(issuesRef.current.length)throw Error(issuesRef.current[0].message+' Review edits before closing.');if(!latest.current)throw Error('Workspace is not ready.');await unwrap(window.zq.workspace.save(latest.current))},[])
 const registerFileFlush=useCallback((flush:()=>Promise<void>)=>{fileFlush.current=flush},[])
 const trackFiles=useCallback((files:FileDocument[])=>{fileDrafts.current=files},[])
 useEffect(()=>window.zq?.onCloseCancelled(id=>{if(activeClose.current===id){activeClose.current=null;setClosing(false)}}),[])
 useEffect(()=>window.zq?.onCloseRequested(async id=>{
  activeClose.current=id
  flushSync(()=>setClosing(true))
  try {
   if(!latest.current) throw new Error(error||'The workspace has not finished opening.')
   await pending.current.catch(()=>{})
   if(issuesRef.current.length)throw Error(issuesRef.current[0].message+' Review edits before closing.')
   await unwrap(window.zq.workspace.save(latest.current))
   if(fileFlush.current)await fileFlush.current()
   else if(fileDrafts.current.length)throw new Error('File recovery is not ready.')
   if(activeClose.current===id)window.zq.finishClose(id)
  }catch(e){if(activeClose.current===id){setClosing(false);window.zq.finishClose(id,e instanceof Error?e.message:'Could not save the latest changes.')}}
 }),[error])
 if(error)return <div className="startup-state"><h1>Couldn’t open your workspace</h1><p>{error}</p><p>Your saved files have not been reset.</p><TooltipButton tooltip="Try opening your saved workspace again" onClick={()=>location.reload()}>Try again</TooltipButton></div>
 if(!loaded)return <div className="startup-state" role="status">Opening zQ…</div>
 return <><div inert={closing}><App draftIssues={draftIssues} modules={modules} onWorkspaceFlush={flushWorkspace} closing={closing} onFileFlush={registerFileFlush} initialState={loaded.workspace} initialFiles={loaded.files} onSnapshot={save} onFilesChange={trackFiles} saveStatus={status}/></div>{closing&&<div className="closing-overlay" role="status">Saving your workspace…</div>}</>
}
