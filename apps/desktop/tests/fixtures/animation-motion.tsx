import {useLayoutEffect,useState} from 'react'
import {createRoot} from 'react-dom/client'
import {Dialog,DialogContent,DialogTitle,DialogDescription,Popover,PopoverTrigger,PopoverContent,HoverCard,HoverCardTrigger,HoverCardContent,Collapsible,CollapsibleTrigger,CollapsibleContent,TooltipProvider} from '@zq/ui'
import {CaretRight} from '@phosphor-icons/react'
import ShellNotice from '../../src/ShellNotice'
import {useWorkspaceSaveNotice} from '../../src/useWorkspaceSaveNotice'
import CodeArrivalMotion from './code-arrival-motion'
import CopyFeedbackMotion from './copy-feedback-motion'
import ModuleUpdateMotion from './module-update-motion'
import TransferCompletionMotion from './transfer-completion-motion'
import {AttachmentCard} from '../../../../modules/chat/AttachmentTray'
import {useAttachmentEntry} from '../../../../modules/chat/useAttachmentEntry'
import WorkspaceTabs from '../../../../modules/notes/WorkspaceTabs'
import type {TabState} from '../../../../modules/notes/tab-state'
import '@zq/ui/styles.css'
import '../../src/shell.css'
import '../../../../modules/notes/styles.css'
import chatCSS from '../../../../modules/chat/chat.css?inline'
import appearanceCSS from '../../../../modules/chat/appearance.css?inline'
import './animation-motion.css'

const documents=Array.from({length:24},(_,i)=>({key:`note:${i}`,title:`Document ${i+1}`,note:{id:String(i),title:`Document ${i+1}`,pinned:false}}))
const initialTabs:TabState={order:documents.map(d=>d.key),active:documents[0].key}
function Fixture(){
 const [state,setState]=useState({saveStatus:'Saved on this Mac',notice:'',noticeMounted:true,search:false,dialog:false,popover:false,hover:false,hoverPosition:'center',owner:'draft-a',attachments:['saved'],ready:true,disclosure:false,projectOpen:false,disclosureText:'Short thought',tabsMounted:true,tabsDisabled:false,chatCSS:'after',theme:'light'})
 const [tabs,setTabs]=useState(initialTabs)
 const {message:saveNotice,urgent:saveFailure}=useWorkspaceSaveNotice(state.saveStatus)
 const entry=useAttachmentEntry(state.owner,state.attachments,state.ready)
 useLayoutEffect(()=>{
  const api={patch:(patch:Partial<typeof state>)=>setState(s=>({...s,...patch})),resetTabs:()=>setTabs(initialTabs),snapshot:()=>({state,tabs,entering:[...entry.entering]})}
  ;(window as any).motionFixture=api
 },[state,tabs,entry.entering])
 useLayoutEffect(()=>{document.documentElement.dataset.theme=state.theme},[state.theme])
 useLayoutEffect(()=>{
  if(state.chatCSS==='absent')return
  const style=document.createElement('style');style.dataset.fixtureChat='true';style.textContent=chatCSS+'\n'+appearanceCSS
  if(state.chatCSS==='before')document.head.prepend(style);else document.head.append(style)
  return()=>style.remove()
 },[state.chatCSS])
 useLayoutEffect(()=>{
  const key=(event:KeyboardEvent)=>{if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==='k'&&!document.querySelector('[role=dialog][data-state=open]')){event.preventDefault();setState(s=>({...s,search:true}))}}
  window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key)
 },[])
 return <TooltipProvider><main className="motion-fixture">
  <h1>Motion regression workspace</h1><p>Disposable component fixtures. No service calls or stored workspace changes.</p>
  <section><button id="search-trigger" onClick={()=>setState(s=>({...s,search:true}))}>Search workspace</button><button onClick={()=>setState(s=>({...s,dialog:true}))}>Open ordinary dialog</button>
   <Popover open={state.popover} onOpenChange={popover=>setState(s=>({...s,popover}))}><PopoverTrigger asChild><button>Appearance popover</button></PopoverTrigger><PopoverContent><p>Shared popover content</p></PopoverContent></Popover>
  </section>
  <Dialog open={state.search} onOpenChange={search=>setState(s=>({...s,search}))}><DialogContent motion="none" className="command-dialog" onCloseAutoFocus={event=>{event.preventDefault();document.getElementById('search-trigger')?.focus()}}><DialogTitle className="sr-only">Find anything</DialogTitle><DialogDescription className="sr-only">Search this fixture workspace.</DialogDescription><div className="command-input"><input autoFocus aria-label="Search workspace" placeholder="Find anything"/></div><div className="command-results">No persisted data in this workspace.</div></DialogContent></Dialog>
  <Dialog open={state.dialog} onOpenChange={dialog=>setState(s=>({...s,dialog}))}><DialogContent><DialogTitle>Ordinary confirmation</DialogTitle><DialogDescription>Shared motion stays on occasional dialogs.</DialogDescription><button onClick={()=>setState(s=>({...s,dialog:false}))}>Finish confirmation</button></DialogContent></Dialog>
  <section><h2>Draft references</h2><div className="attachment-tray" data-testid="attachments">{state.attachments.map(id=><AttachmentCard key={id} item={{id,name:id+'.txt',kind:'text',size:120,preview:'fixture'}} onPreview={()=>{}} onRemove={()=>setState(s=>({...s,attachments:s.attachments.filter(x=>x!==id)}))} animateEntry={entry.entering.has(id)} onEntryComplete={()=>entry.consume(id)}/>)}</div><div className="attachment-tray" data-testid="historical"><AttachmentCard item={{id:'history',name:'Historical reference.txt',kind:'text',size:120,preview:'saved'}} onPreview={()=>{}}/></div></section>
  <section><Collapsible open={state.disclosure} onOpenChange={disclosure=>setState(s=>({...s,disclosure}))}><CollapsibleTrigger className="chat-thinking-trigger"><CaretRight size={18}/>Thought process</CollapsibleTrigger><CollapsibleContent data-testid="disclosure"><p style={{whiteSpace:'pre-wrap'}}>{state.disclosureText}</p></CollapsibleContent></Collapsible></section>
  <section className="fixture-projects"><Collapsible open={state.projectOpen} onOpenChange={projectOpen=>setState(s=>({...s,projectOpen}))}><CollapsibleTrigger className="chat-project-row" aria-label="Fixture project sessions">Project sessions<CaretRight className="project-expand-caret" size={14}/></CollapsibleTrigger><CollapsibleContent data-testid="project-disclosure">{Array.from({length:30},(_,i)=><div key={i}>Saved session {i+1}</div>)}</CollapsibleContent></Collapsible></section>
  <section className="fixture-tabs"><h2>Open documents</h2>{state.tabsMounted&&<div className="tabs"><WorkspaceTabs state={tabs} documents={documents} onChange={setTabs} onNew={()=>{}} onRenameNote={()=>{}} onToggleNotePin={()=>{}} disabled={state.tabsDisabled}/></div>}</section>
  <CodeArrivalMotion/>
  <CopyFeedbackMotion/>
  <ModuleUpdateMotion/>
  <TransferCompletionMotion/>
  <HoverCard open={state.hover} onOpenChange={hover=>setState(s=>({...s,hover}))} openDelay={250} closeDelay={120}><HoverCardTrigger asChild><a href="#citation" className={'fixture-citation position-'+state.hoverPosition}>[1]</a></HoverCardTrigger><HoverCardContent style={{width:260}}><strong>Citation preview</strong><p>Trigger-anchored preview near viewport edges.</p></HoverCardContent></HoverCard>
  {state.noticeMounted&&<ShellNotice notice={saveFailure?saveNotice:state.notice||saveNotice}/>}
 </main></TooltipProvider>
}
createRoot(document.getElementById('root')!).render(<Fixture/> )
