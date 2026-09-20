import {ConnectorIcon} from '@zq/ui'
import { TooltipButton } from '@zq/ui'
import GeneratedFiles from './GeneratedFiles'
import {searchActivitySummary} from './search-activity'
import {useEffect,useState} from 'react'
import {useHost,unwrap} from '@zq/module-api'
import type {ChatMessage,ChatToolActivity,ChatToolKind,ChatToolOption,ModelChoice} from '@zq/module-api'
import {CaretRight,Check,Code,DownloadSimple,File,Globe,MagnifyingGlass,SlidersHorizontal} from '@phosphor-icons/react'
import {DropdownMenu,DropdownMenuContent,DropdownMenuItem,DropdownMenuTrigger,Collapsible,CollapsibleContent,CollapsibleTrigger,ContextMenu,ContextMenuContent,ContextMenuItem,ContextMenuTrigger} from '@zq/ui'

export function useToolOptions(choice:ModelChoice|null){
 const {services,notify}=useHost(),key=JSON.stringify(choice)
 const [result,setResult]=useState<{key:string;options:ChatToolOption[];error:string}>({key:'',options:[],error:''})
 useEffect(()=>{let live=true;if(choice)unwrap(services.chat.toolOptions(choice)).then(options=>{if(live)setResult({key,options,error:''})}).catch(e=>{if(live){setResult({key,options:[],error:e.message});notify(e.message)}});return()=>{live=false}},[key])
 return {options:result.key===key?result.options:[],ready:!choice||result.key===key,error:result.key===key?result.error:''}
}
export function ChatToolPicker({options,selected,onChange,disabled,research}:{options:ChatToolOption[];selected:ChatToolKind[];onChange:(tools:ChatToolKind[])=>void;disabled:boolean;research?:{active:boolean;reason:string;disabled:boolean;onChange:(active:boolean)=>void}}){
 const [open,setOpen]=useState(false)
 useEffect(()=>{if(disabled)setOpen(false)},[disabled])
 if(!options.length&&!research)return null
 const active=!!research?.active
 function mode(value:boolean){research?.onChange(value);setOpen(false)}
 function toggleTool(kind:ChatToolKind){if(active)research?.onChange(false);onChange(!active&&selected.includes(kind)?selected.filter(value=>value!==kind):[...new Set([...selected,kind])])}
 return <DropdownMenu open={open&&!disabled} onOpenChange={setOpen}>
  <DropdownMenuTrigger asChild><TooltipButton type="button" className={`chat-tools-trigger ${active||selected.length?'has-tools':''}`} disabled={disabled} aria-label={active?'Research tools':'Choose provider tools'} tooltip="Choose tools for your next message">{active?<MagnifyingGlass size={16}/>:<SlidersHorizontal size={16}/>}<span>{active?'Research':`Tools${selected.length?` · ${selected.length}`:''}`}</span></TooltipButton></DropdownMenuTrigger>
  <DropdownMenuContent side="top" align="start" className="chat-tools-menu" aria-label="Message tools">
   {research&&<DropdownMenuItem className="chat-tools-row" role="menuitemcheckbox" aria-checked={active} aria-description={!active&&research.reason?research.reason:undefined} title={!active&&research.reason?research.reason:undefined} disabled={research.disabled||!active&&!!research.reason} onSelect={()=>mode(!active)}><MagnifyingGlass size={17}/><span>Research</span>{active&&<Check size={17} className="chat-tools-check" aria-hidden="true"/>}</DropdownMenuItem>}
   {options.map(option=><DropdownMenuItem key={option.kind} className="chat-tools-row" role="menuitemcheckbox" aria-checked={!active&&selected.includes(option.kind)} disabled={research?.disabled} onSelect={()=>toggleTool(option.kind)}>{option.kind==='web_search'?<Globe size={17}/>:option.kind==='code_execution'?<Code size={17}/>:<MagnifyingGlass size={17}/>}<span>{option.label}</span>{!active&&selected.includes(option.kind)&&<Check size={17} className="chat-tools-check" aria-hidden="true"/>}</DropdownMenuItem>)}
  </DropdownMenuContent>
 </DropdownMenu>
}

function activityLabel(tool:ChatToolActivity){
 const running=tool.status==='running'
 if(tool.kind==='mcp'){const label=tool.detail?.split('\n')[0]||'Connector tool';return tool.status==='error'?`${label} · Failed`:tool.status==='stopped'||tool.status==='interrupted'?`${label} · ${tool.status}`:running?`${label} · Running`:label}
 if(tool.kind==='create_document')return tool.status==='error'?'Document update failed':tool.status==='stopped'||tool.status==='interrupted'?`Document ${tool.status}`:running?(tool.detail?.startsWith('Revising')?'Revising document on this Mac':'Creating document on this Mac'):tool.detail?.includes(' · Version ')?'Document revised':'Document created'
 const label=tool.kind==='code_execution'?(running?'Running code':'Code execution'):tool.kind==='x_search'?(running?'Searching X':'Searched X'):(running?'Searching the web':'Searched the web')
 return tool.status==='error'?`${tool.kind==='code_execution'?'Code execution':'Search'} failed`:tool.status==='stopped'||tool.status==='interrupted'?`${tool.kind==='code_execution'?'Code execution':'Search'} ${tool.status}`:label
}
export function ChatToolOutput({message,conversationId,closing,chat}:{message:ChatMessage;conversationId:string;closing:boolean;chat:import('./useChat').ChatController}){
 const search=searchActivitySummary(message.toolActivity)
 return <>{message.toolActivity?.map(tool=>(tool.kind==='web_search'||tool.kind==='x_search')?(tool.id===search?.firstId?<SearchSummary key={tool.id} summary={search} closing={closing} onOpen={()=>chat.openSources(conversationId,message)}/>:null):<Collapsible key={tool.id} className="chat-tool-activity"><CollapsibleTrigger tooltip={`Show or hide tool details: ${activityLabel(tool)}`} className="chat-tool-summary"><span className={tool.status==='running'?'chat-tool-running':''}>{tool.kind==='mcp'?<ConnectorIcon size={15}/>:tool.kind==='create_document'?<File size={15}/>:tool.kind==='code_execution'?<Code size={15}/>:<Globe size={15}/>}</span><span>{activityLabel(tool)}</span>{tool.status==='complete'?<Check size={12}/>:null}{tool.detail&&<CaretRight size={12} className="chat-tool-caret"/>}</CollapsibleTrigger><CollapsibleContent>{tool.detail?<pre className="chat-tool-detail">{tool.detail}</pre>:<p className="chat-tool-detail">{tool.status==='complete'?'The provider completed this tool.':tool.status==='running'?'Waiting for the provider.':'This tool did not finish.'}</p>}</CollapsibleContent></Collapsible>)}<GeneratedFiles message={message} conversationId={conversationId} chat={chat} closing={closing}/></>
}

function SearchSummary({summary,closing,onOpen}:{summary:NonNullable<ReturnType<typeof searchActivitySummary>>;closing:boolean;onOpen:()=>void}){
 return <ContextMenu><ContextMenuTrigger asChild><TooltipButton type="button" disabled={closing} className="chat-tool-summary chat-search-summary" onClick={onOpen} aria-label={`${summary.label}, ${summary.count} ${summary.count===1?'search':'searches'}. View search activity`}><span className={summary.running?'chat-tool-running':''}><Globe size={15}/></span><span>{summary.label}{summary.running?'…':''}</span>{summary.count>1&&<span className="chat-search-count">{summary.count} searches</span>}<CaretRight size={12}/></TooltipButton></ContextMenuTrigger><ContextMenuContent><ContextMenuItem disabled={closing} onSelect={onOpen}>View search activity</ContextMenuItem></ContextMenuContent></ContextMenu>
}
