import { Children, isValidElement, memo, createContext, useContext, useState, useRef, type ReactNode } from 'react'
import ChatCode from './ChatCode'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {useHost,unwrap,type ChatSource} from '@zq/module-api'
import {ContextMenu,ContextMenuContent,ContextMenuItem,ContextMenuTrigger,HoverCard,HoverCardTrigger,HoverCardContent} from '@zq/ui'
import {SourceIcon,SourceDescription} from './ChatSources'
import {sourceForLink,isCitationLabel,citationSiteLabel} from './chat-sources'
type CitationContextValue={sources:ChatSource[];onSourceOpen?:(source:ChatSource,origin:HTMLElement|null)=>void}
const CitationContext=createContext<CitationContextValue>({sources:[]})
function SourceLink({children,href}:{children?:React.ReactNode;href?:string}){
 const {services,notify,commands,closing}=useHost(),{sources,onSourceOpen}=useContext(CitationContext),source=sourceForLink(href,sources)
 const [preview,setPreview]=useState(false),[menu,setMenu]=useState(false),anchor=useRef<HTMLAnchorElement>(null)
 const internal=!!href&&/^zq:\/\/chat\//i.test(href),valid=internal||!!href&&/^https?:\/\//i.test(href),citation=!!source&&isCitationLabel(String(children)),citationNumber=String(children).replace(/[\[\]]/g,'')
 async function open(){if(!href||closing)return;setPreview(false);try{if(internal){const url=new URL(href);commands.run('chat.open',{conversationId:decodeURIComponent(url.pathname.slice(1)),messageId:url.searchParams.get('message')??undefined,versionId:url.searchParams.get('version')??undefined})}else await unwrap(services.chat.openLink(href))}catch(e){notify((e as Error).message)}}
 async function copy(){if(!href||closing)return;try{await unwrap(services.clipboard.writeText(href));notify('Link copied')}catch{notify('Couldn’t copy the link.')}}
 function showSource(){setPreview(false);if(source&&!closing)onSourceOpen?.(source,anchor.current)}
 if(!valid)return <span>{children}</span>
 const link=<a ref={anchor} className={citation?'chat-reference-link chat-citation':'chat-reference-link'} href={href} title={source?undefined:href} aria-label={citation?`Source ${citationNumber}: ${source!.title}`:undefined} aria-disabled={closing} onClick={e=>{e.preventDefault();source&&onSourceOpen?showSource():void open()}}>{citation?<span className="chat-citation-label">{citationSiteLabel(source!.url)}</span>:children}</a>
 return <ContextMenu onOpenChange={open=>{setMenu(open);if(open)setPreview(false)}}><HoverCard open={preview&&!menu&&!closing} onOpenChange={setPreview} openDelay={250} closeDelay={120}><ContextMenuTrigger asChild>{source?<HoverCardTrigger asChild>{link}</HoverCardTrigger>:link}</ContextMenuTrigger>{source&&preview&&!menu&&!closing&&<HoverCardContent className="chat-citation-preview" onEscapeKeyDown={e=>{e.preventDefault();e.stopPropagation();setPreview(false)}}><div className="chat-citation-preview-heading"><SourceDescription source={source}/></div><div className="chat-citation-publisher"><SourceIcon host={new URL(source.url).hostname}/><span>{citationSiteLabel(source.url)}</span></div><div className="chat-citation-preview-actions">{onSourceOpen&&<button type="button" onClick={showSource}>View source</button>}<button type="button" onClick={()=>void open()}>Open in browser</button><button type="button" onClick={()=>void copy()}>Copy link</button></div></HoverCardContent>}</HoverCard><ContextMenuContent>{source&&onSourceOpen&&<ContextMenuItem disabled={closing} onSelect={showSource}>View source</ContextMenuItem>}<ContextMenuItem disabled={closing} onSelect={()=>void open()}>{internal?'Open source conversation':'Open link in browser'}</ContextMenuItem><ContextMenuItem disabled={closing} onSelect={()=>void copy()}>Copy link</ContextMenuItem></ContextMenuContent></ContextMenu>
}
// Replies remain inert: no raw HTML, remote image loads, or embedded browser content.
function CodeBlock({children}:{children?:ReactNode}){
 const child=Children.toArray(children)[0]
 if(isValidElement<{className?:string;children?:ReactNode}>(child)){const language=/language-([\w+-]+)/.exec(child.props.className??'')?.[1]??'';const code=String(child.props.children??'').replace(/\n$/,'');return <ChatCode code={code} language={language.toLowerCase()}/>}
 return <pre>{children}</pre>
}
const components={
 pre:CodeBlock,
 table:({children}:{children?:ReactNode})=><div className="chat-table-scroll" tabIndex={0} role="region" aria-label="Scrollable table"><table>{children}</table></div>,
 a:SourceLink,
 img:({alt}:{alt?:string})=><span className="chat-image-description">{alt?`[Image: ${alt}]`:'[Image]'}</span>,
}
export default memo(function ChatMarkdown({content,sources=[],onSourceOpen}:{content:string;sources?:ChatSource[];onSourceOpen?:CitationContextValue['onSourceOpen']}){
 return <CitationContext.Provider value={{sources,onSourceOpen}}><div className="chat-prose"><Markdown remarkPlugins={[remarkGfm]} components={components} urlTransform={url=>/^(https?:\/\/|zq:\/\/chat\/)/i.test(url)?url:''} skipHtml>{content}</Markdown></div></CitationContext.Provider>
})
