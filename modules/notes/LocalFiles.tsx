import { useHost } from '@zq/module-api'
import { useState, useLayoutEffect, useSyncExternalStore } from 'react'
import { FloppyDisk, FolderOpen, ArrowClockwise } from '@phosphor-icons/react'
import { unwrap, type FileDocument } from '@zq/module-api'
import { FileController } from './file-controller'

export function useLocalFiles(initial:FileDocument[],onChange:(files:FileDocument[])=>void){
 const {services}=useHost()
 const [controller]=useState(()=>new FileController(initial,{
  open:()=>unwrap(services.files.open()),
  edit:(id,body)=>unwrap(services.files.edit(id,body)),
  save:id=>unwrap(services.files.save(id)),
  saveAs:id=>unwrap(services.files.saveAs(id)),
  reload:id=>unwrap(services.files.reload(id)),
 }))
 const snapshot=useSyncExternalStore(controller.subscribe,controller.getSnapshot)
 useLayoutEffect(()=>{onChange(snapshot.files)},[snapshot.files,onChange])
 async function open(){try{return await controller.open()}catch{return null}}
 async function action(id:string,kind:'save'|'saveAs'|'reload'){try{return await controller.action(id,kind)}catch{return null}}
 return {...snapshot,open,edit:controller.edit,action,flush:controller.flush}
}
export function LocalFileEditor({file,error,status,busy,onEdit,onAction}:{file:FileDocument;error:string;status:string;busy:boolean;onEdit:(body:string)=>void;onAction:(kind:'save'|'saveAs'|'reload')=>void}){
 const dirty=file.body!==file.savedBody
 return <div className="editor-pane local-file-editor" aria-busy={busy}><div className="editor-toolbar"><div className="breadcrumb file-path" title={file.path}><FolderOpen size={15}/><span>{file.path}</span></div><div className="toolbar-actions"><button disabled={busy} className="file-action" onClick={()=>onAction('save')}><FloppyDisk size={16}/>Save</button><button disabled={busy} className="file-action" onClick={()=>onAction('saveAs')}>Save as…</button><button disabled={busy} className="icon-button" aria-label="Reload file from disk" title="Reload from disk" onClick={()=>onAction('reload')}><ArrowClockwise size={16}/></button></div></div>{(error||file.warning)&&<div className="file-error" role="alert">{error||file.warning}<span>Your recovery draft is kept. Save a copy or reload the disk version.</span></div>}<textarea className="local-file-body" aria-label="Local file contents" readOnly={busy} value={file.body} onChange={e=>onEdit(e.target.value)} spellCheck={false}/><footer className="editor-footer"><span>UTF-8 · Local file</span><span>{dirty?(status||'Recovery draft saved — file has unsaved changes'):'Saved to file'}{dirty&&status==='Recovery draft saved'?' · ⌘S to save file':''}</span></footer></div>
}
