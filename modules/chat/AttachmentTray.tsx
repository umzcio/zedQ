import { FileText, FilePdf, NotePencil, X } from '@phosphor-icons/react'
import type { Attachment } from '@zq/module-api'
export type AttachmentCardData=Attachment|{id:string;name:string;kind:'note';size:number;preview:string}
export function AttachmentCard({item,onPreview,onRemove,disabled=false}:{item:AttachmentCardData;onPreview:()=>void;onRemove?:()=>void;disabled?:boolean}){
 const Icon=item.kind==='pdf'?FilePdf:item.kind==='note'?NotePencil:FileText
 return <div className={`attachment-card attachment-${item.kind} animate-in fade-in-0 zoom-in-95 duration-150 motion-reduce:animate-none`}>
  <button type="button" className="attachment-preview-button" aria-label={`Preview ${item.name}`} onClick={onPreview}>
   {item.kind==='image'?<img src={item.preview} alt={item.name}/>:<span className="attachment-file-icon"><Icon size={22}/></span>}
   <span className="attachment-copy"><strong>{item.name}</strong><small>{item.kind==='note'?'Note':`${item.kind==='pdf'?'PDF':item.kind==='image'?'Image':'Text'} · ${item.size<1024?`${item.size} B`:`${Math.round(item.size/1024)} KB`}`}</small></span>
  </button>
  {onRemove&&<button type="button" disabled={disabled} className="attachment-remove" aria-label={`Remove ${item.name}`} title="Remove attachment" onClick={onRemove}><X size={12}/></button>}
 </div>
}
