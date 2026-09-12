import { useRef, useState, type ReactElement } from 'react'
import { PencilSimple, PushPin, ArrowSquareOut } from '@phosphor-icons/react'
import { ContextMenu, ContextMenuTrigger, ContextMenuContent, ContextMenuItem, ContextMenuSeparator } from './index'
import { Dialog, DialogContent, DialogTitle, DialogDescription } from './index'
import { Input } from './index'
import { Button } from './index'
import type { Note } from '@zq/module-api'

type Actions={note:Pick<Note,'id'|'title'|'pinned'>;onRename:(id:string)=>void;onTogglePin:(id:string)=>void}
export function NoteMenuItems({note,onRename,onTogglePin}:Actions){
 return <><ContextMenuItem onSelect={()=>onRename(note.id)}><PencilSimple size={14}/>Rename…</ContextMenuItem><ContextMenuItem onSelect={()=>onTogglePin(note.id)}><PushPin size={14}/>{note.pinned?'Unpin note':'Pin note'}</ContextMenuItem></>
}
export function NoteContextMenu({note,onRename,onTogglePin,onOpen,disabled=false,children}:Actions&{onOpen:(id:string)=>void;disabled?:boolean;children:ReactElement}){
 const openingDialog=useRef(false)
 return <ContextMenu><ContextMenuTrigger asChild disabled={disabled}>{children}</ContextMenuTrigger>{!disabled&&<ContextMenuContent aria-label={`Note actions for ${note.title||'Untitled'}`} onCloseAutoFocus={event=>{if(openingDialog.current){event.preventDefault();openingDialog.current=false}}}>
  <ContextMenuItem onSelect={()=>onOpen(note.id)}><ArrowSquareOut size={14}/>Open note</ContextMenuItem>
  <ContextMenuSeparator/>
  <NoteMenuItems note={note} onRename={id=>{openingDialog.current=true;onRename(id)}} onTogglePin={onTogglePin}/>
 </ContextMenuContent>}</ContextMenu>
}
