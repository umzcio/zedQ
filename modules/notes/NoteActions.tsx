import { useRef, useState, type ReactElement } from 'react'
import { PencilSimple, PushPin, ArrowSquareOut } from '@phosphor-icons/react'
import { ContextMenu, ContextMenuTrigger, ContextMenuContent, ContextMenuItem, ContextMenuSeparator } from '@zq/ui'
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@zq/ui'
import { Input } from '@zq/ui'
import { Button } from '@zq/ui'
import type { Note } from '@zq/module-api'

export function RenameNoteDialog({note,onClose,onSave,disabled=false}:{note:Pick<Note,'id'|'title'>;onClose:()=>void;onSave:(id:string,title:string)=>void;disabled?:boolean}){
 const [title,setTitle]=useState(note.title)
 const input=useRef<HTMLInputElement>(null)
 return <Dialog open onOpenChange={open=>{if(!open)onClose()}}><DialogContent inert={disabled} className="rename-note-dialog" onOpenAutoFocus={event=>{event.preventDefault();input.current?.focus();input.current?.select()}}>
  <DialogTitle>Rename note</DialogTitle><DialogDescription>Give this note a name you’ll recognize.</DialogDescription>
  <form onSubmit={event=>{event.preventDefault();if(!disabled&&title.trim())onSave(note.id,title.trim())}}>
   <label htmlFor="rename-note-title">Name</label><Input ref={input} id="rename-note-title" aria-label="Note name" value={title} maxLength={1024} onChange={event=>setTitle(event.target.value)} disabled={disabled}/>
   <div className="dialog-actions"><Button title="Close without renaming the note" type="button" variant="ghost" onClick={onClose} disabled={disabled}>Cancel</Button><Button title={title.trim()?'Save this note name':'Enter a name to rename the note'} type="submit" className="primary-button" disabled={disabled||!title.trim()}>Rename</Button></div>
  </form>
 </DialogContent></Dialog>
}
