import { TooltipButton, TooltipLink } from '@zq/ui'
import {useEffect,useState} from 'react'
import {useHost,unwrap,type ChatMessage,type ChatSource,type ChatToolActivity} from '@zq/module-api'
import {Button,Collapsible,CollapsibleContent,CollapsibleTrigger,ContextMenu,ContextMenuTrigger,ContextMenuContent,ContextMenuItem,DropdownMenu,DropdownMenuTrigger,DropdownMenuContent,DropdownMenuItem} from '@zq/ui'
import {CaretRight,DotsThree,Globe,ArrowUpRight,X,Lightbulb,Copy} from '@phosphor-icons/react'
import {messageSources} from './chat-sources'
import type {ChatController} from './useChat'
import './chat-sources.css'
const domain=(source:ChatSource)=>new URL(source.url).hostname.replace(/^www\./,'')
export function SourceIcon({host}:{host:string}){
 const {services}=useHost(),[icon,setIcon]=useState<string|null>(null)
 useEffect(()=>{let live=true;setIcon(null);services.chat.sourceIcon?.(`https://${host}`).then(result=>{if(live&&result.ok&&result.value?.startsWith('data:image/png;base64,'))setIcon(result.value)}).catch(()=>{});return()=>{live=false}},[host,services.chat])
 return <span className="chat-source-icon" aria-hidden="true">{icon?<img src={icon} alt="" draggable={false} onError={()=>setIcon(null)}/>:host[0].toUpperCase()}</span>
}
export function SourceDescription({source}:{source:ChatSource}){
 const url=new URL(source.url),untitled=!source.title||source.title===source.url||/^https?:\/\//i.test(source.title)||/^\d+$/.test(source.title)
 const detail=untitled?(url.pathname==='/'?'':url.pathname+url.search):domain(source)
 return <span className="chat-source-text"><span>{untitled?domain(source):source.title}</span>{detail&&<small>{detail}</small>}</span>
}

export default function ChatSources({message,closing,onOpen}:{message:ChatMessage;closing:boolean;onOpen:()=>void}){
 const {sources,linked,missing}=messageSources(message)
 if(!sources.length)return missing?<p className="chat-sources-missing">Search completed. The provider did not return source links.</p>:null
 const domains=[...new Set(sources.map(domain))].slice(0,3)
 return <TooltipButton type="button" className="chat-sources-pill" disabled={closing} onClick={onOpen} aria-label={`View ${sources.length} ${linked?'linked sources':'sources'}`}><span className="chat-source-badges" aria-hidden="true">{domains.map(host=><SourceIcon key={host} host={host}/>)}</span><span>{sources.length} {linked?'linked sources':sources.length===1?'source':'sources'}</span></TooltipButton>
}

function SearchActivity({tool}:{tool:ChatToolActivity}){
 const {services,notify,closing}=useHost()
 const label=tool.status==='running'?(tool.kind==='x_search'?'Searching X':'Searching the web'):tool.status==='complete'?(tool.kind==='x_search'?'Searched X':'Searched web'):tool.status==='error'?'Search failed':`Search ${tool.status}`
 async function copy(){try{await unwrap(services.clipboard.writeText(tool.detail??''));notify('Search details copied')}catch(e){notify((e as Error).message)}}
 const row=<div className="source-activity-row"><Globe size={16}/><Collapsible className="source-activity-detail"><CollapsibleTrigger tooltip={tool.detail ? 'Show or hide the search query and details' : 'The provider did not return search details'} disabled={!tool.detail} className="source-activity-trigger"><span>{label}</span>{tool.detail&&<><span className="source-query">{tool.detail}</span><CaretRight size={12}/></>}</CollapsibleTrigger>{tool.detail&&<CollapsibleContent><pre>{tool.detail}</pre></CollapsibleContent>}</Collapsible>{tool.detail&&<TooltipButton className="chat-source-actions" aria-label="Copy search details" disabled={closing} onClick={()=>void copy()}><Copy size={15}/></TooltipButton>}</div>
 return tool.detail?<ContextMenu><ContextMenuTrigger asChild>{row}</ContextMenuTrigger><ContextMenuContent><ContextMenuItem disabled={closing} onSelect={()=>void copy()}>Copy search details</ContextMenuItem></ContextMenuContent></ContextMenu>:row
}

export function SourcesPane({chat,message}:{chat:ChatController;message:ChatMessage}){
 const {services,notify,closing}=useHost(),{sources,linked,missing}=messageSources(message)
 useEffect(()=>{if(!chat.sourceTarget?.sourceUrl)return;const frame=requestAnimationFrame(()=>{const row=[...document.querySelectorAll<HTMLElement>('.sources-pane [data-source-url]')].find(row=>row.dataset.sourceUrl===chat.sourceTarget?.sourceUrl);row?.scrollIntoView({block:'center',behavior:'instant'})});return()=>cancelAnimationFrame(frame)},[chat.sourceTarget])
 const searches=message.toolActivity?.filter(t=>t.kind==='web_search'||t.kind==='x_search')??[]
 useEffect(()=>{function escape(e:KeyboardEvent){if(e.key==='Escape'&&!e.defaultPrevented&&!document.querySelector('[role="dialog"],[role="menu"],[role="listbox"]')){e.preventDefault();chat.closeArtifact()}}document.addEventListener('keydown',escape);return()=>document.removeEventListener('keydown',escape)},[chat.closeArtifact])
 async function open(source:ChatSource){if(closing)return;try{await unwrap(services.chat.openLink(source.url))}catch(e){notify((e as Error).message)}}
 async function copy(source:ChatSource){if(closing)return;try{await unwrap(services.clipboard.writeText(source.url));notify('Source link copied')}catch{notify('Couldn’t copy the source link.')}}
 function actions(source:ChatSource){return [{label:'Open link in browser',run:()=>void open(source)},{label:'Copy link',run:()=>void copy(source)}]}
 return <aside className="artifact-pane sources-pane" aria-label="Sources pane"><header className="artifact-pane-header"><h2>Sources</h2><Button variant="ghost" size="icon-sm" data-pane-close aria-label="Close sources" onClick={()=>chat.closeArtifact()}><X size={18}/></Button></header><div className="sources-pane-scroll" tabIndex={0} role="region" aria-label="Sources and search activity">
  {message.thinking&&<Collapsible className="source-thinking"><CollapsibleTrigger tooltip="Show or hide the model’s thinking details"><Lightbulb size={17}/><span>Thinking</span><CaretRight size={13}/></CollapsibleTrigger><CollapsibleContent><pre>{message.thinking}</pre></CollapsibleContent></Collapsible>}
  {!!searches.length&&<section className="source-activity" aria-label="Search activity">{searches.map(tool=><SearchActivity key={tool.id} tool={tool}/>)}</section>}
  <div className="source-list-heading"><h3>{linked?'Linked sources':'Sources'}</h3><span>{sources.length}</span></div>
  {linked&&<p className="chat-sources-note">Links found in this response.</p>}
  {missing&&<p className="chat-sources-missing">The provider did not return source links.</p>}
  <ol className="chat-sources-list">{sources.map(source=><ContextMenu key={source.url}><ContextMenuTrigger asChild><li data-source-url={source.url} data-selected={chat.sourceTarget?.sourceUrl===source.url||undefined}><TooltipLink tooltip={`Open ${source.title || domain(source)} in your browser: ${source.url}`} aria-current={chat.sourceTarget?.sourceUrl===source.url?true:undefined} href={source.url} className="chat-source-link" aria-disabled={closing} onClick={e=>{e.preventDefault();void open(source)}}><SourceIcon host={domain(source)}/><span className="chat-source-number">{source.id}</span><SourceDescription source={source}/><ArrowUpRight size={14}/></TooltipLink><DropdownMenu><DropdownMenuTrigger asChild><TooltipButton type="button" className="chat-source-actions" disabled={closing} aria-label={`Actions for source ${source.title}`}><DotsThree size={17}/></TooltipButton></DropdownMenuTrigger><DropdownMenuContent align="end">{actions(source).map(a=><DropdownMenuItem key={a.label} disabled={closing} onSelect={a.run}>{a.label}</DropdownMenuItem>)}</DropdownMenuContent></DropdownMenu></li></ContextMenuTrigger><ContextMenuContent>{actions(source).map(a=><ContextMenuItem key={a.label} disabled={closing} onSelect={a.run}>{a.label}</ContextMenuItem>)}</ContextMenuContent></ContextMenu>)}</ol>
 </div></aside>
}
