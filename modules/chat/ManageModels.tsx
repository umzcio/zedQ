import { useEffect, useRef, useState } from 'react'
import { useHost, unwrap, type Connection } from '@zq/module-api'
import { ArrowsClockwise } from '@phosphor-icons/react'
import { Button, Dialog, DialogContent, DialogTitle, DialogDescription } from '@zq/ui'
import { ProviderLogo } from './ProviderLogo'
import { ModelLabelDialog } from './ModelLabelDialog'
import { ModelChecklist } from './ModelChecklist'

export function ManageModels({connection,closing,onClose,onCloseAutoFocus}:{connection:Connection;closing:boolean;onClose:()=>void;onCloseAutoFocus:(event:Event)=>void}){
 const {services}=useHost()
 const [selected,setSelected]=useState(connection.enabledModels),[catalog,setCatalog]=useState<string[]|null>(null)
 const [loading,setLoading]=useState(true),[saving,setSaving]=useState(false),[error,setError]=useState(''),[refresh,setRefresh]=useState(0)
 const [labels,setLabels]=useState(connection.modelLabels??{}),[renaming,setRenaming]=useState<string|null>(null)
 const checklist=useRef<HTMLDivElement>(null),openingRename=useRef(false)
 const lock=useRef(false)
 useEffect(()=>{let live=true;setLoading(true);setError('');unwrap(services.chat.models(connection.id)).then(models=>{if(live)setCatalog(models)}).catch(e=>{if(live)setError(e.message)}).finally(()=>{if(live)setLoading(false)});return()=>{live=false}},[connection.id,refresh])
 async function save(){
  if(closing||lock.current)return;lock.current=true;setSaving(true);setError('')
  try{await unwrap(services.chat.saveModelPreferences({connectionId:connection.id,enabledModels:selected}));onClose()}
  catch(e){setError((e as Error).message)}finally{lock.current=false;setSaving(false)}
 }
 const models=[...new Set([...(catalog??[]),...connection.enabledModels,...selected])]
 return <><Dialog open onOpenChange={open=>{if(!open&&!saving&&!closing)onClose()}}><DialogContent className="model-manager-dialog" showCloseButton={!saving&&!closing} onCloseAutoFocus={onCloseAutoFocus} onEscapeKeyDown={e=>{if(saving||closing)e.preventDefault()}}>
  <div className="provider-dialog-heading"><ProviderLogo provider={connection.provider} size={30}/><div><DialogTitle>{connection.name} models</DialogTitle><DialogDescription>Choose which models appear in Chat. Your existing chats are kept.</DialogDescription></div></div>
  <div className="model-catalog-status"><span role="status">{loading?'Fetching available models…':catalog?`${catalog.length} available from this provider`:'Saved model selection'}</span><Button type="button" variant="ghost" size="icon" aria-label="Refresh available models" disabled={loading||saving||closing} onClick={()=>setRefresh(v=>v+1)}><ArrowsClockwise size={16} className={loading?'model-refreshing':''}/></Button></div>
  {error&&<p className="chat-error" role="alert">{error}</p>}
  <div ref={checklist}><ModelChecklist labels={labels} onRename={['ollama','vllm'].includes(connection.provider)?model=>{openingRename.current=true;setRenaming(model)}:undefined} onMenuClose={e=>{if(openingRename.current)e.preventDefault()}} models={models} available={catalog??undefined} selected={selected} onChange={setSelected} disabled={saving||closing}/></div>
  <div className="model-manager-footer"><span>{selected.length===0?'No models will appear from this provider.':'You can change this anytime.'}</span><Button variant="ghost" disabled={saving||closing} onClick={onClose}>Cancel</Button><Button disabled={saving||closing||loading} onClick={()=>void save()}>{saving?'Saving…':'Save selection'}</Button></div>
 </DialogContent></Dialog>
 {renaming&&<ModelLabelDialog connectionId={connection.id} model={renaming} label={Object.hasOwn(labels,renaming)?labels[renaming]:undefined} disabled={saving||closing} onClose={()=>setRenaming(null)} onSaved={setLabels} onCloseAutoFocus={e=>{e.preventDefault();openingRename.current=false;checklist.current?.querySelector('input')?.focus({preventScroll:true})}}/>}
 </>
}
