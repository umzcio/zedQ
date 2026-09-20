import {useEffect,useState,useRef} from 'react'
import {useHost,unwrap,type ModelChoice,type ResearchCatalog,type ResearchCatalogItem,type ResearchDraft} from '@zq/module-api'
import {Button,TooltipButton,Input,Tabs,TabsList,TabsTrigger,TabsContent,Dialog,DialogContent,DialogTitle,DialogDescription,ContextMenu,ContextMenuTrigger,ContextMenuContent,ContextMenuItem} from '@zq/ui'
import {MagnifyingGlass,Globe,FileText,Plug,Stack} from '@phosphor-icons/react'
import type {ChatController} from './useChat'
export function useResearchCatalog(chat:ChatController,choice:ModelChoice|null,projectId:string|null){
 const host=useHost(),bridge=host.services.research,[state,setState]=useState<{key:string;value:ResearchCatalog|null;error:string}>({key:'',value:null,error:''})
 const input={conversationId:chat.conversation?.id,projectId,choice:choice??undefined,attachmentIds:(chat.files[chat.draftId]??[]).map(f=>f.id)}
 const key=JSON.stringify([input,chat.state.connections,chat.conversation?.archivedAt,chat.conversation?.deletedAt,chat.conversation?.messages.map(m=>[m.status,m.attachments?.map(a=>a.id)]),chat.conversation?.queue?.items.length,chat.state.projects.map(p=>[p.id,p.files]),chat.connectors,host.workspace.notes.map(n=>[n.id,n.title,n.updated])])
 useEffect(()=>{if(!bridge)return;let live=true;const timer=setTimeout(()=>{unwrap(bridge.catalog(input)).then(value=>{if(live)setState({key,value,error:''})}).catch(e=>{if(live)setState({key,value:null,error:e.message})})},100);return()=>{live=false;clearTimeout(timer)}},[bridge,key])
 return {catalog:state.key===key?state.value:null,error:state.key===key?state.error:'',loading:!!bridge&&state.key!==key}
}
const labels={web:'Web',note:'Note',project_file:'Project file',attachment:'Attachment',connector:'Connector'}
const scopeLabels={domains:'Allowed domains',papers:'Paper IDs',threads:'Thread IDs',files:'File IDs',calendars:'Calendar IDs',none:''}
function ScopeInput({row,scope,onCommit,disabled}:{row:ResearchCatalogItem;scope:string[];onCommit:(value:string)=>void;disabled:boolean}){
 const [text,setText]=useState(scope.join(', '))
 return <Input aria-label={`${scopeLabels[row.scopeKind]} for ${row.label}`} value={text} placeholder={row.scopeKind==='domains'?'example.org, another.org':'Comma-separated IDs; empty means account-wide'} disabled={disabled} onChange={e=>{setText(e.target.value);onCommit(e.target.value)}}/>
}
type SourceCategory='selected'|'web'|'files'|'notes'|'connectors'
const categories:{id:SourceCategory;label:string}[]=[{id:'selected',label:'Selected'},{id:'web',label:'Web'},{id:'files',label:'Files'},{id:'notes',label:'Notes'},{id:'connectors',label:'Connectors'}]
const pageSize=25
export default function ResearchSources({chat,catalog,value,onChange,disabled,open:controlledOpen,onOpenChange,initialCategory='selected'}:{open?:boolean;onOpenChange?:(open:boolean)=>void;initialCategory?:SourceCategory;chat:ChatController;catalog:ResearchCatalog|null;value:ResearchDraft;onChange:(value:ResearchDraft)=>void;disabled:boolean}){
 const trigger=useRef<HTMLButtonElement>(null),list=useRef<HTMLDivElement>(null),dialog=useRef<HTMLDivElement>(null)
 const host=useHost(),[localOpen,setLocalOpen]=useState(false),[query,setQuery]=useState(''),[error,setError]=useState(''),[category,setCategory]=useState<SourceCategory>('selected'),[page,setPage]=useState(0)
 const open=controlledOpen??localOpen,setOpen=onOpenChange??setLocalOpen
 // Listen before document-level tooltip dismissal, including when native
 // focus returns to the webview body rather than a control in the dialog.
 useEffect(()=>{
  if(!open||host.closing)return
  function escape(event:KeyboardEvent){
   if(event.key!=='Escape'||event.isComposing)return
   const dialogs=document.querySelectorAll('[role="dialog"][data-state="open"]')
   if(dialogs[dialogs.length-1]!==dialog.current||document.querySelector('[role="menu"][data-state="open"],[role="listbox"][data-state="open"]'))return
   event.preventDefault();event.stopPropagation();setOpen(false)
  }
  window.addEventListener('keydown',escape,true)
  return()=>window.removeEventListener('keydown',escape,true)
 },[open,host.closing,setOpen])
 const wasOpen=useRef(false)
 useEffect(()=>{if(open&&!wasOpen.current){setCategory(initialCategory);setQuery('');setPage(0)}wasOpen.current=open},[open,initialCategory])
 const selected=new Map(value.sources.map(s=>[s.id,s]))
 const cached=useRef<{id:string;catalog:ResearchCatalog|null}>({id:chat.draftId,catalog})
 if(cached.current.id!==chat.draftId)cached.current={id:chat.draftId,catalog}
 else if(catalog)cached.current.catalog=catalog
 const available=catalog??cached.current.catalog
 const missing:ResearchCatalogItem[]=value.sources.filter(s=>!available?.sources.some(row=>row.id===s.id)).map(s=>({...s,label:s.id,available:false,reason:'This selected source is unavailable. Remove it or restore access.',scopeKind:'none',scopeDescription:''}))
 const all=[...(available?.sources??[]),...missing]
 function inCategory(row:ResearchCatalogItem,id:SourceCategory){return id==='selected'?selected.has(row.id):id==='files'?['attachment','project_file'].includes(row.kind):row.kind===({web:'web',notes:'note',connectors:'connector'} as const)[id]}
 const rows=all.filter(row=>inCategory(row,category)&&(row.label+' '+labels[row.kind]).toLowerCase().includes(query.toLowerCase()))
 const lastPage=Math.max(0,Math.ceil(rows.length/pageSize)-1),currentPage=Math.min(page,lastPage),visible=rows.slice(currentPage*pageSize,(currentPage+1)*pageSize)
 useEffect(()=>{if(list.current)list.current.scrollTop=0},[category,query,currentPage])
 function changeCategory(id:SourceCategory){setCategory(id);setPage(0);setQuery('')}
 function toggle(row:ResearchCatalogItem){const sources=selected.has(row.id)?value.sources.filter(s=>s.id!==row.id):[...value.sources,{kind:row.kind,id:row.id,scope:[]}];onChange({...value,sources})}
 function scope(row:ResearchCatalogItem,text:string){const values=text.split(/[,\n]/).map(v=>v.trim()).filter(Boolean);onChange({...value,sources:value.sources.map(s=>s.id===row.id?{...s,scope:[...new Set(values)]}:s)})}
 return <><TooltipButton ref={trigger} type="button" className="chat-tools-trigger" aria-haspopup="dialog" aria-expanded={open} tooltip="Choose sources for this research" disabled={disabled} onClick={()=>setOpen(true)}><Stack size={16}/><span>Sources · {value.sources.length}</span></TooltipButton>
 <Dialog open={open&&!host.closing} onOpenChange={setOpen}><DialogContent ref={dialog} className="research-dialog research-source-picker" onCloseAutoFocus={e=>{e.preventDefault();trigger.current?.focus({preventScroll:true})}}><DialogTitle>Research sources</DialogTitle><DialogDescription>Choose what this research can read.</DialogDescription>
 <Tabs value={category} onValueChange={id=>changeCategory(id as SourceCategory)} className="research-source-tabs">
 <TabsList className="research-tabs research-source-categories" aria-label="Source categories">{categories.map(item=><TabsTrigger key={item.id} value={item.id} aria-label={item.label}>{item.label}<span aria-hidden="true">{all.filter(row=>inCategory(row,item.id)).length}</span></TabsTrigger>)}</TabsList>
 <div className="research-source-search"><Input aria-label="Find research sources" placeholder={`Search ${category==='selected'?'selected sources':category}…`} value={query} onChange={e=>{setQuery(e.target.value);setPage(0)}}/>{category==='files'&&<Button type="button" variant="outline" size="sm" disabled={disabled||!!chat.fileBusy[chat.draftId]} onClick={()=>void chat.addFiles(chat.draftId).catch(e=>setError(e.message))}>Add files…</Button>}</div>
 <TabsContent value={category} className="research-source-panel">
 <div className="research-source-list" ref={list}>{visible.map(row=>{
  const checked=selected.has(row.id),blocked=disabled||!checked&&(!row.available||value.sources.length>=30)
  return <ContextMenu key={row.id}><ContextMenuTrigger asChild><section className="research-source-row"><label><input type="checkbox" checked={checked} disabled={blocked} onChange={()=>toggle(row)} aria-label={`Use ${row.label}`}/>{row.kind==='web'?<Globe size={16}/>:row.kind==='connector'?<Plug size={16}/>:<FileText size={16}/>}<span><strong>{row.label}</strong><small>{labels[row.kind]}{!row.available?` · ${row.reason}`:''}</small></span></label>
   {checked&&<div className="research-source-scope">{row.scopeDescription&&<p>{row.scopeDescription}</p>}{row.scopeKind!=='none'&&<label>{scopeLabels[row.scopeKind]}<ScopeInput row={row} scope={selected.get(row.id)!.scope} disabled={disabled} onCommit={text=>scope(row,text)}/></label>}</div>}
  </section></ContextMenuTrigger><ContextMenuContent><ContextMenuItem disabled={blocked} onSelect={()=>toggle(row)}>{checked?'Remove from research':'Include in research'}</ContextMenuItem><ContextMenuItem onSelect={()=>void unwrap(host.services.clipboard.writeText(row.label)).catch(()=>host.notify('Could not copy source name.'))}>Copy source name</ContextMenuItem>{row.kind==='connector'&&host.openSettings&&<ContextMenuItem onSelect={()=>{setOpen(false);host.openSettings?.('connectors')}}>Connector settings</ContextMenuItem>}</ContextMenuContent></ContextMenu>
 })}{!visible.length&&<p className="research-source-empty">{!available?'Loading sources…':query?'No sources match your search.':category==='selected'?'Choose sources from the other tabs.':`No ${category} available.`}</p>}</div>
 {rows.length>pageSize&&<div className="research-source-pages"><span>{currentPage*pageSize+1}–{Math.min((currentPage+1)*pageSize,rows.length)} of {rows.length}</span><Button variant="ghost" size="sm" aria-label="Previous sources page" disabled={currentPage===0} onClick={()=>setPage(currentPage-1)}>Previous</Button><Button variant="ghost" size="sm" aria-label="Next sources page" disabled={currentPage===lastPage} onClick={()=>setPage(currentPage+1)}>Next</Button></div>}
 </TabsContent></Tabs>
 {value.sources.some(s=>s.kind==='web')&&value.sources.some(s=>s.kind!=='web')&&<p className="research-hint">Web searches use your brief. Keep private details out of it.</p>}
 {(error||chat.fileError[chat.draftId])&&<p role="alert">{error||chat.fileError[chat.draftId]}</p>}
 <div className="dialog-actions research-dialog-footer research-source-footer"><span>{value.sources.length} selected</span><Button type="button" variant="ghost" onClick={()=>onChange({...value,sources:[]})} disabled={disabled||!value.sources.length}>Clear selection</Button><Button type="button" onClick={()=>setOpen(false)}>Done</Button></div>
 </DialogContent></Dialog></>
}
