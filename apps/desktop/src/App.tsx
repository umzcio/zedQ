import {TooltipButton,ControlTooltip} from '@zq/ui'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { type WorkspaceState, type FileDocument, type View, type ModuleManifest, type ModuleDefinition, type SettingsSection, ModuleHostProvider } from '@zq/module-api'
import { SelectInteractionContext, Dialog, DialogContent, DialogTitle, DialogDescription } from '@zq/ui'
import { MagnifyingGlass, ArrowRight, FileText, Kanban } from '@phosphor-icons/react'
import Navigation from './Navigation'
import Settings from './Settings'
import { createCommandBus } from './command-bus'
import { ModuleBoundary, type LoadedModule } from './module-loader'

type Props={initialState:WorkspaceState;initialFiles:FileDocument[];onSnapshot:(state:WorkspaceState)=>void;onFilesChange:(files:FileDocument[])=>void;saveStatus:string;onWorkspaceFlush:()=>Promise<void>;onFileFlush:(flush:()=>Promise<void>)=>void;closing:boolean;modules:LoadedModule[]}
export default function App({initialState,initialFiles,onSnapshot,onFilesChange,saveStatus,onWorkspaceFlush,onFileFlush,closing,modules}:Props){
 const moduleFlushes=useRef(new Map<string,()=>Promise<void>>()),fileFlush=useRef<()=>Promise<void>>(async()=>{});
 const registerFlush=useCallback((id:string,flush:()=>Promise<void>)=>{moduleFlushes.current.set(id,flush);return()=>{moduleFlushes.current.delete(id)}},[]);
 useLayoutEffect(()=>{onFileFlush(async()=>{await fileFlush.current();for(const flush of moduleFlushes.current.values())await flush()})},[onFileFlush]);
 const setFileFlush=useCallback((flush:()=>Promise<void>)=>{fileFlush.current=flush},[]);
 const [workspace,setWorkspace]=useState(initialState)
 const [focusMode,setFocusMode]=useState(false),[notice,setNotice]=useState('')
 const [settingsSection,setSettingsSection]=useState<SettingsSection>('appearance')
 const [query,setQuery]=useState(''),[searchOpen,setSearchOpen]=useState(false)
 const [viewTarget,setViewTarget]=useState<HTMLElement|null>(null),[sidebarTarget,setSidebarTarget]=useState<HTMLElement|null>(null),[settingsTarget,setSettingsTarget]=useState<HTMLElement|null>(null)
 const [connectorsSettingsTarget,setConnectorsSettingsTarget]=useState<HTMLElement|null>(null)
 const [skillsSettingsTarget,setSkillsSettingsTarget]=useState<HTMLElement|null>(null)
 const commands=useMemo(()=>createCommandBus(name=>setNotice(`${name.split('.')[0]} is unavailable. Check Settings → Modules.`)),[])
 const {notes,tasks,theme,palette,layout}=workspace,view=layout.view
 const previousPage=useRef<Exclude<View,'Settings'>>(initialState.layout.view==='Settings'?'HQ':initialState.layout.view)
 useLayoutEffect(()=>{if(view!=='Settings')previousPage.current=view},[view])
 const navigate=useCallback((next:View)=>{setWorkspace(old=>({...old,layout:{...old.layout,view:next}}));setFocusMode(false);setSearchOpen(false)},[])
 const openSettings=useCallback((section:SettingsSection)=>{setSettingsSection(section);navigate('Settings')},[navigate])
 const setTheme=(next:WorkspaceState['theme'])=>setWorkspace(old=>({...old,theme:next}))
 const setPalette=(next:WorkspaceState['palette'])=>setWorkspace(old=>({...old,palette:next}))
 useEffect(()=>{const media=matchMedia('(prefers-color-scheme: dark)');const apply=()=>document.documentElement.dataset.theme=theme==='system'?(media.matches?'dark':'light'):theme;apply();media.addEventListener('change',apply);return()=>media.removeEventListener('change',apply)},[theme])
 useEffect(()=>{document.documentElement.dataset.palette=palette},[palette])
 useLayoutEffect(()=>{onSnapshot(workspace)},[workspace,onSnapshot])
 useEffect(()=>{if(!notice)return;const timer=setTimeout(()=>setNotice(''),3200);return()=>clearTimeout(timer)},[notice])
 useEffect(()=>window.zq.onCommand(command=>{
  if(closing||document.querySelector('[role="dialog"][data-state="open"]'))return
  if(command==='new-note')commands.run('notes.new',undefined)
  if(command==='open-file')commands.run('files.open',undefined)
  if(command==='settings')navigate('Settings')
  if(command==='save'||command==='save-as')commands.run('files.save',command==='save'?'save':'saveAs')
 }),[closing,commands,navigate])
 useEffect(()=>{function keydown(e:KeyboardEvent){if(!closing&&!document.querySelector('[role="dialog"][data-state="open"]')&&(e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='k'){e.preventDefault();setSearchOpen(o=>!o)}}window.addEventListener('keydown',keydown);return()=>window.removeEventListener('keydown',keydown)},[closing])
 useEffect(()=>{
  if(view!=='Settings'||closing)return
  function keydown(e:KeyboardEvent){
   // Radix dismisses the topmost dialog/menu first and prevents its Escape event.
   if(e.key!=='Escape'||e.defaultPrevented||e.repeat||e.isComposing)return
   e.preventDefault();navigate(previousPage.current)
  }
  window.addEventListener('keydown',keydown)
  return()=>window.removeEventListener('keydown',keydown)
 },[view,closing,navigate])
 const manifests=modules.map(m=>m.manifest)
 const targets=useMemo(()=>({view:viewTarget,sidebar:sidebarTarget,settings:settingsTarget,skillsSettings:skillsSettingsTarget,connectorsSettings:connectorsSettingsTarget}),[viewTarget,sidebarTarget,settingsTarget,skillsSettingsTarget,connectorsSettingsTarget])
 const baseHost={workspace,setWorkspace,closing,saveStatus,initialFiles,onFilesChange,onFileFlush:setFileFlush,registerFlush,flushWorkspace:onWorkspaceFlush,commands,navigate:(next:View)=>next==='Settings'?openSettings('connections'):navigate(next),openSettings,notify:setNotice,focusMode,setFocusMode,targets}
 const services=useMemo(()=>({connectors:window.zq.connectors,clipboard:window.zq.clipboard,artifacts:window.zq.artifacts,voice:window.zq.voice,files:window.zq.files,chat:window.zq.chat,attachments:window.zq.attachments}),[])
 function servicesFor(manifest:ModuleManifest){return Object.fromEntries(Object.entries(services).map(([key,value])=>[key,manifest.capabilities.includes(key)?value:new Proxy({},{get(){throw Error(`Module ${manifest.id} cannot access ${key}`)}})])) as typeof services}
 return <SelectInteractionContext.Provider value={closing}><div className={`app-shell ${view==='Chat'?'chat-shell':''} ${!layout.sidebar||focusMode?'sidebar-hidden':''}`}>
  <Navigation settingsSection={settingsSection} onSettingsSection={setSettingsSection} modules={manifests} commands={commands} disabled={closing} view={view} theme={theme} collapsed={!layout.sidebar||focusMode} navigate={navigate} setTheme={setTheme} search={()=>{setQuery('');setSearchOpen(true)}} sidebarRef={setSidebarTarget} toggleSidebar={()=>{if(focusMode){setFocusMode(false);setWorkspace(old=>({...old,layout:{...old.layout,sidebar:true}}))}else setWorkspace(old=>({...old,layout:{...old.layout,sidebar:!old.layout.sidebar}}))}}/>
  <div className="main-shell"><main className={`main-content view-${view.toLowerCase()}`}><div className="module-view-slot" ref={setViewTarget}/>{view==='Settings'&&<Settings section={settingsSection} theme={theme} palette={palette} setTheme={setTheme} setPalette={setPalette} closing={closing} settingsRef={setSettingsTarget} skillsSettingsRef={setSkillsSettingsTarget} connectorsSettingsRef={setConnectorsSettingsTarget}/>}</main><footer className="app-status"><ControlTooltip content={saveStatus.startsWith('Unable')?"Saving failed. Keep zQ open so your latest changes can be saved.":saveStatus.startsWith('Saving')?"Writing your latest workspace changes to this Mac":"Your workspace changes are saved locally on this Mac"}><span tabIndex={0}><span className={`storage-dot ${saveStatus.startsWith('Unable')?'error':''}`}/>{saveStatus}</span></ControlTooltip></footer></div>
  {modules.map(module=><ModuleHostProvider key={module.manifest.id} value={{...baseHost,manifest:module.manifest,services:servicesFor(module.manifest)}}><ModuleBoundary module={module} active={view===module.manifest.view}><module.Root/></ModuleBoundary></ModuleHostProvider>)}
  <Dialog open={searchOpen} onOpenChange={setSearchOpen}><DialogContent inert={closing} className="command-dialog"><DialogTitle className="sr-only">Find anything</DialogTitle><DialogDescription className="sr-only">Search your notes and tasks, or open a workspace view.</DialogDescription><div className="command-input"><MagnifyingGlass size={21}/><input autoFocus aria-label="Search workspace" placeholder="Find a note, task, or somewhere to go…" value={query} onChange={e=>setQuery(e.target.value)}/></div><div className="command-results"><div className="list-caption">GO TO</div>{([...manifests.map(m=>m.view),'Settings'] as View[]).filter(v=>v.toLowerCase().includes(query.toLowerCase())).map(v=><TooltipButton tooltip={`Open ${v==='HQ'?'workspace home':v}`} key={v} onClick={()=>navigate(v)}><ArrowRight size={16}/>{v}<span>Open view</span></TooltipButton>)}<div className="list-caption">NOTES & TASKS</div>{notes.filter(n=>(n.title+n.body).toLowerCase().includes(query.toLowerCase())).map(n=><TooltipButton tooltip={`Open note: ${n.title||'Untitled'}`} key={n.id} onClick={()=>{setSearchOpen(false);commands.run('notes.open',n.id)}}><FileText size={16}/>{n.title||'Untitled'}<span>Note</span></TooltipButton>)}{tasks.filter(t=>t.title.toLowerCase().includes(query.toLowerCase())).map(t=><TooltipButton tooltip={`Open task details: ${t.title}`} key={t.id} onClick={()=>{setSearchOpen(false);commands.run('tasks.edit',{...t})}}><Kanban size={16}/>{t.title}<span>{t.status}</span></TooltipButton>)}{query&&!notes.some(n=>(n.title+n.body).toLowerCase().includes(query.toLowerCase()))&&!tasks.some(t=>t.title.toLowerCase().includes(query.toLowerCase()))&&![...manifests.map(m=>m.view.toLowerCase()),'settings'].some(v=>v.includes(query.toLowerCase()))&&<p className="no-results">Nothing here yet. Try another word.</p>}</div><footer><span>Find your way back to a thought.</span><kbd>esc to close</kbd></footer></DialogContent></Dialog>
  {notice&&<div className="toast" role="status">{notice}</div>}
 </div></SelectInteractionContext.Provider>
}
