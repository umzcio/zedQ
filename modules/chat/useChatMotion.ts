import { useEffect, useLayoutEffect, useRef } from 'react'

/** Animate layout only on first send; history switches and streaming stay immediate. */
export function useChatMotion(conversationId:string|undefined,empty:boolean,messageIds:string[]){
 const composer=useRef<HTMLDivElement>(null),thread=useRef<HTMLDivElement>(null)
 const beforeSend=useRef<DOMRect|null>(null),move=useRef<Animation|null>(null)
 const previous=useRef({conversationId,ids:new Set(messageIds)})
 useEffect(()=>{
  const reduced=matchMedia('(prefers-reduced-motion: reduce)')
  const cancel=()=>{if(reduced.matches){move.current?.cancel();beforeSend.current=null}}
  reduced.addEventListener('change',cancel)
  return()=>{reduced.removeEventListener('change',cancel);move.current?.cancel()}
 },[])
 useLayoutEffect(()=>{
  const sameConversation=previous.current.conversationId===conversationId
  if(!sameConversation){beforeSend.current=null;move.current?.cancel()}
  if(sameConversation&&!matchMedia('(prefers-reduced-motion: reduce)').matches){
   // Add classes once to new nodes. React streaming updates retain them.
   for(const node of thread.current?.querySelectorAll<HTMLElement>('[data-message-id]')??[]){
    if(!previous.current.ids.has(node.dataset.messageId!))node.classList.add('chat-message-enter','animate-in','fade-in-0','slide-in-from-bottom-2')
   }
   if(beforeSend.current&&!empty&&composer.current){
    const offset=beforeSend.current.top-composer.current.getBoundingClientRect().top
    move.current?.cancel()
    move.current=composer.current.animate([{transform:`translateY(${offset}px)`},{transform:'translateY(0)'}],{duration:280,easing:'cubic-bezier(0.22, 1, 0.36, 1)'})
    beforeSend.current=null
   }
  }
  previous.current={conversationId,ids:new Set(messageIds)}
 },[conversationId,empty,messageIds.join('|')])
 return {composer,thread,prepareSend:()=>{if(empty&&!matchMedia('(prefers-reduced-motion: reduce)').matches)beforeSend.current=composer.current?.getBoundingClientRect()??null},cancelSend:()=>{beforeSend.current=null}}
}
