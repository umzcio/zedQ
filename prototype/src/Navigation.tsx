import { NoteContextMenu } from './NoteActions'
import { SelectField } from './components/ui/select-field'
import { House, NotePencil, Kanban, MagnifyingGlass, GearSix, ChatCircle, TerminalWindow, Sparkle, Sun, Moon, Desktop, Plus, FileText, PushPin, SquaresFour, Circle, FolderSimple, SidebarSimple } from '@phosphor-icons/react'
import { projects, type Note, type Task } from './data'
import type { ReactNode } from 'react'
import { Tooltip } from 'radix-ui'

function RailAction({label,tooltip,selected=false,planned=false,onClick,expanded,children}:{label:string;tooltip:ReactNode;selected?:boolean;planned?:boolean;onClick?:()=>void;expanded?:boolean;children:ReactNode}) {
 return <Tooltip.Root><Tooltip.Trigger asChild><button className={`rail-button ${selected?'selected':''} ${planned?'future-module':''}`} aria-label={label} aria-current={selected?'page':undefined} aria-disabled={planned||undefined} aria-expanded={expanded} aria-controls={expanded!==undefined?"context-navigation":undefined} onClick={onClick}>{children}</button></Tooltip.Trigger><Tooltip.Portal><Tooltip.Content side="right" sideOffset={11} className="rail-tooltip">{tooltip}</Tooltip.Content></Tooltip.Portal></Tooltip.Root>
}

type View = 'HQ' | 'Notes' | 'Tasks' | 'Settings'
type Theme = 'light' | 'dark' | 'system'
type Props = {
 renameNote:(id:string)=>void; toggleNotePin:(id:string)=>void; disabled?:boolean;
 view: View; theme: Theme; collapsed: boolean; notes: Note[]; tasks: Task[];
 selectedNote: string; noteQuery: string; noteFilter: string; projectFilter: string; taskScope: string;
 navigate: (view: View) => void; setTheme: (theme: Theme) => void; search: () => void;
 openNote: (id: string) => void; newNote: () => void; newTask: () => void;
 setNoteQuery: (query: string) => void; setNoteFilter: (filter: string) => void;
 showTasks: (project: string, scope: string) => void; toggleSidebar: () => void;
}

export default function Navigation(p: Props) {
 const modules = [{name:'HQ',icon:House},{name:'Notes',icon:NotePencil},{name:'Tasks',icon:Kanban}] as const
 const filteredNotes = p.notes.filter(n => (p.noteFilter==='All notes'||p.noteFilter==='Pinned'&&n.pinned||n.project===p.noteFilter) && (n.title+n.body).toLowerCase().includes(p.noteQuery.toLowerCase()))
 return <Tooltip.Provider delayDuration={250} skipDelayDuration={0} disableHoverableContent>
  <nav className="module-rail" aria-label="Modules">
   <button className="rail-brand" aria-label="zQ home" onClick={()=>p.navigate('HQ')}>z<span>Q</span><i/></button>
   <div className="rail-modules">
    {modules.map(({name,icon:Icon})=><RailAction key={name} label={`${name} module`} tooltip={name} selected={p.view===name} onClick={()=>p.navigate(name)}><Icon size={23} weight={p.view===name?'fill':'regular'}/></RailAction>)}
    <div className="rail-divider"/>
    {([{name:'Chat',icon:ChatCircle},{name:'Code',icon:TerminalWindow},{name:'Work',icon:Sparkle}] as const).map(({name,icon:Icon})=><RailAction key={name} label={`${name} — planned module`} planned tooltip={<>{name}<small>Planned module</small></>}><Icon size={22}/></RailAction>)}
   </div>
   <div className="rail-utilities">
    {p.collapsed&&<RailAction label="Expand sidebar" tooltip="Expand sidebar" expanded={false} onClick={p.toggleSidebar}><SidebarSimple size={20}/></RailAction>}
    <RailAction label="Find anything" tooltip={<>Find anything <kbd>⌘ K</kbd></>} onClick={p.search}><MagnifyingGlass size={21}/></RailAction>
    <RailAction label={p.theme==='dark'?'Switch to light mode':'Switch to dark mode'} tooltip="Switch theme" onClick={()=>p.setTheme(p.theme==='dark'?'light':'dark')}>{p.theme==='dark'?<Moon size={21}/>:<Sun size={21}/>}</RailAction>
    <RailAction label="Settings" tooltip="Settings" selected={p.view==='Settings'} onClick={()=>p.navigate('Settings')}><GearSix size={22}/></RailAction>
    <button className="rail-profile" aria-label="zach’s settings" onClick={()=>p.navigate('Settings')}>z</button>
   </div>
  </nav>
  <aside id="context-navigation" className="context-sidebar" aria-label={`${p.view} navigation`} hidden={p.collapsed}>
   <div className="context-heading"><h2>{p.view==='HQ'?'Workspace':p.view}</h2><div className="context-heading-actions">{p.view==='Notes'&&<button aria-label="New note" onClick={p.newNote}><Plus size={16}/></button>}{p.view==='Tasks'&&<button aria-label="New task" onClick={p.newTask}><Plus size={16}/></button>}<button aria-label="Collapse sidebar" aria-expanded={true} aria-controls="context-navigation" onClick={p.toggleSidebar}><SidebarSimple size={16}/></button></div></div>
   <div className="context-scroll">
    {p.view==='HQ'&&<>
     <nav className="context-links" aria-label="Workspace views"><button className="selected" aria-current="page" onClick={()=>p.navigate('HQ')}><SquaresFour size={18}/><span>Overview</span></button><button onClick={()=>p.navigate('Notes')}><NotePencil size={18}/><span>Recent notes</span><small>{p.notes.length}</small></button><button onClick={()=>p.showTasks('All projects','Active')}><Circle size={18}/><span>In progress</span><small>{p.tasks.filter(t=>t.status==='Doing').length}</small></button></nav>
     <div className="context-section-label">PROJECTS</div><div className="context-links">{projects.map(project=><button key={project} onClick={()=>p.showTasks(project,'All tasks')}><span className={`project-glyph p-${project.toLowerCase()}`}>{project==='zQ'?'z':project==='llm-img'?'i':'b'}</span><span>{project}</span></button>)}</div>
     <div className="context-section-label">PINNED NOTES <PushPin size={12}/></div><div className="context-links pinned-links">{p.notes.filter(n=>n.pinned).map(n=><NoteContextMenu key={n.id} note={n} onOpen={p.openNote} onRename={p.renameNote} onTogglePin={p.toggleNotePin} disabled={p.disabled}><button onKeyDown={e=>{if(e.key==='F2'){e.preventDefault();p.renameNote(n.id)}}} onClick={()=>p.openNote(n.id)}><FileText size={16}/><span>{n.title||'Untitled'}</span></button></NoteContextMenu>)}</div>
    </>}
    {p.view==='Notes'&&<>
     <div className="context-search"><MagnifyingGlass size={15}/><input aria-label="Search notes" placeholder="Find a note…" value={p.noteQuery} onChange={e=>p.setNoteQuery(e.target.value)}/></div>
     <nav className="context-links" aria-label="Note collections">{(['All notes','Pinned'] as const).map(label=><button key={label} className={p.noteFilter===label?'selected':''} onClick={()=>p.setNoteFilter(label)}>{label==='Pinned'?<PushPin size={17}/>:<NotePencil size={17}/>}<span>{label}</span><small>{p.notes.filter(n=>label==='All notes'||n.pinned).length}</small></button>)}</nav>
     <div className="context-project-filter"><FolderSimple size={14}/><SelectField label="Filter notes by project" value={projects.includes(p.noteFilter)?p.noteFilter:''} onValueChange={value=>p.setNoteFilter(value||'All notes')} options={[{value:'',label:'All projects'},...projects]}/></div>
     <div className="context-section-label">{p.noteFilter==='All notes'?'YOUR SCRATCHPADS':p.noteFilter.toUpperCase()} <span>{filteredNotes.length}</span></div>
     <div className="context-note-list">{filteredNotes.map(n=><NoteContextMenu key={n.id} note={n} onOpen={p.openNote} onRename={p.renameNote} onTogglePin={p.toggleNotePin} disabled={p.disabled}><button onKeyDown={e=>{if(e.key==='F2'){e.preventDefault();p.renameNote(n.id)}}} className={`note-list-item ${p.selectedNote===n.id?'selected':''}`} onClick={()=>p.openNote(n.id)}><div><FileText size={14}/><strong title={n.title||'Untitled'}>{n.title||'Untitled'}</strong>{n.pinned&&<PushPin size={12}/>}</div></button></NoteContextMenu>)}{!filteredNotes.length&&<p className="context-empty">No notes here yet.</p>}</div>
    </>}
    {p.view==='Tasks'&&<>
     <nav className="context-links" aria-label="Task views">{[{label:'All tasks',icon:Kanban,status:null},{label:'Active',icon:Circle,status:'Doing'},{label:'Waiting',icon:Circle,status:'Waiting'}].map(({label,icon:Icon,status})=><button key={label} className={p.taskScope===label?'selected':''} onClick={()=>p.showTasks(p.projectFilter,label)}><Icon size={18}/><span>{label}</span><small>{p.tasks.filter(t=>(p.projectFilter==='All projects'||t.project===p.projectFilter)&&(!status||t.status===status)).length}</small></button>)}</nav>
     <div className="context-section-label">PROJECTS</div><div className="context-links"><button className={p.projectFilter==='All projects'?'project-selected':''} onClick={()=>p.showTasks('All projects',p.taskScope)}><SquaresFour size={18}/><span>All projects</span></button>{projects.map(project=><button key={project} className={p.projectFilter===project?'project-selected':''} onClick={()=>p.showTasks(project,p.taskScope)}><span className={`project-glyph p-${project.toLowerCase()}`}>{project==='zQ'?'z':project==='llm-img'?'i':'b'}</span><span>{project}</span><small>{p.tasks.filter(t=>t.project===project&&t.status!=='Done').length}</small></button>)}</div>
     <div className="context-hint"><Kanban size={20}/><p>A place for every next step.</p><span>Choose a project to bring its tasks into focus.</span></div>
    </>}
    {p.view==='Settings'&&<><nav className="context-links" aria-label="Settings sections"><button className="selected" onClick={()=>p.navigate('Settings')}><Sun size={18}/><span>Appearance</span></button></nav><div className="context-hint"><GearSix size={21}/><p>Make yourself at home.</p><span>Theme preferences stay with this browser.</span></div></>}
   </div>
   <footer className="context-footer"><span>APPEARANCE</span><div className="context-theme-switch">{([{id:'light',icon:Sun,label:'Light mode'},{id:'dark',icon:Moon,label:'Dark mode'},{id:'system',icon:Desktop,label:'System theme'}] as const).map(({id,icon:Icon,label})=><button key={id} title={label} aria-label={label} aria-pressed={p.theme===id} className={p.theme===id?'selected':''} onClick={()=>p.setTheme(id)}><Icon size={15}/></button>)}</div></footer>
  </aside>
 </Tooltip.Provider>
}
