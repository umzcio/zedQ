import { useRef, useState } from 'react'
import { useHost, unwrap, type ChatSnapshot, type Connection, type ModelChoice } from '@zq/module-api'
import { CaretDown, Check, DotsThree, EyeSlash, MagnifyingGlass, SlidersHorizontal, Star, PencilSimple } from '@phosphor-icons/react'
import { Popover, PopoverTrigger, PopoverContent, ContextMenu, ContextMenuTrigger, ContextMenuContent, ContextMenuItem, DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from '@zq/ui'
import { ProviderLogo } from './ProviderLogo'
import { ModelLabelDialog } from './ModelLabelDialog'
import { modelName } from './model-presentation'

type Entry={connection:Connection;model:string}
export default function ModelPicker({state,choice,disabled,settings,onPick,onPicked}:{state:ChatSnapshot;choice:ModelChoice|null;disabled:boolean;settings:()=>void;onPick:(connectionId:string,model:string)=>Promise<boolean>;onPicked:()=>void}){
 const {services}=useHost()
 const [open,setOpen]=useState(false),[query,setQuery]=useState(''),[error,setError]=useState(''),[saving,setSaving]=useState(false)
 const [renaming,setRenaming]=useState<Entry|null>(null)
 const openingRename=useRef(false),trigger=useRef<HTMLButtonElement>(null)
 const picked=useRef(false),search=useRef<HTMLInputElement>(null),list=useRef<HTMLDivElement>(null),lock=useRef(false)
 const selectedConnection=state.connections.find(c=>c.id===choice?.connectionId)
 const entries=state.connections.flatMap(connection=>connection.enabledModels.map(model=>({connection,model})))
 const matches=({connection,model}:Entry)=>`${modelName(model,connection.modelLabels)} ${model} ${connection.name} ${connection.provider}`.toLowerCase().includes(query.toLowerCase())
 const favorite=(entry:Entry)=>entry.connection.favoriteModels.includes(entry.model)
 const favorites=entries.filter(entry=>favorite(entry)&&matches(entry))
 const groups=state.connections.map(connection=>({connection,entries:entries.filter(entry=>entry.connection.id===connection.id&&!favorite(entry)&&matches(entry))})).filter(group=>group.entries.length)
 async function choose(entry:Entry){if(disabled||lock.current)return;lock.current=true;try{if(await onPick(entry.connection.id,entry.model)){picked.current=true;setOpen(false)}}finally{lock.current=false}}
 async function update(entry:Entry,action:'favorite'|'default'|'hide'){
  if(disabled||lock.current)return;lock.current=true;setSaving(true);setError('')
  const {connection,model}=entry
  try{await unwrap(services.chat.saveModelPreferences({connectionId:connection.id,...(action==='favorite'?{favoriteModels:favorite(entry)?connection.favoriteModels.filter(id=>id!==model):[...connection.favoriteModels,model]}:action==='default'?{defaultModel:state.defaultModel?.connectionId===connection.id&&state.defaultModel.model===model?null:model}:{enabledModels:connection.enabledModels.filter(id=>id!==model)})}))}
  catch(e){setError((e as Error).message)}finally{lock.current=false;setSaving(false);requestAnimationFrame(()=>search.current?.focus({preventScroll:true}))}
 }
 function actions(entry:Entry){return [
  {id:'favorite' as const,label:favorite(entry)?'Remove from favorites':'Add to favorites',icon:<Star size={15}/>},
  {id:'default' as const,label:state.defaultModel?.connectionId===entry.connection.id&&state.defaultModel.model===entry.model?'Clear default':'Set as default',icon:<Check size={15}/>},
  ...(['ollama','vllm'].includes(entry.connection.provider)?[{id:'rename' as const,label:'Rename model label…',icon:<PencilSimple size={15}/>}]:[]),
  {id:'hide' as const,label:'Hide from selector',icon:<EyeSlash size={15}/>},
 ]}
 function actionRun(entry:Entry,id:'favorite'|'default'|'hide'|'rename'){if(id==='rename'){openingRename.current=true;setRenaming(entry);setOpen(false)}else void update(entry,id)}
 function menuClose(e:Event){if(openingRename.current)e.preventDefault()}
 function row(entry:Entry){
  const {connection,model}=entry,isSelected=choice?.connectionId===connection.id&&choice.model===model,isDefault=state.defaultModel?.connectionId===connection.id&&state.defaultModel.model===model
  return <ContextMenu key={`${connection.id}:${model}`}><ContextMenuTrigger asChild disabled={disabled||saving}><div className="curated-model-row" data-selected={isSelected}>
   <button type="button" data-model-choice aria-label={`Use ${model} from ${connection.name}`} aria-pressed={isSelected} disabled={disabled||saving} onClick={()=>void choose(entry)}>
    <ProviderLogo provider={connection.provider} size={19}/><span className="model-label"><strong>{modelName(model,connection.modelLabels)}</strong>{(favorite(entry)||modelName(model,connection.modelLabels)!==model)&&<small>{favorite(entry)?`${connection.name}${modelName(model,connection.modelLabels)!==model?' · ':''}`:''}{modelName(model,connection.modelLabels)!==model?model:''}</small>}</span>
    {isDefault&&<span className="model-default-label">Default</span>}{isSelected&&<Check size={15}/>}</button>
   <DropdownMenu><DropdownMenuTrigger asChild><button type="button" className="model-row-more" aria-label={`Actions for ${model} from ${connection.name}`} disabled={disabled||saving}><DotsThree size={19}/></button></DropdownMenuTrigger><DropdownMenuContent align="end" onCloseAutoFocus={menuClose}>{actions(entry).map(action=><DropdownMenuItem key={action.id} disabled={disabled||saving} onSelect={()=>actionRun(entry,action.id)}>{action.icon}{action.label}</DropdownMenuItem>)}</DropdownMenuContent></DropdownMenu>
  </div></ContextMenuTrigger><ContextMenuContent aria-label={`Model actions for ${model}`} onCloseAutoFocus={menuClose}>{actions(entry).map(action=><ContextMenuItem key={action.id} disabled={disabled||saving} onSelect={()=>actionRun(entry,action.id)}>{action.icon}{action.label}</ContextMenuItem>)}</ContextMenuContent></ContextMenu>
 }
 return <><Popover open={open} onOpenChange={value=>{setOpen(value);if(value){setQuery('');setError('')}}}>
  <PopoverTrigger asChild><button ref={trigger} type="button" className="chat-model-trigger curated-model-trigger" aria-label="Choose chat model" disabled={disabled} title={choice?.model}>{selectedConnection&&<ProviderLogo provider={selectedConnection.provider} size={17}/>}<span>{choice?modelName(choice.model,selectedConnection?.modelLabels):'Choose a model'}</span><CaretDown size={12}/></button></PopoverTrigger>
  <PopoverContent align="end" side="top" className="curated-model-picker" aria-label="Choose chat model" onOpenAutoFocus={e=>{e.preventDefault();search.current?.focus()}} onCloseAutoFocus={e=>{if(openingRename.current){e.preventDefault();return}if(picked.current){e.preventDefault();picked.current=false;onPicked()}}} onKeyDown={e=>{
   if(e.key!=='ArrowDown'&&e.key!=='ArrowUp')return
   const buttons=Array.from(list.current?.querySelectorAll<HTMLButtonElement>('button[data-model-choice]:not(:disabled)')??[])
   if(!buttons.length)return
   if(e.target!==search.current&&!buttons.includes(e.target as HTMLButtonElement))return
   e.preventDefault();const index=buttons.indexOf(document.activeElement as HTMLButtonElement);buttons[(index+(e.key==='ArrowDown'?1:-1)+buttons.length)%buttons.length].focus()
  }}>
   <div className="model-library-search"><MagnifyingGlass size={17}/><input ref={search} aria-label="Search your models" placeholder="Search your models…" value={query} onChange={e=>setQuery(e.target.value)}/></div>
   {error&&<p className="chat-error" role="alert">{error}</p>}
   <div className="curated-model-list" ref={list}>
    {!!favorites.length&&<section aria-label="Favorite models"><h3><Star size={13}/>Favorites</h3>{favorites.map(row)}</section>}
    {groups.map(group=><section key={group.connection.id} aria-label={`${group.connection.name} models`}><h3>{group.connection.name}</h3>{group.entries.map(row)}</section>)}
    {!favorites.length&&!groups.length&&<p className="model-list-empty">{query?'No matching models.':state.connections.length?'Choose models from your providers to build your list.':'Connect a provider to choose your models.'}</p>}
   </div>
   {choice&&selectedConnection&&!selectedConnection.enabledModels.includes(choice.model)&&<p className="model-hidden-notice">This chat uses a hidden model. You can keep chatting with it.</p>}
   <button type="button" className="model-picker-manage" onClick={()=>{setOpen(false);settings()}}><SlidersHorizontal size={16}/>Manage providers & models</button>
  </PopoverContent>
 </Popover>
 {renaming&&<ModelLabelDialog connectionId={renaming.connection.id} model={renaming.model} label={Object.hasOwn(renaming.connection.modelLabels??{},renaming.model)?renaming.connection.modelLabels?.[renaming.model]:undefined} disabled={disabled} onClose={()=>setRenaming(null)} onSaved={()=>{}} onCloseAutoFocus={e=>{e.preventDefault();openingRename.current=false;trigger.current?.focus({preventScroll:true})}}/>}
 </>
}
