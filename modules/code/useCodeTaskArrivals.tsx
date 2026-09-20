import {useCallback,useEffect,useLayoutEffect,useRef,useState} from 'react'
import type {GitHubBoardSnapshot} from '@zq/module-api'

type Observation={stage:string;runId?:string;state?:string}
const observations=(data:GitHubBoardSnapshot)=>new Map([...data.cards,...(data.issues||[]),...data.tasks].map(c=>[c.id,{stage:c.stage,runId:c.runs.at(-1)?.id,state:c.runs.at(-1)?.state}]))

/** A background completion cue, never a mount/filter animation. No persisted state. */
export function useCodeTaskArrivals(data:GitHubBoardSnapshot,visibleIds:string[],scope:string,active:boolean){
 const [arrivals,setArrivals]=useState<Record<string,string>>({})
 const context=useRef({epoch:0,active:false,scope:'',visible:new Set<string>(),reduced:false})
 const latest=useRef(data),previous=useRef<Map<string,Observation>|null>(null),seen=useRef(new Map<string,string>())
 const reset=useCallback(()=>{
  context.current.epoch++
  previous.current=observations(latest.current)
  seen.current=new Map([...previous.current].filter(([,c])=>c.state==='complete'&&c.runId).map(([id,c])=>[id,c.runId!]))
  setArrivals(old=>Object.keys(old).length?{}:old)
 },[])
 useLayoutEffect(()=>{
  latest.current=data
  const changed=context.current.scope!==scope||context.current.active!==active
  Object.assign(context.current,{scope,active,visible:new Set(visibleIds)})
  if(changed)reset()
  else setArrivals(old=>{const entries=Object.entries(old).filter(([id])=>context.current.visible.has(id));return entries.length===Object.keys(old).length?old:Object.fromEntries(entries)})
 },[data,visibleIds.join('\0'),scope,active,reset])
 useEffect(()=>{
  const media=matchMedia('(prefers-reduced-motion: reduce)')
  const changed=()=>{context.current.reduced=media.matches;reset()}
  changed();media.addEventListener('change',changed);document.addEventListener('visibilitychange',changed)
  return()=>{media.removeEventListener('change',changed);document.removeEventListener('visibilitychange',changed)}
 },[reset])
 const begin=useCallback(()=>context.current.epoch,[])
 const observe=useCallback((next:GitHubBoardSnapshot,ticket?:number)=>{
  const current=observations(next),prior=previous.current,ctx=context.current,cues:Record<string,string>={}
  if(prior&&ticket===ctx.epoch&&ctx.active&&!ctx.reduced&&document.visibilityState==='visible'){
   for(const [id,c] of current){const before=prior.get(id)
    if(ctx.visible.has(id)&&before?.stage==='Agent reviewing'&&['starting','running'].includes(before.state||'')&&c.stage==='Needs your input'&&c.state==='complete'&&c.runId===before.runId&&c.runId&&seen.current.get(id)!==c.runId)cues[id]=c.runId
   }
  }
  // Consume completions even when hidden, offscreen or received from a local action.
  for(const [id,c] of current)if(c.state==='complete'&&c.runId)seen.current.set(id,c.runId)
  for(const id of seen.current.keys())if(!current.has(id))seen.current.delete(id)
  previous.current=current
  setArrivals(old=>{
   // Local actions and stale requests must not carry a cue into another column.
   const retained=ticket===ctx.epoch?Object.entries(old).filter(([id,runId])=>{const c=current.get(id);return c?.stage==='Needs your input'&&c.state==='complete'&&c.runId===runId}):[]
   const next={...Object.fromEntries(retained),...cues}
   return Object.keys(old).length===Object.keys(next).length&&Object.entries(next).every(([id,runId])=>old[id]===runId)?old:next
  })
 },[])
 const finish=useCallback((id:string,runId:string)=>setArrivals(old=>{if(old[id]!==runId)return old;const next={...old};delete next[id];return next}),[])
 return {arrivals,observe,begin,finish}
}

export function CodeTaskArrival({id,runId,finish}:{id:string;runId:string;finish:(id:string,runId:string)=>void}){
 const element=useRef<HTMLSpanElement>(null)
 useLayoutEffect(()=>{
  const node=element.current,card=node?.parentElement
  if(!node||!card)return
  let rect=card.getBoundingClientRect(),left=Math.max(0,rect.left),right=Math.min(innerWidth,rect.right),top=Math.max(0,rect.top),bottom=Math.min(innerHeight,rect.bottom)
  for(let parent=card.parentElement;parent;parent=parent.parentElement){
   const style=getComputedStyle(parent),bounds=parent.getBoundingClientRect()
   if(/auto|scroll|hidden|clip/.test(style.overflowX)){left=Math.max(left,bounds.left);right=Math.min(right,bounds.right)}
   if(/auto|scroll|hidden|clip/.test(style.overflowY)){top=Math.max(top,bounds.top);bottom=Math.min(bottom,bounds.bottom)}
  }
  if(right<=left||bottom<=top||matchMedia('(prefers-reduced-motion: reduce)').matches){finish(id,runId);return}
  let second=0,timer:ReturnType<typeof setTimeout>|undefined
  const first=requestAnimationFrame(()=>{second=requestAnimationFrame(()=>{node.dataset.fading='true';timer=setTimeout(()=>finish(id,runId),250)})})
  return()=>{cancelAnimationFrame(first);cancelAnimationFrame(second);clearTimeout(timer)}
 },[id,runId,finish])
 return <span ref={element} className="pr-card-arrival" aria-hidden="true" onTransitionEnd={event=>{if(event.target===event.currentTarget&&event.propertyName==='opacity')finish(id,runId)}}/>
}
