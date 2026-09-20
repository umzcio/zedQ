import { TooltipButton } from '@zq/ui'
import { NoteMenuItems } from '@zq/ui'
import { useEffect, useLayoutEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { FileText, Plus, X, ArrowLeft, ArrowRight } from '@phosphor-icons/react'
import { ContextMenu, ContextMenuTrigger, ContextMenuContent, ContextMenuItem, ContextMenuSeparator } from '@zq/ui'
import { edgeScrollPosition } from './tab-edge-scroll'
import { openTab, closeTabs, moveTab, type TabState, type CloseMode } from './tab-state'

export type TabDocument={key:string;title:string;path?:string;dirty?:boolean;note?:{id:string;title:string;pinned:boolean}}
type Props={state:TabState;documents:TabDocument[];onChange:Dispatch<SetStateAction<TabState>>;onNew:()=>void;onRenameNote:(id:string)=>void;onToggleNotePin:(id:string)=>void;disabled?:boolean}
export default function WorkspaceTabs({state,documents,onChange,onNew,onRenameNote,onToggleNotePin,disabled=false}:Props){
 const buttons=useRef(new Map<string,HTMLButtonElement>())
 const elements=useRef(new Map<string,HTMLDivElement>())
 type DropTarget={key:string;side:'before'|'after'}|null
 const gesture=useRef<{key:string;pointerId:number;button:HTMLButtonElement;x:number;y:number;latestX:number;latestY:number;moving:boolean;target:DropTarget}|null>(null)
 const frameId=useRef<number|null>(null)
 const previousTime=useRef<number|null>(null)
 const latest=useRef({disabled,onChange})
 const suppressClick=useRef(false)
 const openingDialog=useRef(false)
 const [drop,setDrop]=useState<{key:string;side:'before'|'after'}|null>(null)
 const [announcement,setAnnouncement]=useState('')
 useEffect(()=>{buttons.current.get(state.active??'')?.scrollIntoView({block:'nearest',inline:'nearest'})},[state.active,state.order])
 useLayoutEffect(()=>{
  latest.current={disabled,onChange}
  const drag=gesture.current
  if(drag&&(disabled||!state.order.includes(drag.key)||!documents.some(doc=>doc.key===drag.key)))cancelDrag()
 },[disabled,onChange,state.order,documents])
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
 function clearGesture(updateDrop=true){
  if(frameId.current!==null)cancelAnimationFrame(frameId.current)
  frameId.current=null;previousTime.current=null
  const drag=gesture.current
  gesture.current=null
  if(drag?.button.hasPointerCapture(drag.pointerId))drag.button.releasePointerCapture(drag.pointerId)
  if(updateDrop)setDrop(null)
  return drag
 }
 function cancelDrag(updateDrop=true){
  const drag=clearGesture(updateDrop)
  if(drag?.moving){
   suppressClick.current=true
   if(updateDrop)setAnnouncement('Tab move cancelled.')
  }
 }
 function updateTarget(elapsed:number){
  const drag=gesture.current
  if(!drag?.moving)return
  const strip=drag.button.closest('.workspace-tabs') as HTMLElement|null
  if(latest.current.disabled||!strip?.isConnected||!elements.current.has(drag.key)){cancelDrag();return}
  // Read the geometry together before writing scrollLeft. Shift these cached
  // rectangles by the clamped delta instead of forcing layout after the write.
  const bounds=strip.getBoundingClientRect()
  const scrollLeft=strip.scrollLeft
  const maxScroll=strip.scrollWidth-strip.clientWidth
  const rectangles=[...elements.current].map(([key,element])=>({key,rect:element.getBoundingClientRect()}))
  const nextScroll=edgeScrollPosition(bounds,scrollLeft,maxScroll,{x:drag.latestX,y:drag.latestY},elapsed)
  const delta=nextScroll-scrollLeft
  let target:DropTarget=null
  if(drag.latestX>=bounds.left&&drag.latestX<=bounds.right){
   for(const {key,rect} of rectangles){
    const left=rect.left-delta,right=rect.right-delta
    if(drag.latestY>=rect.top-16&&drag.latestY<=rect.bottom+16&&drag.latestX>=left&&drag.latestX<=right){
     target={key,side:drag.latestX<left+rect.width/2?'before':'after'};break
    }
   }
  }
  if(delta)strip.scrollLeft=nextScroll
  if(drag.target?.key!==target?.key||drag.target?.side!==target?.side){drag.target=target;setDrop(target)}
 }
 function frame(time:number){
  frameId.current=null
  if(!gesture.current?.moving)return
  const elapsed=previousTime.current===null?0:time-previousTime.current
  previousTime.current=time
  updateTarget(elapsed)
  if(gesture.current?.moving)frameId.current=requestAnimationFrame(frame)
 }
 function pointerMove(e:{clientX:number;clientY:number;pointerId:number}){
  const drag=gesture.current
  if(!drag||e.pointerId!==drag.pointerId||latest.current.disabled)return
  drag.latestX=e.clientX;drag.latestY=e.clientY
  if(!drag.moving&&Math.hypot(e.clientX-drag.x,e.clientY-drag.y)<5)return
  if(!drag.moving){setAnnouncement('Moving tab. Drop between tabs.');drag.moving=true}
  if(frameId.current===null){previousTime.current=performance.now();frameId.current=requestAnimationFrame(frame)}
 }
 function pointerEnd(e:globalThis.PointerEvent,cancelled=false){
  if(e.pointerId!==gesture.current?.pointerId)return
  if(!cancelled){pointerMove(e);updateTarget(0)}
  const drag=clearGesture()
  if(!drag?.moving)return
  suppressClick.current=true
  if(!cancelled&&!latest.current.disabled&&drag.target){
   const {key,target}=drag
   latest.current.onChange(s=>moveTab(s,key,target.key,target.side))
   setAnnouncement('Tab reordered.')
  }else setAnnouncement('Tab move cancelled.')
 }
 useEffect(()=>{
  const up=(event:globalThis.PointerEvent)=>pointerEnd(event)
  const cancel=(event:globalThis.PointerEvent)=>pointerEnd(event,true)
  const blur=()=>cancelDrag()
  const hidden=()=>{if(document.hidden)cancelDrag()}
  const escape=(event:KeyboardEvent)=>{if(event.key==='Escape'&&gesture.current){event.preventDefault();cancelDrag()}}
  window.addEventListener('pointerup',up,true)
  window.addEventListener('pointercancel',cancel,true)
  window.addEventListener('lostpointercapture',cancel,true)
  window.addEventListener('blur',blur)
  window.addEventListener('keydown',escape)
  document.addEventListener('visibilitychange',hidden)
  return()=>{
   window.removeEventListener('pointerup',up,true)
   window.removeEventListener('pointercancel',cancel,true)
   window.removeEventListener('lostpointercapture',cancel,true)
   window.removeEventListener('blur',blur)
   window.removeEventListener('keydown',escape)
   document.removeEventListener('visibilitychange',hidden)
   cancelDrag(false)
  }
 },[])
 return <><div className="tab-scroll workspace-tabs" role="tablist" aria-label="Open documents">
  {state.order.map((key,index)=>{
   const doc=documents.find(d=>d.key===key)
   if(!doc)return null
   return <ContextMenu key={key}><ContextMenuTrigger asChild disabled={disabled}>
    <div className={`tab ${state.active===key?'selected':''} ${drop?.key===key?`tab-drop-${drop.side}`:''}`}
     ref={node=>{if(node)elements.current.set(key,node);else elements.current.delete(key)}}
     onAuxClick={e=>{if(e.button===1){e.preventDefault();close(key,'one')}}}>
     <TooltipButton type="button" draggable={false} role="tab" aria-selected={state.active===key} aria-label={doc.title+(doc.dirty?' — unsaved file changes':'')} tooltip={`Open ${doc.path??doc.title}${doc.dirty?' — unsaved file changes':''}${doc.note?' · F2 to rename':''} · Drag to reorder tabs`} tabIndex={state.active===key?0:-1} disabled={disabled}
      ref={node=>{if(node)buttons.current.set(key,node);else buttons.current.delete(key)}} onClick={()=>{if(suppressClick.current){suppressClick.current=false;return}select(key)}}
      onDoubleClick={()=>{if(doc.note&&!disabled)onRenameNote(doc.note.id)}}
      onDragStart={e=>e.preventDefault()}
      onPointerDown={e=>{if(disabled||e.button!==0||e.ctrlKey||gesture.current)return;suppressClick.current=false;gesture.current={key,pointerId:e.pointerId,button:e.currentTarget,x:e.clientX,y:e.clientY,latestX:e.clientX,latestY:e.clientY,moving:false,target:null};e.currentTarget.setPointerCapture(e.pointerId)}}
      onPointerMove={pointerMove}
      onKeyDown={e=>{
       if(e.key==='F2'&&doc.note){e.preventDefault();onRenameNote(doc.note.id);return}
       if(e.altKey&&e.shiftKey&&(e.key==='ArrowLeft'||e.key==='ArrowRight')){e.preventDefault();shift(key,e.key==='ArrowLeft'?-1:1);return}
       const target=e.key==='ArrowRight'?state.order[(index+1)%state.order.length]:e.key==='ArrowLeft'?state.order[(index-1+state.order.length)%state.order.length]:e.key==='Home'?state.order[0]:e.key==='End'?state.order.at(-1):null
       if(target){e.preventDefault();select(target);buttons.current.get(target)?.focus()}
       if(e.key==='Delete'){e.preventDefault();close(key,'one');requestAnimationFrame(()=>{const next=state.order[index+1]??state.order[index-1];if(next)buttons.current.get(next)?.focus()})}
      }}><FileText size={14}/><span className="tab-title">{doc.title}</span>{doc.dirty&&<span aria-hidden="true">•</span>}</TooltipButton>
     <TooltipButton type="button" className="tab-close" tooltip={`Close ${doc.title}; keep its content`} aria-label={`Close tab ${doc.title}`} tabIndex={-1} disabled={disabled} draggable={false} onPointerDown={e=>e.stopPropagation()} onClick={()=>close(key,'one')}><X size={12}/></TooltipButton>
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
  <TooltipButton type="button" className="icon-button new-tab" aria-label="Open new scratchpad" tooltip="Create a new scratchpad (⌘N)" onClick={onNew} disabled={disabled}><Plus size={15}/></TooltipButton>
 </div><span className="sr-only" role="status">{announcement}</span></>
}
