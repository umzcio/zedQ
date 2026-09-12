import { TooltipButton } from '@zq/ui'
import { useEffect, useState } from 'react'
import { Plus, SquaresFour, MagnifyingGlass, FolderSimple, ChatsCircle, CaretRight, CaretDown, PushPin } from '@phosphor-icons/react'
import type { Conversation } from '@zq/module-api'
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, Collapsible, CollapsibleTrigger, CollapsibleContent } from '@zq/ui'
import {scopedChats,orderedProjects,type ConversationScope} from './chat-organization'
import { ProjectDialog } from './ProjectDialog'
import { ProjectContextMenu } from './ProjectActions'
import { ProjectIcon } from './ProjectIcon'
import type { ChatController } from './useChat'
import { ChatContextMenu, ChatActionDialog, type ChatAction } from './ChatActions'

export default function ChatSidebar({ chat, closing }: {
 chat: ChatController
 closing: boolean
}) {
 const [newProject,setNewProject]=useState(false)
 const [query, setQuery] = useState('')
 const [scope,setScope]=useState<ConversationScope>('active')
 const [search,setSearch]=useState<{key:string;matches:{conversationId:string;messageId?:string;versionId?:string;snippet:string}[];error:string}>({key:'',matches:[],error:''})
 const searchKey=JSON.stringify([query.trim(),scope]),searching=!!query.trim()&&search.key!==searchKey
 useEffect(()=>{if(!query.trim())return;let live=true;const timer=setTimeout(()=>{chat.searchConversations({query:query.trim(),scope}).then(matches=>{if(live)setSearch({key:searchKey,matches,error:''})}).catch(e=>{if(live)setSearch({key:searchKey,matches:[],error:(e as Error).message})})},160);return()=>{live=false;clearTimeout(timer)}},[query,scope,chat.state.revision])
 const searchMatches=search.key===searchKey?search.matches:[]
 const matchFor=(c:Conversation)=>searchMatches.find(result=>result.conversationId===c.id)
 const filteredChats=(projectId:string|null)=>scopedChats(chat.state.conversations,scope,projectId).filter(c=>!query.trim()||!!matchFor(c))
 const [action, setAction] = useState<ChatAction | null>(null)
 const [expanded, setExpanded] = useState<Set<string>>(()=>new Set())
 const activeProjectId = chat.project?.id
 useEffect(()=>{if(activeProjectId)setExpanded(old=>new Set(old).add(activeProjectId))},[activeProjectId])
 const conversations = filteredChats(null)
 function renderConversation(c:Conversation) {
  const match=matchFor(c)
  const earlierVersion=!!match?.versionId&&!c.messages.some(m=>m.id===match.messageId&&m.activeVersionId===match.versionId)
  const open=()=>void chat.select(c.id,match?.messageId,match?.versionId)
  function highlighted(text:string){const index=text.toLowerCase().indexOf(query.trim().toLowerCase());return index<0||!query.trim()?text:<>{text.slice(0,index)}<mark>{text.slice(index,index+query.trim().length)}</mark>{text.slice(index+query.trim().length)}</>}
  return <ChatContextMenu chat={chat} key={c.id} conversation={c} disabled={closing} deleteDisabled={!!chat.fileBusy[c.id] || c.messages.some(m => m.status === 'streaming')} onOpen={open} onAction={setAction}><TooltipButton tooltip={`Open ${c.title}${match ? ' at the matching message' : ''}. Right-click for chat actions.`} className={`chat-recent ${!chat.artifactsView && !chat.projectHome && chat.conversation?.id === c.id ? 'selected' : ''}`} aria-current={!chat.artifactsView && !chat.projectHome && chat.conversation?.id === c.id ? 'page' : undefined} disabled={closing} onClick={open} onKeyDown={event => { if (event.key === 'F2') { event.preventDefault(); setAction({ kind: 'rename', conversation: c }) } }}>
   <span className="chat-recent-label"><span>{c.title}</span>{match?.snippet&&<small className="chat-match-snippet">{earlierVersion?'Earlier version · ':''}{highlighted(match.snippet)}</small>}</span>{c.pinned&&<PushPin className="chat-pin-indicator" size={11}/>}
   {c.messages.some(m => m.status === 'streaming') && <span className="chat-running" aria-label="Responding"/>}
  </TooltipButton></ChatContextMenu>
 }

 return <div className="chat-navigation">
  <div className="chat-navigation-actions">
   <TooltipButton tooltip={false} className="chat-new chat-primary-row" disabled={closing || chat.loading || !!chat.error} onClick={() => { setQuery('');setScope('active'); void chat.create() }}>
    <Plus size={18}/><span>New chat</span>
   </TooltipButton>
  </div>
  <div className="context-search chat-history-search chat-primary-row">
   <MagnifyingGlass size={18}/>
   <input aria-label="Search chats" placeholder="Search chats" value={query} onChange={e => setQuery(e.target.value)}/>
  </div>
  <TooltipButton tooltip="Browse chats outside projects" className="chat-all chat-primary-row" aria-current={!chat.artifactsView&&!chat.project?'page':undefined} onClick={()=>{setQuery('');setScope('active');chat.openProject(null)}} disabled={closing}><ChatsCircle size={18}/><span>All chats</span></TooltipButton>
  <TooltipButton tooltip="Browse documents and files created in your chats" className={`chat-all chat-primary-row ${chat.artifactsView?'selected':''}`} aria-current={chat.artifactsView?'page':undefined} onClick={()=>chat.openArtifacts()} disabled={closing}><SquaresFour size={18}/><span>Artifacts</span></TooltipButton>
  <section className="chat-projects" aria-labelledby="chat-projects-heading">
   <header><h2 id="chat-projects-heading">Projects</h2><TooltipButton className="header-icon" aria-label="New project" tooltip="Create a project with shared instructions, files, and chats" disabled={closing||chat.loading} onClick={()=>setNewProject(true)}><Plus size={15}/></TooltipButton></header>
   {orderedProjects(chat.state.projects).map(project=>{
    const children=filteredChats(project.id)
    if(query&&!children.length&&!project.name.toLowerCase().includes(query.toLowerCase()))return null
    return <Collapsible key={project.id} open={!!query||expanded.has(project.id)} onOpenChange={open=>setExpanded(old=>{const next=new Set(old);if(open)next.add(project.id);else next.delete(project.id);return next})}>
     <ProjectContextMenu project={project} chat={chat} disabled={closing}><CollapsibleTrigger asChild tooltip={false}><TooltipButton tooltip={`${query || expanded.has(project.id) ? 'Collapse' : 'Expand'} chats in ${project.name}. Right-click for project actions.`} disabled={closing} className={`chat-project-row ${chat.projectHome&&activeProjectId===project.id?'selected':''}`}><ProjectIcon project={project} size={18}/><span>{project.name}</span>{project.pinned&&<PushPin className="chat-pin-indicator" size={10}/>}<CaretRight className="project-expand-caret" size={12}/></TooltipButton></CollapsibleTrigger></ProjectContextMenu>
     <CollapsibleContent><nav className="chat-recent-list chat-project-children" aria-label={`${project.name} conversations`}>
      {children.map(renderConversation)}
      {!children.length&&<p className="project-chats-empty">{query?'No matching chats':'No project chats'}</p>}
     </nav></CollapsibleContent>
    </Collapsible>
   })}
   {!chat.state.projects.length&&<TooltipButton tooltip="Create a project with shared instructions, files, and chats" className="chat-project-row" onClick={()=>setNewProject(true)} disabled={closing}><FolderSimple size={17}/><span>Create a project</span></TooltipButton>}
  </section>
  <section className="chat-recents" aria-labelledby="chat-recents-heading">
   <header className="chat-recents-heading"><h2 id="chat-recents-heading">{scope==='active'?'Recents':scope==='archived'?'Archive':'Trash'}</h2><DropdownMenu><DropdownMenuTrigger asChild><TooltipButton type="button" aria-label="Conversation scope" tooltip="Choose active chats, archived chats, or Trash"><CaretDown size={13}/></TooltipButton></DropdownMenuTrigger><DropdownMenuContent align="end">{([{value:'active',label:'Active chats'},{value:'archived',label:'Archive'},{value:'trash',label:'Trash'}] as const).map(item=><DropdownMenuItem key={item.value} onSelect={()=>setScope(item.value)}>{item.label}{scope===item.value?' ✓':''}</DropdownMenuItem>)}</DropdownMenuContent></DropdownMenu></header>
   <nav className="chat-recent-list" aria-label={scope==='active'?'Recent conversations':scope==='archived'?'Archived conversations':'Deleted conversations'}>
    {conversations.map(renderConversation)}
   </nav>
   {searching?<p className="context-empty" role="status">Searching messages…</p>:query.trim()&&search.error?<p className="context-empty" role="alert">{search.error}</p>:chat.loading ? <p className="context-empty">Loading chats…</p> : !conversations.length && <p className="context-empty">{query ? 'No chats found.' : scope==='active'?'Your conversations will appear here.':scope==='archived'?'No archived chats.':'Trash is empty.'}</p>}
  </section>
  {newProject&&<ProjectDialog closing={closing} chat={chat} onClose={()=>setNewProject(false)}/>}
  {action && <ChatActionDialog key={`${action.kind}:${action.conversation.id}`} action={action} disabled={closing} onClose={() => setAction(null)} onRename={chat.rename} onDelete={chat.remove} onMove={chat.move} projects={chat.state.projects}/>}
 </div>
}
