import {useCallback,useEffect,useLayoutEffect,useRef,useState} from 'react'
import type {CodeBridge,CodeFileTransfer,CodeWorkspaceTarget} from '@zq/module-api'
import type {TransferActivation} from './TransferCompletion'

export function useWorkspaceTransfers(bridge:CodeBridge,target:CodeWorkspaceTarget,active:boolean,onRefresh:()=>void,onError:(error:unknown)=>void){
 const [transfers,setTransfers]=useState<CodeFileTransfer[]>([]),[transferring,setTransferring]=useState(false),[completion,setCompletion]=useState<string|null>(null)
 const lifecycle=useRef(0),invocation=useRef(0),busy=useRef(false),snapshotSerial=useRef(0)
 const callbacks=useRef({onRefresh,onError}),context=JSON.stringify(target)
 useLayoutEffect(()=>{callbacks.current={onRefresh,onError}})
 useLayoutEffect(()=>{
  lifecycle.current++;invocation.current++;busy.current=false;setTransferring(false);setCompletion(null)
  const changed=()=>{lifecycle.current++;setCompletion(null)}
  document.addEventListener('visibilitychange',changed)
  return()=>{lifecycle.current++;invocation.current++;document.removeEventListener('visibilitychange',changed)}
 },[bridge,context])
 useLayoutEffect(()=>{lifecycle.current++;setCompletion(null)},[active])
 useEffect(()=>{
  let current=true,completed=''
  setTransfers([])
  const poll=async()=>{
   const serial=++snapshotSerial.current
   try{
    const rows=await bridge.invoke('fileTransfers',target)
    if(!current||serial!==snapshotSerial.current)return
    setTransfers(previous=>JSON.stringify(previous)===JSON.stringify(rows)?previous:rows)
    const next=rows.filter(row=>row.state==='done').map(row=>row.id).join(',')
    if(next!==completed){completed=next;callbacks.current.onRefresh()}
   }catch{}
  }
  void poll();const timer=setInterval(()=>void poll(),750)
  return()=>{current=false;clearInterval(timer);snapshotSerial.current++}
 },[bridge,context])
 useLayoutEffect(()=>{setCompletion(id=>id&&transfers.slice(-3).some(row=>row.id===id&&row.state==='done')?id:null)},[transfers])
 const consume=useCallback(()=>setCompletion(null),[])
 async function transfer(direction:'upload'|'download',path:string,activation:TransferActivation='unknown'){
  if(busy.current)return
  busy.current=true;setTransferring(true);setCompletion(null)
  const owner=++invocation.current,epoch=lifecycle.current
  const current=()=>owner===invocation.current
  try{
   // A fresh baseline avoids attributing another view's old rows to this invocation.
   // Observation failure suppresses feedback, never the requested native action.
   const before=await bridge.invoke('fileTransfers',target).catch(()=>null)
   if(!current())return
   const baseline=before?new Set(before.map(row=>row.id)):null
   const result=direction==='upload'?await bridge.invoke('uploadFiles',{...target,path}):await bridge.invoke('downloadFile',{...target,path})
   if(!current())return
   const serial=++snapshotSerial.current
   const rows=await bridge.invoke('fileTransfers',target).catch(()=>null)
   if(!current()||!rows)return
   if(serial===snapshotSerial.current)setTransfers(rows)
   const introduced=baseline?rows.filter(row=>!baseline.has(row.id)):[]
   const successes=introduced.filter(row=>row.state==='done'&&row.direction===direction)
   const visible=rows.slice(-3).filter(row=>successes.some(success=>success.id===row.id)).at(-1)
   // The native result is the batch boundary. Polling never grants a cue.
   // Retention/truncation or mixed directions are ambiguous, so stay static.
   if(serial===snapshotSerial.current&&active&&!document.hidden&&epoch===lifecycle.current&&activation==='pointer'&&!result.canceled&&result.completed>0&&successes.length===result.completed&&!introduced.some(row=>row.direction!==direction||row.state==='failed'||row.state==='running')&&visible)setCompletion(visible.id)
  }catch(error){if(current())callbacks.current.onError(error)}
  finally{
   if(current()){
    busy.current=false;setTransferring(false);callbacks.current.onRefresh()
    const serial=++snapshotSerial.current
    void bridge.invoke('fileTransfers',target).then(rows=>{if(current()&&serial===snapshotSerial.current)setTransfers(rows)}).catch(()=>{})
   }
  }
 }
 return {transfers,transferring,completion,consume,transfer}
}
