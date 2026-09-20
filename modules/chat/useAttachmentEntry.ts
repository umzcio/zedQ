import { useCallback, useLayoutEffect, useRef, useState } from 'react'

const noEntries=new Set<string>()

/** Only additions to an already visible, ready draft receive entry motion. */
export function useAttachmentEntry(owner:string,keys:string[],ready:boolean){
 const previous=useRef<{owner:string;keys:Set<string>;ready:boolean}|null>(null)
 const [entry,setEntry]=useState<{owner:string;keys:Set<string>}>({owner,keys:noEntries})
 const key=JSON.stringify(keys)
 useLayoutEffect(()=>{
  const currentKeys=new Set<string>(JSON.parse(key))
  const before=previous.current
  const canEnter=ready&&before?.ready&&before.owner===owner&&!matchMedia('(prefers-reduced-motion: reduce)').matches
  previous.current={owner,keys:currentKeys,ready}
  setEntry(old=>{
   const next=canEnter?new Set([...currentKeys].filter(id=>!before.keys.has(id)||(old.owner===owner&&old.keys.has(id)))):noEntries
   if(old.owner===owner&&old.keys.size===next.size&&[...next].every(id=>old.keys.has(id)))return old
   return {owner,keys:next}
  })
 },[owner,key,ready])
 useLayoutEffect(()=>{
  const reduced=matchMedia('(prefers-reduced-motion: reduce)')
  const consume=()=>{if(reduced.matches)setEntry(old=>old.keys.size?{...old,keys:noEntries}:old)}
  reduced.addEventListener('change',consume)
  return()=>reduced.removeEventListener('change',consume)
 },[])
 const consume=useCallback((id:string)=>setEntry(old=>{
  if(old.owner!==owner||!old.keys.has(id))return old
  const next=new Set(old.keys);next.delete(id);return {...old,keys:next}
 }),[owner])
 return {entering:ready&&entry.owner===owner?entry.keys:noEntries,consume}
}
