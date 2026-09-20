import {useLayoutEffect,useRef,useState} from 'react'

/** Clipboard completion, modality and expiry belong to the request that won. */
export function useCopyFeedback(identity:string){
 const [feedback,setFeedback]=useState({copied:false,animate:false})
 const generation=useRef(0),alive=useRef(false),pointer=useRef(false),timer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined)
 useLayoutEffect(()=>{
  alive.current=true;generation.current++;pointer.current=false
  clearTimeout(timer.current);setFeedback({copied:false,animate:false})
  return()=>{alive.current=false;generation.current++;clearTimeout(timer.current)}
 },[identity])
 async function run(write:()=>Promise<unknown>,animate:boolean,onError:()=>void){
  const request=++generation.current
  try{
   await write()
   if(!alive.current||request!==generation.current)return
   clearTimeout(timer.current);setFeedback({copied:true,animate})
   timer.current=setTimeout(()=>setFeedback(old=>({...old,copied:false})),1800)
  }catch{if(alive.current&&request===generation.current)onError()}
 }
 return {...feedback,run,menu:{
  onClickCapture:(event:{detail:number})=>{pointer.current=event.detail>0},
  reset:()=>{pointer.current=false},
  consume:()=>{const animate=pointer.current;pointer.current=false;return animate},
 }}
}
