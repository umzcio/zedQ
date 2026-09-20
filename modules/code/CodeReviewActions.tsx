import {useEffect,useRef,useState} from 'react'
import {useHost,type GitHubBoardSnapshot,type MergePreview} from '@zq/module-api'
import {Button,Dialog,DialogContent,DialogDescription,DialogTitle,Input,SelectField,Textarea} from '@zq/ui'

export type ReviewAction={kind:'changes'|'implement'|'merge'|'link';id:string;title:string;repo:string;number:number;runId:string;agent?:string}
export function CodeReviewActions({action,active,data,accept,close}:{action:ReviewAction|null;active:boolean;data:GitHubBoardSnapshot;accept:(data:GitHubBoardSnapshot)=>void;close:()=>void}){
 const host=useHost(),bridge=host.services.github
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[instructions,setInstructions]=useState(''),[preview,setPreview]=useState<MergePreview|null>(null),[method,setMethod]=useState<'squash'|'merge'|'rebase'>('squash'),[repo,setRepo]=useState(''),[number,setNumber]=useState(''),[dispatched,setDispatched]=useState(false)
 const submitting=useRef(false)
 useEffect(()=>{
  setError('');setInstructions('');setPreview(null);setMethod('squash');setRepo(action?.repo||data.repositories[0]?.name||'');setNumber('');setDispatched(false)
  if(action?.kind!=='merge'){setBusy(false);return}
  let stopped=false;setBusy(true)
  void bridge.invoke('prepareMerge',{id:action.id,runId:action.runId}).then(value=>{if(!stopped)setPreview(value)}).catch(e=>{if(!stopped){setError(e.message);void bridge.invoke('snapshot',undefined).then(accept).catch(()=>{})}}).finally(()=>{if(!stopped)setBusy(false)})
  return()=>{stopped=true}
 },[action,bridge,accept])
 async function submit(){
  if(!action||busy||submitting.current||dispatched)return
  submitting.current=true;setBusy(true);setError('')
  try{
   let result:GitHubBoardSnapshot
   if(action.kind==='merge'){
    if(!preview)return
    result=await bridge.invoke('mergePR',{id:action.id,runId:action.runId,head:preview.head,method})
   }else if(action.kind==='link')result=await bridge.invoke('linkPR',{id:action.id,repo,number:Number(number)})
   else result=await bridge.invoke('followUp',{id:action.id,runId:action.runId,action:action.kind,instructions})
   accept(result)
   if(action.kind==='changes'||action.kind==='implement'){
    const run=[...result.cards,...(result.issues||[]),...result.tasks].find(c=>c.id===action.id)?.runs.at(-1)
    if(run&&['failed','uncertain'].includes(run.state)){setDispatched(true);setError(run.error||'Open the linked agent to check whether it received your instructions.');return}
   }
   host.notify(action.kind==='merge'?'PR merged on GitHub':action.kind==='link'?'PR linked':'Instructions sent to the existing agent');close()
  }catch(e){setError((e as Error).message);void bridge.invoke('snapshot',undefined).then(accept).catch(()=>{})}
  finally{submitting.current=false;setBusy(false)}
 }
 const title=action?.kind==='merge'?'Merge pull request?':action?.kind==='link'?'Link a pull request':action?.kind==='implement'?'Implement suggested fix':'Request changes'
 return <Dialog open={!!action&&active} onOpenChange={open=>{if(!open&&!busy)close()}}><DialogContent className="pr-dialog pr-review-action"><DialogTitle>{title}</DialogTitle><DialogDescription>{action?.kind==='merge'?'Merge this reviewed commit on GitHub. The card moves to Done and keeps its reports and agent session.':action?.kind==='link'?'Connect an existing PR to this issue or task. Its status and reports remain accessible from both cards.':action?.kind==='implement'?'Continue the existing agent conversation to edit files and test the suggested fix locally. It returns here for Human Review before publishing changes.':'Send instructions to the existing agent conversation. Its next report returns here for Human Review. This does not post a GitHub review.'}</DialogDescription>
  <div className="pr-action-subject"><span className="pr-muted">{action?.repo?`${action.repo} #${action.number}`:'Code task'}{action?.agent?` · ${action.agent}`:''}</span><strong>{action?.title}</strong></div>
  {action?.kind==='merge'?<>{busy&&!preview&&<p role="status">Checking the current PR and reviewed commit…</p>}{preview&&<><p className="pr-muted">Reviewed commit <code>{preview.head.slice(0,12)}</code> · Checks {preview.checks==='none'?'not configured':preview.checks}</p><label>Merge method<SelectField label="Merge method" value={method} onValueChange={v=>setMethod(v as typeof method)} disabled={busy} options={[{value:'squash',label:'Squash and merge'},{value:'merge',label:'Create a merge commit'},{value:'rebase',label:'Rebase and merge'}]}/></label><p className="pr-muted">GitHub’s branch rules apply. The branch stays in place.</p></>}</>:action?.kind==='link'?<div className="pr-form-row"><label>Repository<SelectField label="Linked PR repository" value={repo} onValueChange={setRepo} options={data.repositories.map(r=>r.name)} disabled={busy}/></label><label>PR number<Input aria-label="Linked PR number" type="number" min={1} value={number} onChange={e=>setNumber(e.target.value)} disabled={busy}/></label></div>:<label>{action?.kind==='implement'?'Additional instructions (optional)':'Instructions'}<Textarea aria-label="Agent follow-up instructions" autoFocus value={instructions} onChange={e=>setInstructions(e.target.value)} maxLength={8000} disabled={busy||dispatched} placeholder={action?.kind==='implement'?'Anything the agent should account for while implementing…':'What should the agent change or investigate further?'}/></label>}
  {error&&<p className="pr-error" role="alert">{error}</p>}
  <div className="dialog-actions"><Button variant="ghost" disabled={busy} onClick={close}>{dispatched?'Close':'Cancel'}</Button><Button disabled={busy||dispatched||action?.kind==='merge'&&!preview||action?.kind==='changes'&&!instructions.trim()||action?.kind==='link'&&(!repo||!Number.isSafeInteger(Number(number))||Number(number)<1)} onClick={()=>void submit()}>{busy?'Working…':action?.kind==='merge'?'Merge on GitHub':action?.kind==='link'?'Link PR':action?.kind==='implement'?'Implement fix':'Send to agent'}</Button></div>
 </DialogContent></Dialog>
}
