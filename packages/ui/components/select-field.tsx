import { type ReactNode, createContext, useContext, useEffect, useState } from 'react'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './select'
import { cn } from '../lib/utils'

export const SelectInteractionContext=createContext(false)
type Option=string|{value:string;label:string}
export function SelectField({label,value,onValueChange,options,className,disabled=false,tooltip}:{label:string;value:string;onValueChange:(value:string)=>void;options:readonly Option[];className?:string;disabled?:boolean;tooltip?:ReactNode}){
 const closing=useContext(SelectInteractionContext)
 const blocked=disabled||closing
 const [open,setOpen]=useState(false)
 useEffect(()=>{if(blocked)setOpen(false)},[blocked])
 return <Select value={`value:${value}`} onValueChange={next=>{if(!blocked)onValueChange(next.slice(6))}} disabled={blocked} open={open&&!blocked} onOpenChange={setOpen}>
  <SelectTrigger tooltip={tooltip??`Choose ${label.toLowerCase()}`} disabled={blocked} size="sm" aria-label={label} className={cn('zq-select-trigger',className)}><SelectValue/></SelectTrigger>
  <SelectContent position="popper" align="start" sideOffset={4} className="zq-select-content" aria-label={label}>
   {options.map(option=>{const item=typeof option==='string'?{value:option,label:option}:option;return <SelectItem className="zq-select-item" key={item.value} value={`value:${item.value}`}>{item.label}</SelectItem>})}
  </SelectContent>
 </Select>
}
