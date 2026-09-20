import {useState,type ReactNode} from 'react'
import {CaretRight} from '@phosphor-icons/react'
import {Collapsible,CollapsibleTrigger,CollapsibleContent} from './collapsible'
import {ContextMenu,ContextMenuTrigger,ContextMenuContent,ContextMenuItem} from './context-menu'

/** A remembered disclosure for a sidebar collection; item menus stay with its children. */
export function SidebarSection({storageKey,title,actions,meta,children,className=''}:{storageKey:string;title:string;actions?:ReactNode;meta?:ReactNode;children:ReactNode;className?:string}){
 const key=`zq.sidebar.section.${storageKey}`
 const [open,setOpen]=useState(()=>{try{return localStorage.getItem(key)!=='closed'}catch{return true}})
 function change(next:boolean){setOpen(next);try{localStorage.setItem(key,next?'open':'closed')}catch{/* Storage may be unavailable; disclosure still works. */}}
 return <Collapsible open={open} onOpenChange={change} asChild><section className={`zq-sidebar-section ${className}`} aria-label={title}>
  <header className="zq-sidebar-section-heading">
   <ContextMenu><ContextMenuTrigger asChild><h2><CollapsibleTrigger tooltip={false} data-slot="sidebar-section-trigger" className="zq-sidebar-section-trigger" aria-label={`${open?'Collapse':'Expand'} ${title}`}><span>{title}</span><CaretRight className="zq-sidebar-section-caret" size={13} aria-hidden="true"/></CollapsibleTrigger></h2></ContextMenuTrigger><ContextMenuContent><ContextMenuItem onSelect={()=>change(!open)}>{open?'Collapse':'Expand'} {title}</ContextMenuItem></ContextMenuContent></ContextMenu>
   {meta!==undefined&&<span className="zq-sidebar-section-meta">{meta}</span>}{actions&&<div className="zq-sidebar-section-actions">{actions}</div>}
  </header>
  <CollapsibleContent className="zq-sidebar-section-content">{children}</CollapsibleContent>
 </section></Collapsible>
}
