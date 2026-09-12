import { NoteMenuItems } from '@zq/ui'
import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { FileText, Plus, X, ArrowLeft, ArrowRight } from '@phosphor-icons/react'
import { ContextMenu, ContextMenuTrigger, ContextMenuContent, ContextMenuItem, ContextMenuSeparator } from '@zq/ui'
import { openTab, closeTabs, moveTab, type TabState, type CloseMode } from './tab-state'

export type TabDocument={key:string;title:string;path?:string;dirty?:boolean;note?:{id:string;title:string;pinned:boolean}}
type Props={state:TabState;documents:TabDocument[];onChange:Dispatch<SetStateAction<TabState>>;onNew:()=>void;onRenameNote:(id:string)=>void;onToggleNotePin:(id:string)=>void;disabled?:boolean}
export default function WorkspaceTabs({state,documents,onChange,onNew,onRenameNote,onToggleNotePin,disabled=false}:Props){
 const buttons=useRef(new Map<string,HTMLButtonElement>())
 const elements=useRef(new Map<string,HTMLDivElement>())
 const gesture=useRef<{key:string;x:number;y:number;moving:boolean;target:{key:string;side:'before'|'after'}|null}|null>(null)
 const suppressClick=useRef(false)
 const openingDialog=useRef(false)
 const [drop,setDrop]=useState<{key:string;side:'before'|'after'}|null>(null)
 const [announcement,setAnnouncement]=useState('')
 useEffect(()=>{buttons.current.get(state.active??'')?.scrollIntoView({block:'nearest',inline:'nearest'})},[state.active,state.order])
 useEffect(()=>{if(disabled){gesture.current=null;setDrop(null)}},[disabled])
 function select(key:string){if(!disabled)onChange(s=>openTab(s,key))}
 function close(key:string,mode:CloseMode){
  if(disabled)return
  onChange(s=>closeTabs(s,key,mode))
  setAnnouncement(mode==='one'?'Tab closed. Content is kept.':'Tabs closed. Content is kept.')
 }
 function shift(key:string,direction:-1|1){
  const target=state.order[state.order.indexOf(key)+direction]
  if(disabled||!target)return
  onChange(s=>moveTab(s,key,target,direction===-1?'before':'after'))
  setAnnouncement(`Tab moved ${direction===-1?'left':'right'}.`)
 }
 function pointerMove(e:{clientX:number;clientY:number}){
  const drag=gesture.current
  if(!drag||disabled)return
  if(!drag.moving&&Math.hypot(e.clientX-drag.x,e.clientY-drag.y)<5)return
  if(!drag.moving)setAnnouncement('Moving tab. Drop between tabs.')
  drag.moving=true
  const strip=buttons.current.get(drag.key)?.closest('.workspace-tabs') as HTMLElement|null
  if(strip){
   const rect=strip.getBoundingClientRect()
   if(e.clientX<rect.left+32)strip.scrollLeft-=16
   if(e.clientX>rect.right-32)strip.scrollLeft+=16
  }
  drag.target=null
  for(const [key,element] of elements.current){
   const rect=element.getBoundingClientRect()
   if(e.clientY>=rect.top-16&&e.clientY<=rect.bottom+16&&e.clientX>=rect.left&&e.clientX<=rect.right){
    drag.target={key,side:e.clientX<rect.left+rect.width/2?'before':'after'};break
   }
  }
  setDrop(drag.target)
 }
 function pointerEnd(e:globalThis.PointerEvent,cancelled=false){
  if(!cancelled)pointerMove(e)
  const drag=gesture.current
  gesture.current=null;setDrop(null)
  const button=buttons.current.get(drag?.key??'')
  if(button?.hasPointerCapture(e.pointerId))button.releasePointerCapture(e.pointerId)
  if(!drag?.moving)return
  suppressClick.current=true
  if(!cancelled&&!disabled&&drag.target){
   const {key,target}=drag
   onChange(s=>moveTab(s,key,target.key,target.side))
   setAnnouncement('Tab reordered.')
  }else setAnnouncement('Tab move cancelled.')
 }
 useEffect(()=>{
  const up=(event:globalThis.PointerEvent)=>pointerEnd(event)
  const cancel=(event:globalThis.PointerEvent)=>pointerEnd(event,true)
  const blur=()=>{gesture.current=null;setDrop(null)}
  window.addEventListener('pointerup',up,true)
  window.addEventListener('pointercancel',cancel,true)
  window.addEventListener('blur',blur)
  return()=>{window.removeEventListener('pointerup',up,true);window.removeEventListener('pointercancel',cancel,true);window.removeEventListener('blur',blur)}
 },[disabled,onChange])
 return <><div className="tab-scroll workspace-tabs" role="tablist" aria-label="Open documents">
  {state.order.map((key,index)=>{
   const doc=documents.find(d=>d.key===key)
   if(!doc)return null
   return <ContextMenu key={key}><ContextMenuTrigger asChild disabled={disabled}>
    <div className={`tab ${state.active===key?'selected':''} ${drop?.key===key?`tab-drop-${drop.side}`:''}`}
     ref={node=>{if(node)elements.current.set(key,node);else elements.current.delete(key)}}
     onAuxClick={e=>{if(e.button===1){e.preventDefault();close(key,'one')}}}>
     <button type="button" draggable={false} role="tab" aria-selected={state.active===key} aria-label={doc.title+(doc.dirty?' — unsaved file changes':'')} title={doc.path??doc.title} tabIndex={state.active===key?0:-1} disabled={disabled}
      ref={node=>{if(node)buttons.current.set(key,node);else buttons.current.delete(key)}} onClick={()=>{if(suppressClick.current){suppressClick.current=false;return}select(key)}}
      onDoubleClick={()=>{if(doc.note&&!disabled)onRenameNote(doc.note.id)}}
      onDragStart={e=>e.preventDefault()}
      onPointerDown={e=>{if(disabled||e.button!==0||e.ctrlKey)return;suppressClick.current=false;gesture.current={key,x:e.clientX,y:e.clientY,moving:false,target:null};e.currentTarget.setPointerCapture(e.pointerId)}}
      onPointerMove={pointerMove}
      onKeyDown={e=>{
       if(e.key==='F2'&&doc.note){e.preventDefault();onRenameNote(doc.note.id);return}
       if(e.altKey&&e.shiftKey&&(e.key==='ArrowLeft'||e.key==='ArrowRight')){e.preventDefault();shift(key,e.key==='ArrowLeft'?-1:1);return}
       const target=e.key==='ArrowRight'?state.order[(index+1)%state.order.length]:e.key==='ArrowLeft'?state.order[(index-1+state.order.length)%state.order.length]:e.key==='Home'?state.order[0]:e.key==='End'?state.order.at(-1):null
       if(target){e.preventDefault();select(target);buttons.current.get(target)?.focus()}
       if(e.key==='Delete'){e.preventDefault();close(key,'one');requestAnimationFrame(()=>{const next=state.order[index+1]??state.order[index-1];if(next)buttons.current.get(next)?.focus()})}
      }}><FileText size={14}/><span className="tab-title">{doc.title}</span>{doc.dirty&&<span aria-hidden="true">•</span>}</button>
     <button type="button" className="tab-close" aria-label={`Close tab ${doc.title}`} tabIndex={-1} disabled={disabled} draggable={false} onPointerDown={e=>e.stopPropagation()} onClick={()=>close(key,'one')}><X size={12}/></button>
    </div>
   </ContextMenuTrigger>{!disabled&&<ContextMenuContent aria-label={`Tab actions for ${doc.title}`} onCloseAutoFocus={e=>{e.preventDefault();if(openingDialog.current){openingDialog.current=false;return}if(buttons.current.has(key))buttons.current.get(key)?.focus()}}>
    {doc.note&&<><NoteMenuItems note={doc.note} onRename={id=>{openingDialog.current=true;onRenameNote(id)}} onTogglePin={onToggleNotePin}/><ContextMenuSeparator/></>}
    <ContextMenuItem onSelect={()=>close(key,'one')}>Close tab</ContextMenuItem>
    <ContextMenuItem disabled={state.order.length<2} onSelect={()=>close(key,'others')}>Close other tabs</ContextMenuItem>
    <ContextMenuItem disabled={index===state.order.length-1} onSelect={()=>close(key,'right')}>Close tabs to the right</ContextMenuItem>
    <ContextMenuItem onSelect={()=>close(key,'all')}>Close all tabs</ContextMenuItem>
    <ContextMenuSeparator/>
    <ContextMenuItem disabled={index===0} onSelect={()=>shift(key,-1)}><ArrowLeft size={14}/>Move left</ContextMenuItem>
    <ContextMenuItem disabled={index===state.order.length-1} onSelect={()=>shift(key,1)}><ArrowRight size={14}/>Move right</ContextMenuItem>
   </ContextMenuContent>}</ContextMenu>
  })}
  <button type="button" className="icon-button new-tab" aria-label="Open new scratchpad" title="New scratchpad" onClick={onNew} disabled={disabled}><Plus size={15}/></button>
 </div><span className="sr-only" role="status">{announcement}</span></>
}
