import {useHost} from '@zq/module-api'
import {ArrowUpRight} from '@phosphor-icons/react'
import {ContextMenu,ContextMenuTrigger,ContextMenuContent,ContextMenuItem} from './components/context-menu'
export function ChatSourceLinks({text,onOpen}:{text:string;onOpen?:()=>void}){
 const {commands,closing}=useHost()
 const links=[...new Set(text.match(/zq:\/\/chat\/[A-Za-z0-9%-]+(?:\?[^\s)<>]+)?/g)??[])].slice(0,20)
 return <>{links.map((link,index)=>{let target;try{const url=new URL(link);target={conversationId:decodeURIComponent(url.pathname.slice(1)),messageId:url.searchParams.get('message')??undefined,versionId:url.searchParams.get('version')??undefined}}catch{return null}const open=()=>{if(commands.run('chat.open',target))onOpen?.()};return <ContextMenu key={link}><ContextMenuTrigger asChild><button type="button" className="linked-note" disabled={closing} onClick={open}>Open source chat{links.length>1?` ${index+1}`:''}<ArrowUpRight size={14}/></button></ContextMenuTrigger><ContextMenuContent><ContextMenuItem disabled={closing} onSelect={open}>Open source chat</ContextMenuItem></ContextMenuContent></ContextMenu>})}</>
}
