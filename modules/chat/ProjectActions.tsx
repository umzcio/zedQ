import { useRef, useState, type ReactElement } from 'react'
import { FolderOpen, PencilSimple, GearSix, Smiley, Trash, CaretRight, MagnifyingGlass, Check, DotsThree, PushPin } from '@phosphor-icons/react'
import { TooltipButton, ContextMenu, ContextMenuTrigger, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuSub, ContextMenuSubTrigger, ContextMenuSubContent } from '@zq/ui'
import {useHost} from '@zq/module-api'
import {DropdownMenu,DropdownMenuTrigger,DropdownMenuContent,DropdownMenuItem,Dialog,DialogContent,DialogTitle,DialogDescription} from '@zq/ui'
import { ProjectDialog } from './ProjectDialog'
import { ProjectIcon, projectIcons, projectColors } from './ProjectIcon'
import type { ChatProject } from '@zq/module-api'
import type { ChatController } from './useChat'

export function ProjectIconPicker({project,chat,disabled=false}:{project:ChatProject;chat:ChatController;disabled?:boolean}){
 const [query,setQuery]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('')
 const lock=useRef(false)
 const names=Object.keys(projectIcons).filter(name=>name.toLowerCase().includes(query.toLowerCase().replaceAll(' ','')))
 async function save(patch:{icon?:string;color?:string}){if(disabled||lock.current)return;lock.current=true;setBusy(true);setError('');try{await chat.saveProject({id:project.id,...patch})}catch(e){setError((e as Error).message)}finally{lock.current=false;setBusy(false)}}
 return <div className="project-icon-picker" onKeyDown={e=>{if(e.key!=='Escape'&&e.key!=='Tab')e.stopPropagation()}}>
  <div className="project-icon-search"><MagnifyingGlass size={16}/><input aria-label="Search project icons" placeholder="Search icons…" value={query} onChange={e=>setQuery(e.target.value)}/></div>
  <div className="project-icon-grid" role="group" aria-label="Project icons" onKeyDown={e=>{
   const step={ArrowRight:1,ArrowLeft:-1,ArrowDown:8,ArrowUp:-8}[e.key]
   if(step===undefined)return;e.preventDefault();const buttons=[...e.currentTarget.querySelectorAll<HTMLButtonElement>('button')];const index=buttons.indexOf(document.activeElement as HTMLButtonElement);buttons[(index+step+buttons.length)%buttons.length]?.focus()
  }}>
   {names.map(name=><TooltipButton key={name} type="button" aria-label={`${name.replace(/([a-z])([A-Z])/g,'$1 $2')} icon`} tooltip={`Use ${name.replace(/([a-z])([A-Z])/g,'$1 $2')} as this project’s icon`} aria-pressed={(project.icon??'FolderSimple')===name} disabled={disabled||busy} onClick={()=>void save({icon:name})}><ProjectIcon project={{icon:name,color:project.color}} size={23}/></TooltipButton>)}
   {!names.length&&<p>No matching icons.</p>}
  </div>
  <div className="project-icon-colors" role="group" aria-label="Icon color">{projectColors.map(color=><TooltipButton key={color.id} type="button" aria-label={`${color.label} icon color`} tooltip={`Set this project’s icon color to ${color.label.toLowerCase()}`} aria-pressed={(project.color??'neutral')===color.id} disabled={disabled||busy} style={{background:color.dark}} onClick={()=>void save({color:color.id})}>{(project.color??'neutral')===color.id&&<Check size={13} weight="bold"/>}</TooltipButton>)}</div>
  {error&&<p className="chat-action-error" role="alert">{error}</p>}
 </div>
}

export function ProjectContextMenu({project,chat,disabled=false,children}:{project:ChatProject;chat:ChatController;disabled?:boolean;children:ReactElement}){
 const {notify}=useHost(),[action,setAction]=useState<'rename'|'settings'|'delete'|'icon'|null>(null),[busy,setBusy]=useState(false),[open,setOpen]=useState(false),opening=useRef(false),lock=useRef(false),trigger=useRef<HTMLButtonElement>(null)
 function choose(value:typeof action){opening.current=true;setAction(value)}
 async function pin(){if(disabled||lock.current)return;lock.current=true;setBusy(true);try{await chat.updateProject({id:project.id,pinned:!project.pinned})}catch(e){notify((e as Error).message)}finally{lock.current=false;setBusy(false)}}
 const actions=[{label:'Open project',run:()=>chat.openProject(project.id)},{label:project.pinned?'Unpin project':'Pin project',run:()=>void pin()},{label:'Rename',run:()=>choose('rename')},{label:'Edit icon',run:()=>choose('icon')},{label:'Settings',run:()=>choose('settings')},{label:'Delete',run:()=>choose('delete')}]
 function closeMenu(e:Event){if(opening.current)e.preventDefault()}
 return <><ContextMenu><ContextMenuTrigger asChild disabled={disabled}><div className="chat-project-menu-row" data-menu-open={open||undefined}>{children}<DropdownMenu onOpenChange={setOpen}><DropdownMenuTrigger asChild><TooltipButton tooltip={`Open, pin, rename, customize, or delete ${project.name}`} ref={trigger} type="button" className="chat-row-more" aria-label={`Actions for project ${project.name}`} disabled={disabled||busy}><DotsThree size={17}/></TooltipButton></DropdownMenuTrigger><DropdownMenuContent align="end" onCloseAutoFocus={closeMenu}>{actions.map(item=><DropdownMenuItem key={item.label} disabled={disabled||busy} onSelect={item.run}>{item.label}</DropdownMenuItem>)}</DropdownMenuContent></DropdownMenu></div></ContextMenuTrigger>
  {!disabled&&<ContextMenuContent aria-label={`Project actions for ${project.name}`} onCloseAutoFocus={closeMenu}>
   <ContextMenuItem onSelect={()=>chat.openProject(project.id)}><FolderOpen size={16}/>Open project</ContextMenuItem>
   <ContextMenuItem disabled={busy} onSelect={()=>void pin()}><PushPin size={16}/>{project.pinned?'Unpin project':'Pin project'}</ContextMenuItem>
   <ContextMenuSeparator/>
   <ContextMenuItem onSelect={()=>choose('rename')}><PencilSimple size={16}/>Rename</ContextMenuItem>
   <ContextMenuSub><ContextMenuSubTrigger className="zq-context-item project-icon-subtrigger"><Smiley size={16}/>Edit icon<CaretRight size={14}/></ContextMenuSubTrigger><ContextMenuSubContent className="project-icon-submenu" aria-label="Edit project icon"><ProjectIconPicker project={project} chat={chat} disabled={disabled}/></ContextMenuSubContent></ContextMenuSub>
   <ContextMenuItem onSelect={()=>choose('settings')}><GearSix size={16}/>Settings</ContextMenuItem>
   <ContextMenuSeparator/>
   <ContextMenuItem className="chat-delete-action" onSelect={()=>choose('delete')}><Trash size={16}/>Delete</ContextMenuItem>
  </ContextMenuContent>}
 </ContextMenu>
 {action&&action!=='icon'&&<ProjectDialog key={action} project={project} renameOnly={action==='rename'} remove={action==='delete'} closing={disabled} chat={chat} onClose={()=>{setAction(null);opening.current=false;trigger.current?.focus()}}/>}
 <Dialog open={action==='icon'} onOpenChange={value=>{if(!value){setAction(null);opening.current=false}}}><DialogContent className="project-icon-dialog" onCloseAutoFocus={e=>{e.preventDefault();trigger.current?.focus({preventScroll:true})}}><DialogTitle>Edit project icon</DialogTitle><DialogDescription>Choose an outline icon and color.</DialogDescription><ProjectIconPicker project={project} chat={chat} disabled={disabled}/></DialogContent></Dialog>
 </>
}
