import {useId,useRef,useState} from 'react'
import {useHost,unwrap,type Connector} from '@zq/module-api'
import {Button,Input,Checkbox,Collapsible,CollapsibleTrigger,CollapsibleContent,Dialog,DialogContent,DialogTitle,DialogDescription,ContextMenu,ContextMenuTrigger,ContextMenuContent,ContextMenuItem} from '@zq/ui'
import {CaretRight} from '@phosphor-icons/react'

type Tool=Connector['tools'][number]
function toolLabel(tool:Tool){
 if(tool.title&&tool.title!==tool.name)return tool.title
 const name=tool.name.split('.').at(-1)!.replace(/[_-]+/g,' ').replace(/([a-z])([A-Z])/g,'$1 $2')
 return name.charAt(0).toUpperCase()+name.slice(1)
}
function ToolRow({tool,disabled,toggle,copy}:{tool:Tool;disabled:boolean;toggle:(name:string,on:boolean)=>void;copy:(name:string)=>void}){
 const [open,setOpen]=useState(false),id=useId(),label=toolLabel(tool)
 const summary=(tool.description??'').trim().split(/\n\s*\n/)[0].replace(/[`*#]/g,'').replace(/\s+/g,' ')
 return <ContextMenu><ContextMenuTrigger asChild><div className="connector-tool-row"><Collapsible open={open} onOpenChange={setOpen}>
  <div className="connector-tool-line"><Checkbox id={id} aria-label={`Enable ${tool.title||tool.name}`} checked={tool.enabled} disabled={disabled} onCheckedChange={checked=>toggle(tool.name,checked===true)}/><label htmlFor={id} className="connector-tool-copy"><strong>{label}</strong>{summary&&<span>{summary}</span>}</label><CollapsibleTrigger className="connector-tool-details-toggle" aria-label={`Details for ${label}`}><CaretRight size={14}/></CollapsibleTrigger></div>
  <CollapsibleContent><div className="connector-tool-details"><code>{tool.name}</code>{tool.description&&<p>{tool.description}</p>}{tool.readOnly&&<small>Reported as read-only by this connector.</small>}</div></CollapsibleContent>
 </Collapsible></div></ContextMenuTrigger><ContextMenuContent><ContextMenuItem disabled={disabled} onSelect={()=>toggle(tool.name,!tool.enabled)}>{tool.enabled?'Disable tool':'Enable tool'}</ContextMenuItem><ContextMenuItem onSelect={()=>setOpen(!open)}>{open?'Hide details':'Show details'}</ContextMenuItem><ContextMenuItem onSelect={()=>copy(tool.name)}>Copy tool name</ContextMenuItem></ContextMenuContent></ContextMenu>
}
export default function ConnectorTools({connector,disabled,onClose,onCloseAutoFocus}:{connector:Connector;disabled:boolean;onClose:()=>void;onCloseAutoFocus:(event:Event)=>void}){
 const {services}=useHost(),[query,setQuery]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),lock=useRef(false)
 const search=query.trim().toLowerCase(),tools=connector.tools.filter(tool=>`${tool.name} ${toolLabel(tool)} ${tool.description}`.toLowerCase().includes(search)),selected=connector.tools.filter(tool=>tool.enabled).length,matchingSelected=tools.filter(tool=>tool.enabled).length,blocked=disabled||busy
 async function setSelection(names:string[]){
  if(disabled||lock.current)return
  lock.current=true;setBusy(true);setError('')
  try{await unwrap(services.connectors.setTools({id:connector.id,names}))}catch(e){setError((e as Error).message)}finally{lock.current=false;setBusy(false)}
 }
 function toggle(name:string,enabled:boolean){void setSelection(connector.tools.filter(tool=>tool.name===name?enabled:tool.enabled).map(tool=>tool.name))}
 function selectVisible(enabled:boolean){const visible=new Set(tools.map(tool=>tool.name));void setSelection(connector.tools.filter(tool=>visible.has(tool.name)?enabled:tool.enabled).map(tool=>tool.name))}
 async function copy(name:string){try{await unwrap(services.clipboard.writeText(name))}catch(e){setError((e as Error).message)}}
 return <Dialog open onOpenChange={open=>{if(!open&&!lock.current)onClose()}}><DialogContent className="connector-tools-dialog" onCloseAutoFocus={onCloseAutoFocus}>
  <DialogTitle>{connector.name} tools</DialogTitle><DialogDescription>Choose what {connector.name} can do in your chats. Changes save automatically.</DialogDescription>
  <Input aria-label="Search connector tools" placeholder="Find a tool…" value={query} onChange={e=>setQuery(e.target.value)}/>
  <div className="connector-tool-toolbar"><span role="status" aria-live="polite">{selected} of {connector.tools.length} selected{search?` · ${tools.length} matching`:''}</span><div><Button variant="ghost" disabled={blocked||!tools.length||matchingSelected===tools.length} onClick={()=>selectVisible(true)}>{search?'Select results':'Select all'}</Button><Button variant="ghost" disabled={blocked||!matchingSelected} onClick={()=>selectVisible(false)}>{search?'Clear results':'Clear all'}</Button></div></div>
  <div className="connector-tool-list" aria-busy={busy}>{tools.map(tool=><ToolRow key={tool.name} tool={tool} disabled={blocked} toggle={toggle} copy={copy}/>)}{!tools.length&&<p className="connector-tools-empty">{connector.tools.length?'No matching tools.':connector.status==='connected'?'This server has no tools.':'Connect to discover available tools.'}</p>}</div>
  {error&&<p role="alert" className="chat-error">{error}</p>}
  <div className="connector-tools-footer"><span>Tool approvals still apply.</span><Button variant="ghost" disabled={busy} onClick={onClose}>Done</Button></div>
 </DialogContent></Dialog>
}
