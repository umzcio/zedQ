import { TooltipButton } from '@zq/ui'
import { useHost } from '@zq/module-api'
import { useEffect, useRef, useState } from 'react'
import { Plus, GearSix, Trash, ArrowLeft, UploadSimple, MagnifyingGlass, PushPin } from '@phosphor-icons/react'
import { ProjectContextMenu, ProjectIconPicker } from './ProjectActions'
import SkillPicker from './SkillPicker'
import { ProjectIcon } from './ProjectIcon'
import { ChatContextMenu, ChatActionDialog, type ChatAction } from './ChatActions'
import { Popover, PopoverTrigger, PopoverContent } from '@zq/ui'
import { ContextMenu, ContextMenuTrigger, ContextMenuContent, ContextMenuItem } from '@zq/ui'
import {pinnedFirst} from './chat-organization'
import { ProjectDialog } from './ProjectDialog'
import { Button } from '@zq/ui'
import { AttachmentCard } from './AttachmentTray'
import AttachmentPreview from './AttachmentPreview'
import { unwrap } from '@zq/module-api'
import type { ChatController } from './useChat'


export function ChatProjectView({chat,closing}:{chat:ChatController;closing:boolean}){
 const {services,openSettings}=useHost()
 const project=chat.project!
 const [action,setAction]=useState<ChatAction|null>(null),[fileQuery,setFileQuery]=useState('')
 const [edit,setEdit]=useState(false),[remove,setRemove]=useState(false)
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[preview,setPreview]=useState<{id:string;name:string}|null>(null)
 const [fileMatches,setFileMatches]=useState<{key:string;results:{id:string;snippet:string}[]} | null>(null)
 const fileKey=JSON.stringify([project.id,fileQuery,project.files.map(f=>f.id)])
 useEffect(()=>{let live=true;const timer=setTimeout(()=>{void unwrap(services.chat.searchProjectFiles({id:project.id,query:fileQuery})).then(results=>{if(live)setFileMatches({key:fileKey,results})}).catch(e=>{if(live)setError(e.message)})},150);return()=>{live=false;clearTimeout(timer)}},[fileKey])
 const lock=useRef(false)
 async function upload(){
  if(closing||lock.current)return;lock.current=true;setBusy(true);setError('')
  let imported:string[]=[]
  try{const result=await unwrap(services.attachments.pick());imported=result.items.map(f=>f.id);if(imported.length)await unwrap(services.chat.addProjectFiles({id:project.id,attachmentIds:imported}));setError(result.errors.map(e=>`${e.name}: ${e.message}`).join('\n'))}
  catch(e){setError((e as Error).message)}finally{for(const id of imported)void services.attachments.discard(id);lock.current=false;setBusy(false)}
 }
 async function removeFile(id:string){if(closing||lock.current)return;lock.current=true;setBusy(true);setError('');try{await unwrap(services.chat.removeProjectFile({id:project.id,attachmentId:id}))}catch(e){setError((e as Error).message)}finally{lock.current=false;setBusy(false)}}
 return <div className="chat-project-page">
  <TooltipButton tooltip="Return to chats outside projects" className="project-back" onClick={()=>chat.openProject(null)}><ArrowLeft size={15}/>All chats</TooltipButton>
  <header><ProjectContextMenu project={project} chat={chat} disabled={busy||closing}><div className="project-heading"><Popover><PopoverTrigger asChild><TooltipButton className="project-heading-icon" aria-label="Edit project icon" tooltip="Choose an icon and color for this project" disabled={busy||closing}><ProjectIcon project={project} size={27}/></TooltipButton></PopoverTrigger><PopoverContent className="project-icon-popover" align="start" aria-label="Edit project icon"><ProjectIconPicker project={project} chat={chat} disabled={busy||closing}/></PopoverContent></Popover><h1>{project.name}</h1></div></ProjectContextMenu><div className="project-tools"><TooltipButton className="header-icon" aria-label="Project settings" tooltip="Edit this project’s name, instructions, skills, and default tools" onClick={()=>setEdit(true)} disabled={busy||closing}><GearSix size={18}/></TooltipButton><TooltipButton className="header-icon" aria-label="Delete project" tooltip="Review and delete this project" onClick={()=>setRemove(true)} disabled={busy||closing}><Trash size={18}/></TooltipButton></div></header>
  <p className="project-intro">A shared space for your conversations, files, and instructions.</p>
  <div className="project-context-grid">
   <section><header><h2>Instructions</h2><TooltipButton tooltip="Set instructions that apply to every chat in this project" onClick={()=>setEdit(true)} disabled={busy||closing}>{project.instructions?'Edit':'Add'}</TooltipButton></header><TooltipButton tooltip="Edit instructions used by every chat in this project" className="project-instructions-preview" onClick={()=>setEdit(true)} disabled={busy||closing}>{project.instructions||'Set the context, tone, or approach for every chat in this project.'}</TooltipButton></section>
   <section><header><h2>Files <span>{project.files.length||''}</span></h2><TooltipButton tooltip={project.files.length >= 10 ? 'Project file limit reached (10 files)' : 'Add reference files for all chats in this project'} onClick={()=>void upload()} disabled={busy||closing||project.files.length>=10}><UploadSimple size={15}/>{busy?'Adding…':'Add files'}</TooltipButton></header>
    <p className="project-files-hint">Images, PDFs, text & code · Up to 10 files and 100 KB of text.</p>
    {project.files.length>0&&<label className="project-file-search"><MagnifyingGlass size={13}/><input aria-label="Search project files" placeholder="Find a file…" value={fileQuery} onChange={e=>setFileQuery(e.target.value)}/></label>}
    <div className="project-files">{project.files.filter(file=>!fileQuery.trim()||fileMatches?.key===fileKey&&fileMatches.results.some(r=>r.id===file.id)).map(file=><ContextMenu key={file.id}><ContextMenuTrigger asChild disabled={busy||closing}><div><AttachmentCard item={file} disabled={busy||closing} onPreview={()=>setPreview(file)} onRemove={()=>void removeFile(file.id)}/>{fileQuery.trim()&&<small>{fileMatches?.results.find(r=>r.id===file.id)?.snippet}</small>}</div></ContextMenuTrigger><ContextMenuContent aria-label={`Project file actions for ${file.name}`}><ContextMenuItem onSelect={()=>setPreview(file)}>Preview</ContextMenuItem><ContextMenuItem className="chat-delete-action" disabled={busy||closing} onSelect={()=>void removeFile(file.id)}>Remove from project</ContextMenuItem></ContextMenuContent></ContextMenu>)}</div>
    {error&&<p role="alert" className="chat-action-error">{error}</p>}
   </section>
  </div>
  <section className="project-conversations"><header><h2>Skills</h2><SkillPicker skills={chat.state.skills??[]} selected={project.skillIds??null} inherited={[]} allowInherit={false} disabled={busy||closing} onManage={()=>openSettings?.('skills')} onChange={ids=>{if(lock.current)return;lock.current=true;setBusy(true);setError('');void chat.updateProject({id:project.id,skillIds:ids??[]}).catch(e=>setError(e.message)).finally(()=>{lock.current=false;setBusy(false)})}}/></header><p>{project.skillIds===undefined?'Relevant installed skills are selected automatically. Choose specific skills to limit selection, or No skills to turn them off.':'Chats inherit this skill selection. Each chat can choose its own selection.'}</p></section>
  <section className="project-conversations"><header><h2>Conversations</h2><Button tooltip="Start a chat using this project’s instructions and files" variant="ghost" onClick={()=>void chat.create()} disabled={closing||busy}><Plus size={16}/>New chat</Button></header>
   {pinnedFirst(chat.scopedConversations).map(c=><ChatContextMenu chat={chat} key={c.id} conversation={c} disabled={closing||busy} deleteDisabled={!!chat.fileBusy[c.id]||c.messages.some(m=>m.status==='streaming')} onOpen={chat.select} onAction={setAction}><TooltipButton tooltip={`Open ${c.title}. Right-click for chat actions.`} className="project-conversation" onClick={()=>chat.select(c.id)} onKeyDown={e=>{if(e.key==='F2'){e.preventDefault();setAction({kind:'rename',conversation:c})}}}><span>{c.title}{c.pinned&&<PushPin size={11} className="chat-pin-indicator"/>}</span><span>{new Date(c.updatedAt).toLocaleDateString(undefined,{month:'short',day:'numeric'})}</span></TooltipButton></ChatContextMenu>)}
   {!chat.scopedConversations.length&&<p>Start a chat. Your project’s files and instructions will be included automatically.</p>}
  </section>
  {action&&<ChatActionDialog action={action} projects={chat.state.projects} disabled={closing} onClose={()=>setAction(null)} onRename={chat.rename} onDelete={chat.remove} onMove={chat.move}/>}
  {(edit||remove)&&<ProjectDialog project={project} remove={remove} closing={closing} chat={chat} onClose={()=>{setEdit(false);setRemove(false)}}/>}
  {preview&&<AttachmentPreview target={preview} closing={closing} onClose={()=>setPreview(null)}/>}
 </div>
}
