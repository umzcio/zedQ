import {TooltipButton} from '@zq/ui'
import { type ReactNode, type Ref } from 'react'
import type { CommandBus, ModuleManifest, SettingsSection, View, WorkspaceState } from '@zq/module-api'
import { Popover, PopoverContent, PopoverTrigger } from '@zq/ui'
import { IconContext, Check, House, NotePencil, Kanban, MagnifyingGlass, GearSix, ChatCircle, TerminalWindow, Sparkle, Sun, Moon, Desktop, Plus, SidebarSimple, Package, Microphone, Scroll } from '@phosphor-icons/react'
function HeaderAction({label,onClick,selected=false,children}:{label:string;onClick:()=>void;selected?:boolean;children:ReactNode}) {
 return <TooltipButton className={`header-icon ${selected?'selected':''}`} aria-label={label} tooltip={label==='Settings'?'Open Settings (⌘,)':label} aria-current={selected?'page':undefined} onClick={onClick}>{children}</TooltipButton>
}

type Props={settingsSection:SettingsSection;onSettingsSection:(section:SettingsSection)=>void;modules:ModuleManifest[];commands:CommandBus;view:View;theme:WorkspaceState['theme'];collapsed:boolean;disabled:boolean;navigate:(view:View)=>void;setTheme:(theme:WorkspaceState['theme'])=>void;search:()=>void;toggleSidebar:()=>void;sidebarRef:Ref<HTMLDivElement>}
export default function Navigation(p:Props){
 const icons={home:House,notes:NotePencil,tasks:Kanban,chat:ChatCircle}
 const modules=p.modules.filter(m=>m.view!=='HQ').map(m=>({name:m.view,icon:icons[m.icon]}))
 return <IconContext.Provider value={{weight:'light'}}>
  <header className="workspace-header" inert={p.disabled}>
   <div className="header-start">
    <TooltipButton className="header-brand" aria-label="zQ home" aria-current={p.view==='HQ'?'page':undefined} tooltip="Go to your workspace home" onClick={()=>p.navigate('HQ')}>z<span>Q</span></TooltipButton>
    {p.collapsed&&<HeaderAction label="Expand sidebar" onClick={p.toggleSidebar}><SidebarSimple size={18}/></HeaderAction>}
    <nav className="header-modules" aria-label="Modules">{modules.map(({name,icon:Icon})=><TooltipButton key={name} tooltip={false} aria-label={`${name} module`} aria-current={p.view===name?'page':undefined} className={p.view===name?'selected':''} onClick={()=>p.navigate(name)}><Icon size={18}/><span>{name}</span></TooltipButton>)}</nav>
   </div>
   <TooltipButton tooltip="Search notes, tasks, and workspace views (⌘K)" className="header-search" aria-label="Search workspace" aria-haspopup="dialog" onClick={p.search}><MagnifyingGlass size={17}/><span>Search</span><kbd>⌘K</kbd></TooltipButton>
   <div className="header-utilities">
    <Popover><PopoverTrigger asChild><TooltipButton className="header-icon" aria-label="Appearance" tooltip="Choose light, dark, or system appearance">{p.theme==='dark'?<Moon size={18}/>:p.theme==='system'?<Desktop size={18}/>:<Sun size={18}/>}</TooltipButton></PopoverTrigger><PopoverContent align="end" className="appearance-menu" aria-label="Appearance"><p>Appearance</p>{([{id:'light',icon:Sun,label:'Light'},{id:'dark',icon:Moon,label:'Dark'},{id:'system',icon:Desktop,label:'System'}] as const).map(({id,icon:Icon,label})=><TooltipButton key={id} tooltip={id==='system'?"Follow your Mac’s appearance":false} aria-label={`${label} appearance`} aria-pressed={p.theme===id} onClick={()=>p.setTheme(id)}><Icon size={16}/><span>{label}</span>{p.theme===id&&<Check size={15}/>}</TooltipButton>)}</PopoverContent></Popover>
    <HeaderAction label="Settings" selected={p.view==='Settings'} onClick={()=>p.navigate('Settings')}><GearSix size={19}/></HeaderAction>
   </div>
  </header>
  <aside id="context-navigation" className="context-sidebar" aria-label={`${p.view} navigation`} hidden={p.collapsed}>
   <div className="context-heading"><h2>{p.view==='HQ'?'Workspace':p.view}</h2><div className="context-heading-actions">{p.view==='Notes'&&<TooltipButton tooltip="Create a new note (⌘N)" aria-label="New note" onClick={()=>p.commands.run('notes.new',undefined)}><Plus size={16}/></TooltipButton>}{p.view==='Tasks'&&<TooltipButton aria-label="New task" onClick={()=>p.commands.run('tasks.new',undefined)}><Plus size={16}/></TooltipButton>}<TooltipButton tooltip="Hide this module’s navigation sidebar" aria-label="Collapse sidebar" aria-expanded={true} aria-controls="context-navigation" onClick={p.toggleSidebar}><SidebarSimple size={16}/></TooltipButton></div></div>
   <div className="context-scroll"><div className="module-sidebar-slot" ref={p.sidebarRef}/>{p.view==='Settings'&&<nav className="context-links settings-navigation" aria-label="Settings sections">{([{id:'appearance',label:'Appearance',icon:Sun},{id:'connections',label:'Connections',icon:ChatCircle},{id:'skills',label:'Skills',icon:Scroll},{id:'voice',label:'Voice',icon:Microphone},{id:'modules',label:'Modules',icon:Package}] as const).map(({id,label,icon:Icon})=><TooltipButton key={id} tooltip={({'appearance':false,'connections':'Manage AI providers and choose available models','skills':false,'voice':false,'modules':'Manage installed modules and stage signed updates'})[id]} disabled={p.disabled} className={p.settingsSection===id?'selected':''} aria-current={p.settingsSection===id?'page':undefined} onClick={()=>p.onSettingsSection(id)}><Icon size={18}/><span>{label}</span></TooltipButton>)}</nav>}</div>
  </aside>
 </IconContext.Provider>
}
