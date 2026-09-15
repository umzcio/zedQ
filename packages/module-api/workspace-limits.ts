import limits from './workspace-limits.json' with {type:'json'}
import type {WorkspaceState} from './desktop'
export const WORKSPACE_LIMITS=Object.freeze(limits)
const encoder=new TextEncoder(),decoder=new TextDecoder('utf-8',{ignoreBOM:true})
export const utf8Bytes=(text:string)=>encoder.encode(text).length
export const workspaceBytes=(state:WorkspaceState)=>utf8Bytes(JSON.stringify({version:1,state}))
export function workspaceTextError(text:string,max:number,label:string){
 if(text.includes('\0')||decoder.decode(encoder.encode(text))!==text)return `${label} contains unsupported Unicode or a null character. Remove it to save.`
 if(utf8Bytes(text)>max)return `${label} exceeds ${max>=1048576?`${max/1048576} MB`:`${max/1024} KB`}. Shorten it or save a copy.`
 return ''
}
export type WorkspaceDraftIssue={key:string;kind:'note'|'task'|'capture'|'workspace';id?:string;field:string;label:string;message:string;text:string}
/** Keep rejected values in the renderer draft; only the valid projection reaches storage. */
export function projectWorkspaceDraft(draft:WorkspaceState,previous:WorkspaceState){
 const state={...draft,notes:draft.notes.map(n=>({...n})),tasks:draft.tasks.map(t=>({...t})),layout:{...draft.layout}}
 const issues:WorkspaceDraftIssue[]=[]
 const growth:{delta:number;revert:()=>void;issue:WorkspaceDraftIssue}[]=[]
 function field(record:Record<string,unknown>,old:Record<string,unknown>|undefined,key:string,max:number,kind:WorkspaceDraftIssue['kind'],id:string|undefined,label:string){
  const text=record[key] as string,prior=typeof old?.[key]==='string'?old[key] as string:''
  const issue={key:`${kind}:${id??''}:${key}`,kind,id,field:key,label,message:workspaceTextError(text,max,label),text}
  if(issue.message){record[key]=prior;issues.push(issue);return}
  const delta=utf8Bytes(JSON.stringify(text))-utf8Bytes(JSON.stringify(prior))
  if(delta>0)growth.push({delta,revert:()=>{record[key]=prior},issue:{...issue,message:`${label} would exceed the 32 MB workspace limit. Shorten it or save a copy.`}})
 }
 for(const [collection,kind] of [['notes','note'],['tasks','task']] as const){
  const old=new Map(previous[collection].map(record=>[record.id,record]))
  if(state[collection].length>limits.records){
   // Keep existing saved IDs before allocating space to new records, including prepends.
   let available=limits.records-state[collection].filter(record=>old.has(record.id)).length
   const extra=state[collection].filter(record=>!old.has(record.id)&&--available<0)
   const rejected=new Set(extra.map(record=>record.id))
   issues.push({key:collection,kind:'workspace',field:collection,label:`${kind==='note'?'Notes':'Tasks'} limit`,message:`Keep at most ${limits.records.toLocaleString()} ${collection}. Extra items remain in this open workspace only.`,text:JSON.stringify(extra,null,2)})
   for(let i=state[collection].length-1;i>=0;i--)if(rejected.has(state[collection][i].id))state[collection].splice(i,1)
  }
  for(const record of state[collection]){
   const label=`${kind==='note'?'Note':'Task'} “${record.title.slice(0,50)||'Untitled'}”`
   field(record,old.get(record.id),'title',limits.titleBytes,kind,record.id,`${label} title`)
   field(record,old.get(record.id),kind==='note'?'body':'description',limits.bodyBytes,kind,record.id,`${label} ${kind==='note'?'content':'description'}`)
   field(record,old.get(record.id),'project',limits.titleBytes,kind,record.id,`${label} project`)
  }
 }
 for(const key of ['tabs','tabOrder'] as const){
  const value=state.layout[key]
  if(value&&value.length>limits.tabs){state.layout[key]=previous.layout[key]??[];issues.push({key,kind:'workspace',field:key,label:'Open tabs',message:'Close some tabs to keep at most 1,000 open. Your notes and files remain saved.',text:JSON.stringify(value,null,2)})}
 }
 field(state.layout,previous.layout,'quickCapture',limits.bodyBytes,'capture',undefined,'Quick capture')
 // Largest growth first preserves small unrelated changes when the aggregate fills up.
 let bytes=workspaceBytes(state)
 if(bytes>limits.storeBytes)for(const change of growth.sort((a,b)=>b.delta-a.delta)){
  change.revert();issues.push(change.issue);bytes-=change.delta;if(bytes<=limits.storeBytes)break
 }
 if(bytes>limits.storeBytes){
  issues.push({key:'workspace',kind:'workspace',field:'workspace',label:'Workspace size',message:'The workspace exceeds 32 MB. Remove unused items or save a copy before closing.',text:JSON.stringify(draft,null,2)})
  // Preserve the known valid store when non-text metadata alone exceeds its bound.
  return {state:previous,issues}
 }
 return {state,issues}
}
