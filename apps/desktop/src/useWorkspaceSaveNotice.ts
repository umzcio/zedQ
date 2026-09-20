import {useEffect,useState} from 'react'

const saving='Saving workspace…'
const saved='Workspace saved on this Mac'
const failed='Workspace could not be saved. Keep zQ open.'

/** Routine autosaves are silent. Only announce a delay, failure, or recovery. */
export function useWorkspaceSaveNotice(status:string){
 const [notice,setNotice]=useState('')
 useEffect(()=>{
  if(status.startsWith('Unable')){setNotice(failed);return}
  if(status.startsWith('Saving')){
   const timer=setTimeout(()=>setNotice(current=>current===failed?current:saving),800)
   return()=>clearTimeout(timer)
  }
  if(status==='Saved on this Mac')setNotice(current=>current?saved:'')
  else setNotice('') // Invalid drafts have their own persistent, actionable banner.
 },[status])
 useEffect(()=>{
  if(notice!==saved)return
  const timer=setTimeout(()=>setNotice(''),2400)
  return()=>clearTimeout(timer)
 },[notice])
 return {message:notice,urgent:notice===failed}
}
