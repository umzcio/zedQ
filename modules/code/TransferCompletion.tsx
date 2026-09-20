import {useLayoutEffect,useRef,useState} from 'react'
import {Check} from '@phosphor-icons/react'

export type TransferActivation='pointer'|'keyboard'|'unknown'

/** The status is always present; only a verified foreground invocation grants entry. */
export function TransferCompletion({done,enter,consume}:{done:boolean;enter:boolean;consume:()=>void}){
 const node=useRef<HTMLSpanElement>(null)
 const [phase,setPhase]=useState<'idle'|'start'|'end'>('idle')
 const finish=useRef(consume)
 useLayoutEffect(()=>{finish.current=consume})
 useLayoutEffect(()=>{
  if(!enter||!done){setPhase('idle');return}
  const element=node.current
  if(!element)return
  const rect=element.getBoundingClientRect()
  let left=Math.max(0,rect.left),right=Math.min(innerWidth,rect.right),top=Math.max(0,rect.top),bottom=Math.min(innerHeight,rect.bottom)
  for(let parent=element.parentElement;parent;parent=parent.parentElement){
   const style=getComputedStyle(parent),bounds=parent.getBoundingClientRect()
   if(/auto|scroll|hidden|clip/.test(style.overflowX)){left=Math.max(left,bounds.left);right=Math.min(right,bounds.right)}
   if(/auto|scroll|hidden|clip/.test(style.overflowY)){top=Math.max(top,bounds.top);bottom=Math.min(bottom,bounds.bottom)}
  }
  if(document.hidden||right<=left||bottom<=top){finish.current();return}
  let second=0,timer:ReturnType<typeof setTimeout>|undefined
  const media=matchMedia('(prefers-reduced-motion: reduce)')
  const stop=()=>{setPhase('idle');finish.current()}
  setPhase('start')
  const first=requestAnimationFrame(()=>{second=requestAnimationFrame(()=>{setPhase('end');timer=setTimeout(stop,media.matches?100:200)})})
  media.addEventListener('change',stop)
  return()=>{cancelAnimationFrame(first);cancelAnimationFrame(second);clearTimeout(timer);media.removeEventListener('change',stop)}
 },[done,enter])
 return <span ref={node} className="code-transfer-check" data-complete={done} data-entry={enter?phase:'idle'} aria-hidden="true" onTransitionEnd={event=>{if(event.target===event.currentTarget&&event.propertyName==='opacity')finish.current()}} onTransitionCancel={()=>finish.current()}>{done&&<Check size={14} weight="regular"/>}</span>
}
