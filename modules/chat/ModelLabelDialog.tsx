import { useRef, useState } from 'react'
import { useHost, unwrap } from '@zq/module-api'
import { Button, Dialog, DialogContent, DialogTitle, DialogDescription, Input } from '@zq/ui'

export function ModelLabelDialog({connectionId,model,label,disabled,onClose,onSaved,onCloseAutoFocus}:{connectionId:string;model:string;label?:string;disabled:boolean;onClose:()=>void;onSaved:(labels:Record<string,string>)=>void;onCloseAutoFocus:(event:Event)=>void}){
 const {services}=useHost(),input=useRef<HTMLInputElement>(null),lock=useRef(false)
 const [value,setValue]=useState(label??''),[saving,setSaving]=useState(false),[error,setError]=useState('')
 async function save(reset=false){
  if(disabled||lock.current||(!reset&&!value.trim()))return
  lock.current=true;setSaving(true);setError('')
  try{const snapshot=await unwrap(services.chat.saveModelPreferences({connectionId,modelLabel:{model,label:reset?null:value.trim()}}));onSaved(snapshot.connections.find(c=>c.id===connectionId)?.modelLabels??{});onClose()}
  catch(e){setError((e as Error).message)}finally{lock.current=false;setSaving(false)}
 }
 return <Dialog open onOpenChange={open=>{if(!open&&!saving&&!disabled)onClose()}}><DialogContent className="model-label-dialog" showCloseButton={!saving&&!disabled} onOpenAutoFocus={e=>{e.preventDefault();input.current?.focus();input.current?.select()}} onCloseAutoFocus={onCloseAutoFocus} onEscapeKeyDown={e=>{if(saving||disabled)e.preventDefault()}}>
  <DialogTitle>Rename model label</DialogTitle><DialogDescription>Give this model a name you recognize. The original ID stays the same.</DialogDescription>
  <p className="model-label-original">{model}</p>
  <form onSubmit={e=>{e.preventDefault();void save()}}><label htmlFor="custom-model-label">Display name</label><Input ref={input} id="custom-model-label" placeholder="e.g. My coding model" value={value} maxLength={80} disabled={saving||disabled} onChange={e=>setValue(e.target.value)}/>
   {error&&<p className="chat-error" role="alert">{error}</p>}
   <div className="model-label-actions">{label&&<Button type="button" variant="ghost" disabled={saving||disabled} tooltip="Remove the custom label and show the original model name" onClick={()=>void save(true)}>Reset label</Button>}<span/><Button type="button" variant="ghost" disabled={saving||disabled} onClick={onClose}>Cancel</Button><Button tooltip={!value.trim() ? 'Enter a display name to save' : 'Save this display name; the provider’s model ID stays the same'} type="submit" disabled={saving||disabled||!value.trim()}>{saving?'Saving…':'Save label'}</Button></div>
  </form>
 </DialogContent></Dialog>
}
