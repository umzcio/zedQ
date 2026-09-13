import {useRef,useState} from 'react'
import {useHost,unwrap,type Connector,type ConnectorCatalogEntry} from '@zq/module-api'
import {DotsThree,MagnifyingGlass} from '@phosphor-icons/react'
import {Button,Input,SelectField,ContextMenu,ContextMenuTrigger,ContextMenuContent,ContextMenuItem,DropdownMenu,DropdownMenuTrigger,DropdownMenuContent,DropdownMenuItem} from '@zq/ui'
import type {ChatController} from './useChat'
import {ConnectorEditor} from './ConnectorSettings'
import {ConnectorLogo} from './ConnectorLogo'
import {catalogConnector,connectorNeedsSetup} from './connector-catalog'

export default function ConnectorDiscover({chat,disabled,onManage}:{chat:ChatController;disabled:boolean;onManage:(connector:Connector)=>void}){
 const {services}=useHost(),[query,setQuery]=useState(''),[category,setCategory]=useState('All categories'),[setup,setSetup]=useState<ConnectorCatalogEntry|null>(null),[busy,setBusy]=useState(''),[pending,setPending]=useState<Connector|null>(null),[cancelling,setCancelling]=useState(false),[error,setError]=useState('')
 const lock=useRef(false),origin=useRef<HTMLElement|null>(null),opening=useRef(false),cancelLock=useRef(false),buttons=useRef(new Map<string,HTMLButtonElement>())
 const entries=chat.connectorCatalog??[],blocked=disabled||!!busy
 const filtered=entries.filter(entry=>(category==='All categories'||entry.category===category)&&`${entry.name} ${entry.description} ${entry.publisher} ${entry.accountLabel}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
 function menuFocus(event:Event){if(opening.current){event.preventDefault();opening.current=false}}
 async function act(entry:ConnectorCatalogEntry){
  if(blocked||lock.current)return
  const existing=catalogConnector(chat.connectors,entry)
  if(existing){opening.current=true;onManage(existing);return}
  origin.current=buttons.current.get(entry.id)??document.activeElement as HTMLElement
  if(entry.requiresSetup){opening.current=true;setSetup(entry);return}
  lock.current=true;setBusy(entry.id);setError('')
  try{const rows=await unwrap(services.connectors.save({name:entry.name,url:entry.url,catalogId:entry.id,authType:entry.authType,clientId:entry.clientId,redirectPort:entry.redirectPort,redirectHost:entry.redirectHost}));const saved=catalogConnector(rows,entry);if(!saved)throw Error('Connector saved. Open Your connectors to connect.');setPending(saved);await unwrap(services.connectors.connect(saved.id))}catch(e){setError((e as Error).message)}finally{lock.current=false;setBusy('');setPending(null)}
 }
 async function cancelConnection(){if(!pending||cancelLock.current)return;cancelLock.current=true;setCancelling(true);try{await unwrap(services.connectors.disconnect(pending.id))}catch(e){setError((e as Error).message)}finally{cancelLock.current=false;setCancelling(false)}}
 async function copy(url:string){try{await unwrap(services.clipboard.writeText(url))}catch(e){setError((e as Error).message)}}
 async function docs(url:string){try{await unwrap(services.chat.openLink(url))}catch(e){setError((e as Error).message)}}
 return <div className="connector-discover">
 <div className="connector-discover-toolbar"><div className="connector-search"><MagnifyingGlass size={16} aria-hidden="true"/><Input aria-label="Search connectors" placeholder="Search connectors…" value={query} onChange={event=>setQuery(event.target.value)} disabled={disabled}/></div><SelectField label="Connector category" value={category} onValueChange={setCategory} options={['All categories','Research','Productivity','Development']} disabled={disabled}/></div>
 <p className="connector-help">Choose a service to connect or review its setup. Tools start disabled; enable them in Your connectors.</p>
 {chat.connectorCatalogLoading&&<p role="status">Loading Discover…</p>}
 {chat.connectorCatalogError&&<div className="connector-catalog-error"><p role="alert" className="chat-error">{chat.connectorCatalogError}</p><Button variant="ghost" disabled={disabled} onClick={chat.refreshConnectorCatalog}>Try again</Button></div>}
 {pending&&<div className="connector-pending"><span role="status">Connecting to {pending.name}. Finish sign-in in your browser if prompted.</span><Button variant="ghost" disabled={cancelling} onClick={()=>void cancelConnection()}>{cancelling?'Cancelling…':'Cancel connection'}</Button></div>}
 {error&&<p role="alert" className="chat-error">{error}</p>}
 <div className="connector-catalog-grid">{filtered.map(entry=>{
  const existing=catalogConnector(chat.connectors,entry),needsSetup=existing?connectorNeedsSetup(existing,entry):entry.requiresSetup
  const status=existing?(existing.status==='connected'?(existing.tools.some(tool=>tool.enabled)?'Connected':'Connected · Choose tools'):existing.status==='connecting'?'Connecting…':existing.status==='authenticating'?'Waiting for sign-in':existing.status==='error'?'Saved · Connection failed':needsSetup?'Saved · Setup required':'Saved · Not connected'):needsSetup?'Setup required':entry.id==='arxiv'?'No account required':'Sign-in required'
  const label=existing?'Manage':entry.requiresSetup?'Set up':'Add and connect'
  const actions=[{label:existing?'Manage connector…':entry.requiresSetup?'Set up connector…':'Add and connect',run:()=>void act(entry),disabled:blocked},{label:'Copy server URL',run:()=>void copy(entry.url),disabled:false},{label:'Publisher documentation',run:()=>void docs(entry.documentationUrl),disabled:false}]
  return <ContextMenu key={entry.id}><ContextMenuTrigger asChild><article className="connector-catalog-card" data-catalog-id={entry.id} aria-label={entry.name}><div className="connector-card-heading"><div className="connector-card-brand"><ConnectorLogo id={entry.id}/></div><DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="icon" tooltip={`Actions for ${entry.name}`} className="settings-more-button" aria-label={`Actions for catalog connector ${entry.name}`} disabled={blocked}><DotsThree size={18}/></Button></DropdownMenuTrigger><DropdownMenuContent align="end" onCloseAutoFocus={menuFocus}>{actions.map(action=><DropdownMenuItem key={action.label} disabled={action.disabled} onSelect={action.run}>{action.label}</DropdownMenuItem>)}</DropdownMenuContent></DropdownMenu></div><div className="connector-card-copy"><h3>{entry.name}</h3><span className="connector-account">{entry.accountLabel}</span><p>{entry.description}</p>{entry.id==='microsoft365'&&<p className="connector-card-note">Organization access and admin consent may be required.</p>}</div><div className="connector-card-footer"><span className="connector-catalog-status" data-connected={existing?.status==='connected'} role="status">{status}</span><Button ref={node=>{if(node)buttons.current.set(entry.id,node);else buttons.current.delete(entry.id)}} variant="outline" disabled={blocked} onClick={()=>void act(entry)} aria-label={`${label} ${entry.name}`}>{busy===entry.id?'Connecting…':label}</Button></div></article></ContextMenuTrigger><ContextMenuContent aria-label={`Catalog connector actions for ${entry.name}`} onCloseAutoFocus={menuFocus}>{actions.map(action=><ContextMenuItem key={action.label} disabled={action.disabled} onSelect={action.run}>{action.label}</ContextMenuItem>)}</ContextMenuContent></ContextMenu>
 })}</div>
 {!chat.connectorCatalogLoading&&!chat.connectorCatalogError&&!filtered.length&&<p className="connection-empty">No connectors match your search.</p>}
 {setup&&<ConnectorEditor entry={setup} connector={catalogConnector(chat.connectors,setup)} disabled={disabled} onClose={()=>setSetup(null)} onCloseAutoFocus={event=>{event.preventDefault();if(origin.current?.isConnected)origin.current.focus()}}/>}
 </div>
}
