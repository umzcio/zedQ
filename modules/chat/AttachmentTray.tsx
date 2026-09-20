import { useLayoutEffect, useRef } from 'react'
import { TooltipButton } from '@zq/ui'
import { FileText, FilePdf, NotePencil, X } from '@phosphor-icons/react'
import type { Attachment } from '@zq/module-api'
export type AttachmentCardData=Attachment|{id:string;name:string;kind:'note';size:number;preview:string}
export function AttachmentCard({item,onPreview,onRemove,disabled=false,animateEntry=false,onEntryComplete}:{item:AttachmentCardData;onPreview:()=>void;onRemove?:()=>void;disabled?:boolean;animateEntry?:boolean;onEntryComplete?:()=>void}){
 const card=useRef<HTMLDivElement>(null)
 useLayoutEffect(()=>{
  const node=card.current;if(!node||!animateEntry||!onEntryComplete)return
  const consume=(event:AnimationEvent)=>{if(event.target===node)onEntryComplete()}
  node.addEventListener('animationend',consume);node.addEventListener('animationcancel',consume)
  return()=>{node.removeEventListener('animationend',consume);node.removeEventListener('animationcancel',consume)}
 },[animateEntry,onEntryComplete])
 const Icon=item.kind==='pdf'?FilePdf:item.kind==='note'?NotePencil:FileText
 return <div ref={card} data-animate-entry={animateEntry} className={`attachment-card attachment-${item.kind}${animateEntry?' animate-in fade-in-0 zoom-in-95 motion-reduce:animate-none':''}`}>
  <TooltipButton type="button" className="attachment-preview-button" aria-label={`Preview ${item.name}`} onClick={onPreview}>
   {item.kind==='image'?<img src={item.preview} alt={item.name}/>:<span className="attachment-file-icon"><Icon size={22}/></span>}
   <span className="attachment-copy"><strong>{item.name}</strong><small>{item.kind==='note'?'Note':`${item.kind==='pdf'?'PDF':item.kind==='image'?'Image':'Text'} · ${item.size<1024?`${item.size} B`:`${Math.round(item.size/1024)} KB`}`}</small></span>
  </TooltipButton>
  {onRemove&&<TooltipButton type="button" disabled={disabled} className="attachment-remove" aria-label={`Remove ${item.name}`} tooltip={`Remove ${item.name} from these references`} onClick={onRemove}><X size={12}/></TooltipButton>}
 </div>
}
