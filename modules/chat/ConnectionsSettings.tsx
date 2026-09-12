import { useHost, unwrap, type Connection } from '@zq/module-api'
import { DotsThree, Plus, PencilSimple, PlugsConnected, Trash, SlidersHorizontal } from '@phosphor-icons/react'
import { useRef, useState } from 'react'
import { Button, DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, ContextMenu, ContextMenuTrigger, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, Dialog, DialogContent, DialogTitle, DialogDescription } from '@zq/ui'
import { ConnectionDialog, connectionProviders } from './ConnectionDialog'
import { ProviderLogo } from './ProviderLogo'
import { ManageModels } from './ManageModels'
import type { ChatController } from './useChat'

function CheckResult({models,name}:{models:string[];name:string}){return <><p role="status">{name} · Connected · {models.length} models available</p>{models.length>0&&<details><summary>View models</summary><ul className="connection-model-list" aria-label="Available models">{models.map(model=><li key={model}>{model}</li>)}</ul></details>}</>}

export default function ConnectionsSettings({ chat, closing }: { chat: ChatController; closing: boolean }) {
 const { services } = useHost()
 const [editor, setEditor] = useState<{ connection?: Connection } | null>(null)
 const [modelConnection,setModelConnection]=useState<Connection|null>(null)
 const [remove, setRemove] = useState<Connection | null>(null)
 const [busy, setBusy] = useState(''), [error, setError] = useState(''), [message, setMessage] = useState('')
 const [models, setModels] = useState<string[] | null>(null)
 const pending = useRef(false), openingDialog = useRef(false), origin = useRef<HTMLButtonElement | null>(null)
 const addButton = useRef<HTMLButtonElement>(null), cancelButton = useRef<HTMLButtonElement>(null)
 const rowButtons = useRef(new Map<string, HTMLButtonElement>())
 const stateError = chat.error || chat.state.error
 const disabled = !!busy || closing || chat.loading || !!stateError
 function resetResult() { setError(''); setMessage(''); setModels(null) }
 function open(connection?: Connection, deleting = false) {
  if (disabled) return
  origin.current = connection ? rowButtons.current.get(connection.id) ?? null : addButton.current
  resetResult()
  if (deleting && connection) setRemove(connection)
  else setEditor({ connection })
 }
 function manage(connection:Connection){if(disabled)return;origin.current=rowButtons.current.get(connection.id)??null;resetResult();setModelConnection(connection)}
 function restoreFocus(event: Event) {
  event.preventDefault()
  if (origin.current?.isConnected) origin.current.focus()
  else addButton.current?.focus()
 }
 async function test(connection: Connection) {
  if (disabled || pending.current) return
  pending.current = true; setBusy(connection.id); resetResult()
  try {
   const result = await unwrap(services.chat.testConnection({ id: connection.id, name: connection.name, provider: connection.provider, baseUrl: connection.baseUrl }))
   setModels(result); setMessage(connection.name)
  } catch (e) { setError((e as Error).message) }
  finally { pending.current = false; setBusy('') }
 }
 async function deleteConnection() {
  if (!remove || disabled || pending.current) return
  pending.current = true; setBusy(remove.id); setError('')
  try { await unwrap(services.chat.deleteConnection(remove.id)); setRemove(null); setMessage('Connection deleted. Your chats are kept.') }
  catch (e) { setError((e as Error).message) }
  finally { pending.current = false; setBusy('') }
 }
 return <section id="model-connections" className="connections-settings">
  <div className="connection-settings-heading settings-panel-header"><div><h2>Connections</h2><p>Connect your providers and choose the models you want in Chat.</p></div><Button ref={addButton} variant="outline" disabled={disabled} onClick={() => open()}><Plus size={15}/>Add provider</Button></div>
  {stateError && <p className="chat-error" role="alert">{stateError}</p>}
  {chat.loading ? <p role="status">Loading connections…</p> : !chat.state.connections.length && !stateError ? <p className="connection-empty">No connections yet. Add a provider to start chatting.</p> : null}
  <div className="connection-list">
   {chat.state.connections.map(connection => <ContextMenu key={connection.id}>
    <ContextMenuTrigger asChild disabled={disabled}><div className="connection-row settings-resource-row">
     <span className="settings-resource-icon" aria-hidden="true"><ProviderLogo provider={connection.provider} size={25}/></span>
     <button ref={node => { if (node) rowButtons.current.set(connection.id, node); else rowButtons.current.delete(connection.id) }} className="connection-summary" disabled={disabled} onClick={() => manage(connection)} aria-label={`Manage models for ${connection.name}`}>
      <strong>{connection.name}</strong><span>{connectionProviders.find(provider => provider.value === connection.provider)?.label} · {connection.enabledModels.length} {connection.enabledModels.length===1?'model':'models'} enabled</span>
     </button>
     <div className="connection-row-actions"><Button variant="ghost" disabled={disabled} onClick={()=>manage(connection)}>Manage models</Button>
      <DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="settings-more-button" disabled={disabled} aria-label={`Actions for ${connection.name}`}><DotsThree size={20}/></Button></DropdownMenuTrigger><DropdownMenuContent align="end" onCloseAutoFocus={event=>{if(openingDialog.current){event.preventDefault();openingDialog.current=false}}}>
       <DropdownMenuItem onSelect={()=>{openingDialog.current=true;manage(connection)}}><SlidersHorizontal size={15}/>Manage models…</DropdownMenuItem>
       <DropdownMenuItem onSelect={()=>{openingDialog.current=true;open(connection)}}><PencilSimple size={15}/>Edit connection…</DropdownMenuItem>
       <DropdownMenuItem onSelect={()=>void test(connection)}><PlugsConnected size={15}/>Test connection</DropdownMenuItem>
       <DropdownMenuSeparator/>
       <DropdownMenuItem className="chat-delete-action" onSelect={()=>{openingDialog.current=true;open(connection,true)}}><Trash size={15}/>Delete connection…</DropdownMenuItem>
      </DropdownMenuContent></DropdownMenu>
     </div>
    </div></ContextMenuTrigger>
    <ContextMenuContent aria-label={`Connection actions for ${connection.name}`} onCloseAutoFocus={event => { if (openingDialog.current) { event.preventDefault(); openingDialog.current = false } }}>
     <ContextMenuItem disabled={disabled} onSelect={()=>{openingDialog.current=true;manage(connection)}}><SlidersHorizontal size={15}/>Manage models…</ContextMenuItem>
     <ContextMenuItem disabled={disabled} onSelect={() => { openingDialog.current = true; open(connection) }}><PencilSimple size={15}/>Edit connection…</ContextMenuItem>
     <ContextMenuItem disabled={disabled} onSelect={() => void test(connection)}><PlugsConnected size={15}/>Test connection</ContextMenuItem>
     <ContextMenuSeparator/>
     <ContextMenuItem disabled={disabled} className="chat-delete-action" onSelect={() => { openingDialog.current = true; open(connection, true) }}><Trash size={15}/>Delete connection…</ContextMenuItem>
    </ContextMenuContent>
   </ContextMenu>)}
  </div>
  {!remove && error && <p className="chat-error" role="alert">{error}</p>}
  {models !== null ? <div className="connection-check-result"><CheckResult models={models} name={message}/></div> : message && <p className="connection-result" role="status">{message}</p>}
  {modelConnection&&<ManageModels key={modelConnection.id} connection={modelConnection} closing={closing} onClose={()=>setModelConnection(null)} onCloseAutoFocus={restoreFocus}/>}
  {editor && <ConnectionDialog connection={editor.connection} closing={closing} disabled={chat.loading || !!stateError} onClose={() => setEditor(null)} onSaved={name => { setEditor(null); setMessage(`${name} saved.`) }} onCloseAutoFocus={restoreFocus}/>}
  <Dialog open={!!remove} onOpenChange={open => { if (!open && !busy && !closing) { setRemove(null); setError('') } }}>
   <DialogContent className="connection-dialog" showCloseButton={!busy && !closing} onOpenAutoFocus={event => { event.preventDefault(); cancelButton.current?.focus() }} onCloseAutoFocus={restoreFocus}>
    <DialogTitle>Delete connection?</DialogTitle><DialogDescription>Remove “{remove?.name}” and its saved API key. Your chats and messages are kept; choose another connection to continue those chats.</DialogDescription>
    {error && <p className="chat-error" role="alert">{error}</p>}
    <div className="dialog-actions"><Button ref={cancelButton} variant="ghost" disabled={!!busy || closing} onClick={() => { setRemove(null); setError('') }}>Cancel</Button><Button variant="destructive" disabled={disabled} onClick={() => void deleteConnection()}>{busy ? 'Deleting…' : 'Delete connection'}</Button></div>
   </DialogContent>
  </Dialog>
 </section>
}
