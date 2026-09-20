import {useLayoutEffect,useRef,useState} from 'react'
import {ControlTooltip} from '@zq/ui'
export type PendingCue={id:string;version:string;generation:number}
export default function ModulePendingVersion({version,cue,ready,consume}:{version:string;cue?:PendingCue;ready:boolean;consume:(generation:number)=>void}){
 const label=useRef<HTMLElement>(null),claimed=useRef<number|null>(null)
 const [phase,setPhase]=useState<'idle'|'enter'|'visible'>('idle')
 useLayoutEffect(()=>{
  if(!cue||!ready){setPhase('idle');return}
  const node=label.current,generation=cue.generation
  if(!node||claimed.current===generation){consume(generation);return}
  claimed.current=generation
  const rect=node.getBoundingClientRect();let left=Math.max(0,rect.left),right=Math.min(innerWidth,rect.right),top=Math.max(0,rect.top),bottom=Math.min(innerHeight,rect.bottom)
  for(let parent=node.parentElement;parent;parent=parent.parentElement){const style=getComputedStyle(parent),bounds=parent.getBoundingClientRect();if(/auto|scroll|hidden|clip/.test(style.overflowX)){left=Math.max(left,bounds.left);right=Math.min(right,bounds.right)}if(/auto|scroll|hidden|clip/.test(style.overflowY)){top=Math.max(top,bounds.top);bottom=Math.min(bottom,bounds.bottom)}}
  if(document.visibilityState!=='visible'||right<=left||bottom<=top){consume(generation);return}
  let second=0,timer:ReturnType<typeof setTimeout>|undefined,live=true
  const finish=()=>{if(live){setPhase('idle');consume(generation)}}
  const ended=(event:TransitionEvent)=>{if(event.target===node&&event.propertyName==='opacity')finish()}
  const media=matchMedia('(prefers-reduced-motion: reduce)');media.addEventListener('change',finish)
  node.addEventListener('transitionend',ended);node.addEventListener('transitioncancel',ended)
  setPhase('enter')
  const first=requestAnimationFrame(()=>{second=requestAnimationFrame(()=>{if(live){setPhase('visible');timer=setTimeout(finish,220)}})})
  return()=>{live=false;media.removeEventListener('change',finish);cancelAnimationFrame(first);cancelAnimationFrame(second);clearTimeout(timer);node.removeEventListener('transitionend',ended);node.removeEventListener('transitioncancel',ended)}
 },[cue,ready,consume])
 return <ControlTooltip content="This signed update will activate after you quit and reopen zQ"><small ref={label} style={{alignSelf:'flex-start',width:'fit-content'}} tabIndex={0} className="module-update-pending" data-feedback={phase}>{version} ready for next launch</small></ControlTooltip>
}
