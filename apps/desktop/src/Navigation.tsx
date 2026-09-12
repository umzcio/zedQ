import { useState, type ReactNode, type Ref } from 'react'
import type { CommandBus, ModuleManifest, SettingsSection, View, WorkspaceState } from '@zq/module-api'
import { Popover, PopoverContent, PopoverTrigger } from '@zq/ui'
import { Tooltip } from 'radix-ui'
import { IconContext, Check, House, NotePencil, Kanban, MagnifyingGlass, GearSix, ChatCircle, TerminalWindow, Sparkle, Sun, Moon, Desktop, Plus, SidebarSimple, Package, Microphone, Scroll } from '@phosphor-icons/react'
function HeaderAction({label,onClick,selected=false,children}:{label:string;onClick:()=>void;selected?:boolean;children:ReactNode}) {
 const [open,setOpen]=useState(false)
 return <Tooltip.Root open={open}><Tooltip.Trigger asChild><button className={`header-icon ${selected?'selected':''}`} aria-label={label} aria-current={selected?'page':undefined} onPointerEnter={()=>setOpen(true)} onPointerLeave={()=>setOpen(false)} onFocus={e=>{if(e.currentTarget.matches(':focus-visible'))setOpen(true)}} onBlur={()=>setOpen(false)} onClick={()=>{setOpen(false);onClick()}}>{children}</button></Tooltip.Trigger><Tooltip.Portal><Tooltip.Content side="bottom" sideOffset={8} className="rail-tooltip">{label}</Tooltip.Content></Tooltip.Portal></Tooltip.Root>
}

type Props={settingsSection:SettingsSection;onSettingsSection:(section:SettingsSection)=>void;modules:ModuleManifest[];commands:CommandBus;view:View;theme:WorkspaceState['theme'];collapsed:boolean;disabled:boolean;navigate:(view:View)=>void;setTheme:(theme:WorkspaceState['theme'])=>void;search:()=>void;toggleSidebar:()=>void;sidebarRef:Ref<HTMLDivElement>}
export default function Navigation(p:Props){
 const icons={home:House,notes:NotePencil,tasks:Kanban,chat:ChatCircle}
 const modules=p.modules.filter(m=>m.view!=='HQ').map(m=>({name:m.view,icon:icons[m.icon]}))
 return <IconContext.Provider value={{weight:'light'}}><Tooltip.Provider delayDuration={250} skipDelayDuration={0} disableHoverableContent>
  <header className="workspace-header" inert={p.disabled}>
   <div className="header-start">
    <button className="header-brand" aria-label="zQ home" aria-current={p.view==='HQ'?'page':undefined} title="zQ home" onClick={()=>p.navigate('HQ')}>z<span>Q</span></button>
    {p.collapsed&&<HeaderAction label="Expand sidebar" onClick={p.toggleSidebar}><SidebarSimple size={18}/></HeaderAction>}
    <nav className="header-modules" aria-label="Modules">{modules.map(({name,icon:Icon})=><button key={name} aria-label={`${name} module`} aria-current={p.view===name?'page':undefined} className={p.view===name?'selected':''} onClick={()=>p.navigate(name)}><Icon size={18}/><span>{name}</span></button>)}</nav>
   </div>
   <button className="header-search" aria-label="Search workspace" aria-haspopup="dialog" onClick={p.search}><MagnifyingGlass size={17}/><span>Search</span><kbd>⌘K</kbd></button>
   <div className="header-utilities">
    <Popover><PopoverTrigger asChild><button className="header-icon" aria-label="Appearance" title="Appearance">{p.theme==='dark'?<Moon size={18}/>:p.theme==='system'?<Desktop size={18}/>:<Sun size={18}/>}</button></PopoverTrigger><PopoverContent align="end" className="appearance-menu" aria-label="Appearance"><p>Appearance</p>{([{id:'light',icon:Sun,label:'Light'},{id:'dark',icon:Moon,label:'Dark'},{id:'system',icon:Desktop,label:'System'}] as const).map(({id,icon:Icon,label})=><button key={id} aria-label={`${label} appearance`} aria-pressed={p.theme===id} onClick={()=>p.setTheme(id)}><Icon size={16}/><span>{label}</span>{p.theme===id&&<Check size={15}/>}</button>)}</PopoverContent></Popover>
    <HeaderAction label="Settings" selected={p.view==='Settings'} onClick={()=>p.navigate('Settings')}><GearSix size={19}/></HeaderAction>
   </div>
  </header>
  <aside id="context-navigation" className="context-sidebar" aria-label={`${p.view} navigation`} hidden={p.collapsed}>
   <div className="context-heading"><h2>{p.view==='HQ'?'Workspace':p.view}</h2><div className="context-heading-actions">{p.view==='Notes'&&<button aria-label="New note" onClick={()=>p.commands.run('notes.new',undefined)}><Plus size={16}/></button>}{p.view==='Tasks'&&<button aria-label="New task" onClick={()=>p.commands.run('tasks.new',undefined)}><Plus size={16}/></button>}<button aria-label="Collapse sidebar" aria-expanded={true} aria-controls="context-navigation" onClick={p.toggleSidebar}><SidebarSimple size={16}/></button></div></div>
   <div className="context-scroll"><div className="module-sidebar-slot" ref={p.sidebarRef}/>{p.view==='Settings'&&<nav className="context-links settings-navigation" aria-label="Settings sections">{([{id:'appearance',label:'Appearance',icon:Sun},{id:'connections',label:'Connections',icon:ChatCircle},{id:'skills',label:'Skills',icon:Scroll},{id:'voice',label:'Voice',icon:Microphone},{id:'modules',label:'Modules',icon:Package}] as const).map(({id,label,icon:Icon})=><button key={id} disabled={p.disabled} className={p.settingsSection===id?'selected':''} aria-current={p.settingsSection===id?'page':undefined} onClick={()=>p.onSettingsSection(id)}><Icon size={18}/><span>{label}</span></button>)}</nav>}</div>
  </aside>
 </Tooltip.Provider></IconContext.Provider>
}
