import { useHost } from '@zq/module-api'
import { useEffect, useState } from 'react'
import { Dialog,DialogContent,DialogTitle,DialogDescription } from '@zq/ui'
import { unwrap } from '@zq/module-api'
import type { AttachmentPreview as Preview } from '@zq/module-api'
export default function AttachmentPreview({target,closing,onClose}:{target:{id:string;name:string;text?:string};closing:boolean;onClose:()=>void}){
 const {services}=useHost()
 const [value,setValue]=useState<Preview|null>(null),[error,setError]=useState('')
 useEffect(()=>{let live=true;if(target.text===undefined)unwrap(services.attachments.preview(target.id)).then(v=>{if(live)setValue(v)}).catch(e=>{if(live)setError(e.message)});return()=>{live=false}},[target.id])
 return <Dialog open={!closing} onOpenChange={open=>{if(!open)onClose()}}><DialogContent inert={closing} className="attachment-preview-dialog"><DialogTitle>{target.name}</DialogTitle><DialogDescription>{value?.kind==='pdf'?'Extracted PDF text included with your message.':value?.kind==='image'?'Image included with your message.':'Content included with your message.'}</DialogDescription>{error?<p role="alert">{error}</p>:target.text!==undefined?<pre>{target.text}</pre>:!value?<p role="status">Opening preview…</p>:value.kind==='image'?<img src={`data:image/jpeg;base64,${value.image}`} alt={value.name}/>:<pre>{value.text}</pre>}</DialogContent></Dialog>
}
