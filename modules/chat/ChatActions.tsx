import { TooltipButton } from '@zq/ui'
import { useRef, useState, type ReactElement } from 'react'
import { ArrowSquareOut, PencilSimple, Trash, FolderSimple, DotsThree } from '@phosphor-icons/react'
import { ContextMenu, ContextMenuTrigger, ContextMenuContent, ContextMenuItem, ContextMenuSeparator } from '@zq/ui'
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@zq/ui'
import { Input } from '@zq/ui'
import { Button } from '@zq/ui'
import { SelectField } from '@zq/ui'
import { useHost } from '@zq/module-api'
import type { ChatController } from './useChat'
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from '@zq/ui'
import './chat-organization.css'
import type { Conversation, ChatProject } from '@zq/module-api'

export type ChatAction = { kind: 'rename' | 'delete' | 'move'; conversation: Conversation }

export function ChatContextMenu({ conversation:c, chat, disabled, deleteDisabled, onOpen, onAction, children }: {
 conversation: Conversation; chat:ChatController; disabled: boolean; deleteDisabled: boolean
 onOpen: (id: string) => void; onAction: (action: ChatAction) => void; children: ReactElement
}) {
 const {notify}=useHost(),[busy,setBusy]=useState(false),[open,setOpen]=useState(false),openingDialog = useRef(false),lock=useRef(false)
 function choose(kind: ChatAction['kind']) { openingDialog.current = true; onAction({ kind, conversation:c }) }
 async function run(action:()=>Promise<unknown>){if(disabled||lock.current)return;lock.current=true;setBusy(true);try{await action()}catch(e){notify((e as Error).message)}finally{lock.current=false;setBusy(false)}}
 const blocked=disabled||busy,mutating=blocked||deleteDisabled
 const actions=[
  {label:'Open chat',run:()=>onOpen(c.id),disabled:blocked},
  ...(!c.deletedAt?[{label:c.pinned?'Unpin chat':'Pin chat',run:()=>void run(()=>chat.updateConversation({id:c.id,pinned:!c.pinned})),disabled:blocked},{label:'Rename…',run:()=>choose('rename'),disabled:blocked},{label:'Move to project…',run:()=>choose('move'),disabled:mutating}]:[]),
  {label:'Export as Markdown…',run:()=>void run(()=>chat.exportConversation(c.id)),disabled:blocked},
  ...(c.deletedAt?[{label:'Restore chat',run:()=>void run(()=>chat.updateConversation({id:c.id,deleted:false})),disabled:mutating}]:[{label:c.archivedAt?'Restore from archive':'Archive chat',run:()=>void run(()=>chat.updateConversation({id:c.id,archived:!c.archivedAt})),disabled:mutating},{label:'Move to Trash…',run:()=>choose('delete'),disabled:mutating}]),
 ]
 function menuClose(event:Event){if(openingDialog.current){event.preventDefault();openingDialog.current=false}}
 return <ContextMenu><ContextMenuTrigger asChild disabled={disabled}><div className="chat-action-row" data-menu-open={open||undefined}>{children}<DropdownMenu onOpenChange={setOpen}><DropdownMenuTrigger asChild><TooltipButton tooltip={`Open actions for ${c.title}: rename, organize, export, or restore this chat`} type="button" className="chat-row-more" aria-label={`Actions for ${c.title}`} disabled={blocked}><DotsThree size={17}/></TooltipButton></DropdownMenuTrigger><DropdownMenuContent align="end" onCloseAutoFocus={menuClose}>{actions.map(action=><DropdownMenuItem key={action.label} disabled={action.disabled} onSelect={action.run}>{action.label}</DropdownMenuItem>)}</DropdownMenuContent></DropdownMenu></div></ContextMenuTrigger>
  {!disabled&&<ContextMenuContent aria-label={`Chat actions for ${c.title}`} onCloseAutoFocus={menuClose}>{actions.map(action=><ContextMenuItem key={action.label} disabled={action.disabled} onSelect={action.run}>{action.label}</ContextMenuItem>)}</ContextMenuContent>}
 </ContextMenu>
}

export function ChatActionDialog({ action, disabled, onClose, onRename, onDelete, onMove, projects }: {
 projects: ChatProject[]; onMove:(id:string, projectId:string|null)=>Promise<unknown>
 action: ChatAction; disabled: boolean; onClose: () => void
 onRename: (id: string, title: string) => Promise<unknown>; onDelete: (id: string) => Promise<unknown>
}) {
 const [projectId,setProjectId]=useState(action.conversation.projectId??'')
 const [title, setTitle] = useState(action.conversation.title)
 const [busy, setBusy] = useState(false), [error, setError] = useState('')
 const input = useRef<HTMLInputElement>(null), cancel = useRef<HTMLButtonElement>(null), saving = useRef(false)
 const rename = action.kind === 'rename', move = action.kind === 'move', blocked = busy || disabled
 async function submit() {
  if (blocked || saving.current || rename && !title.trim()) return
  saving.current = true; setBusy(true); setError('')
  try {
   if (rename) await onRename(action.conversation.id, title.trim())
   else if(move) await onMove(action.conversation.id,projectId||null)
   else await onDelete(action.conversation.id)
   onClose()
  } catch (e) { setError((e as Error).message) }
  finally { saving.current = false; setBusy(false) }
 }
 return <Dialog open onOpenChange={open => { if (!open && !blocked) onClose() }}>
  <DialogContent className="rename-note-dialog" showCloseButton={!blocked} onOpenAutoFocus={event => {
   event.preventDefault()
   if (rename) { input.current?.focus(); input.current?.select() } else cancel.current?.focus()
  }}>
   <DialogTitle>{rename ? 'Rename chat' : move ? 'Move to project' : 'Move chat to Trash?'}</DialogTitle>
   <DialogDescription>{rename ? 'Give this conversation a name you’ll recognize.' : move ? 'Future messages will use the selected project’s files and instructions.' : `“${action.conversation.title}” and its messages and attachments will stay in Trash until you restore them.`}</DialogDescription>
   <form onSubmit={event => { event.preventDefault(); void submit() }}>
    {rename && <><label htmlFor="rename-chat-title">Name</label><Input ref={input} id="rename-chat-title" aria-label="Chat name" value={title} maxLength={1024} disabled={blocked} onChange={event => setTitle(event.target.value)}/></>}
    {move && <SelectField label="Destination project" tooltip="Choose which project’s instructions and files future messages will use" value={projectId} onValueChange={setProjectId} disabled={blocked} options={[{value:'',label:'No project'},...projects.map(p=>({value:p.id,label:p.name}))]}/>}
    {error && <p className="chat-action-error" role="alert">{error}</p>}
    <div className="dialog-actions">
     <Button ref={cancel} type="button" variant="ghost" disabled={blocked} onClick={onClose}>Cancel</Button>
     <Button tooltip={rename ? 'Save this conversation’s new name' : move ? 'Move this chat; future messages use the destination project’s instructions and files' : 'Move this chat to Trash; you can restore it later'} type="submit" variant={rename || move ? 'default' : 'destructive'} className={rename || move ? 'primary-button' : 'chat-delete-confirm'} disabled={blocked || rename && !title.trim()}>{busy ? 'Saving…' : rename ? 'Rename' : move ? 'Move chat' : 'Move to Trash'}</Button>
    </div>
   </form>
  </DialogContent>
 </Dialog>
}
