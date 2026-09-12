import { useState } from 'react'
import { MagnifyingGlass, Eye, EyeSlash, PencilSimple, DotsThree } from '@phosphor-icons/react'
import { Button, Checkbox, ContextMenu, ContextMenuTrigger, ContextMenuContent, ContextMenuItem, DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from '@zq/ui'
import { modelName } from './model-presentation'

export function ModelChecklist({models,selected,onChange,disabled=false,available,labels,onRename,onMenuClose}:{models:string[];selected:string[];onChange:(models:string[])=>void;disabled?:boolean;available?:string[];labels?:Record<string,string>;onRename?:(model:string)=>void;onMenuClose?:(event:Event)=>void}){
 const [query,setQuery]=useState('')
 const shown=models.filter(id=>`${id} ${modelName(id,labels)}`.toLowerCase().includes(query.toLowerCase()))
 function toggle(id:string){onChange(selected.includes(id)?selected.filter(value=>value!==id):[...selected,id])}
 return <div className="model-checklist">
  <div className="model-library-search"><MagnifyingGlass size={17}/><input autoFocus aria-label="Search available models" placeholder="Search models…" value={query} onChange={e=>setQuery(e.target.value)}/></div>
  <div className="model-checklist-toolbar"><span>{selected.length} selected</span><Button type="button" variant="ghost" disabled={disabled||!shown.length} onClick={()=>onChange([...new Set([...selected,...shown])])}>{query?'Select shown':'Select all'}</Button><Button type="button" variant="ghost" disabled={disabled||!selected.length} onClick={()=>onChange([])}>Clear all</Button></div>
  <div className="model-checklist-options" role="group" aria-label="Models to show in Chat">
   {shown.map(id=><ContextMenu key={id}><ContextMenuTrigger asChild disabled={disabled}><label className="model-checklist-row">
    <Checkbox aria-label={`Enable ${id}`} checked={selected.includes(id)} disabled={disabled} onCheckedChange={()=>toggle(id)}/>
    <span className="model-label"><strong>{modelName(id,labels)}</strong>{modelName(id,labels)!==id&&<small>{id}</small>}{available&&!available.includes(id)&&<small>Not in the latest provider list</small>}</span>
    {onRename&&<DropdownMenu><DropdownMenuTrigger asChild><Button type="button" variant="ghost" size="icon" className="model-checklist-more" disabled={disabled} aria-label={`Actions for ${id}`}><DotsThree size={18}/></Button></DropdownMenuTrigger><DropdownMenuContent onCloseAutoFocus={onMenuClose} align="end"><DropdownMenuItem disabled={disabled} onSelect={()=>onRename(id)}><PencilSimple size={15}/>Rename model label…</DropdownMenuItem><DropdownMenuItem disabled={disabled} onSelect={()=>toggle(id)}>{selected.includes(id)?<EyeSlash size={15}/>:<Eye size={15}/>} {selected.includes(id)?'Hide from selector':'Show in selector'}</DropdownMenuItem></DropdownMenuContent></DropdownMenu>}
   </label></ContextMenuTrigger><ContextMenuContent onCloseAutoFocus={onMenuClose}>{onRename&&<ContextMenuItem disabled={disabled} onSelect={()=>onRename(id)}><PencilSimple size={15}/>Rename model label…</ContextMenuItem>}<ContextMenuItem disabled={disabled} onSelect={()=>toggle(id)}>{selected.includes(id)?<EyeSlash size={15}/>:<Eye size={15}/>} {selected.includes(id)?'Hide from selector':'Show in selector'}</ContextMenuItem></ContextMenuContent></ContextMenu>)}
   {!shown.length&&<p className="model-list-empty">{query?'No models match your search.':'No models found for this connection.'}</p>}
  </div>
 </div>
}
