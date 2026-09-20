import {useEffect,useRef,useState} from 'react'
import {useHost,unwrap,type ResearchSummary,type ResearchDetail,type ResearchInput,type ResearchPlan} from '@zq/module-api'
export const researchActive=(job:ResearchSummary)=>['queued','running','awaiting_plan'].includes(job.status)
export const researchLabel=(job:ResearchSummary)=>job.status==='awaiting_plan'?'Review plan':job.status==='completed'?'Report ready':job.status==='running'?({planning:'Planning',researching:'Researching',checking:'Checking findings',writing:'Writing report'})[job.phase]:({queued:'Queued',stopped:'Stopped',interrupted:'Interrupted',failed:'Needs attention'})[job.status]??job.status
export type ResearchTab='overview'|'plan'|'sources'
export type ResearchPlanDraft={title:string;steps:string;answers:string[]}
/** Mounted by persistent Chat Root; navigation never owns or stops native work. */
export function useResearch(){
 const host=useHost(),bridge=host.services.research,latest=useRef(host);latest.current=host
 const [jobs,setJobs]=useState<ResearchSummary[]>([]),[error,setError]=useState(''),[loading,setLoading]=useState(!!bridge)
 const values=useRef(new Map<string,ResearchSummary>()),locks=useRef(new Set<string>()),[pending,setPending]=useState<string[]>([])
 const [detailRefresh,setDetailRefresh]=useState(0)
 const [planDrafts,setPlanDrafts]=useState<Record<string,ResearchPlanDraft>>({})
 const [target,setTarget]=useState<{id:string;tab:ResearchTab}|null>(null),[detail,setDetail]=useState<ResearchDetail|null>(null),[detailError,setDetailError]=useState('')
 const origin=useRef<HTMLElement|null>(null),originId=useRef('')
 const targetRef=useRef(target);targetRef.current=target
 function apply(job:ResearchSummary){const prior=values.current.get(job.id);if(prior&&prior.revision>job.revision)return;values.current.set(job.id,job);setJobs([...values.current.values()].sort((a,b)=>b.createdAt-a.createdAt))}
 function open(job:ResearchSummary,tab:ResearchTab='overview'){originId.current=job.id;origin.current=document.activeElement instanceof HTMLElement?document.activeElement:null;latest.current.commands.run('chat.open',{conversationId:job.conversationId});setDetail(null);setDetailError('');setTarget({id:job.id,tab})}
 function openReport(job:ResearchSummary){if(job.report)latest.current.commands.run('chat.open',{conversationId:job.conversationId,report:job.report})}
 useEffect(()=>{
  if(!bridge)return;let live=true
  const unsubscribe=bridge.subscribe(change=>{if(!live)return;if(change.error){setError(change.error.message);return}setError('');if(!change.job)return
   const before=values.current.get(change.job.id);if(before&&before.revision>=change.job.revision)return;apply(change.job)
   if(before&&before.status!=='completed'&&change.job.status==='completed'){const job=change.job;latest.current.notify(`Research ready: ${job.title}`,{label:job.report?'Open report':'Open research',run:()=>{if(latest.current.closing)return;job.report?openReport(job):open(job)}})}
  })
  unwrap(bridge.list()).then(items=>{if(live)items.forEach(apply)}).catch(e=>{if(live)setError(e.message)}).finally(()=>{if(live)setLoading(false)})
  return()=>{live=false;unsubscribe()}
 },[bridge])
 const revision=jobs.find(j=>j.id===target?.id)?.revision
 useEffect(()=>{if(!bridge||!target)return;let live=true;const id=target.id
  unwrap(bridge.get(id)).then(result=>{if(live){setDetailError('');setDetail(old=>old?.id===id&&old.revision>result.revision?old:result)}}).catch(e=>{if(live)setDetailError(e.message)})
  return()=>{live=false}
 },[bridge,target?.id,revision,detailRefresh])
 async function run<T>(id:string,fn:()=>Promise<T>){if(!bridge||latest.current.closing||locks.current.has(id))throw Error('Wait for the current research action to finish.');locks.current.add(id);setPending([...locks.current]);try{return await fn()}finally{locks.current.delete(id);setPending([...locks.current])}}
 async function start(input:ResearchInput){return run(input.conversationId,async()=>{const job=await unwrap(bridge!.create(input));apply(job);return job})}
 async function act(job:ResearchSummary,action:'stop'|'finish'|'resume'){return run(job.id,async()=>{const next=await unwrap(bridge![action](job.id));apply(next);if(targetRef.current?.id===job.id)setDetail(next);return next})}
 async function accept(job:ResearchDetail,plan:ResearchPlan){return run(job.id,async()=>{const next=await unwrap(bridge!.acceptPlan({id:job.id,expectedRevision:job.revision,plan}));apply(next);setDetail(next);setPlanDrafts(old=>{const copy={...old};delete copy[`${job.id}:${job.planVersion}`];return copy});return next})}
 async function retry(){if(!bridge)return;const items=await unwrap(bridge.retryStorage());values.current.clear();setJobs([]);items.forEach(apply);setError('')}
 function restoreFocus(){requestAnimationFrame(()=>{if(latest.current.closing||latest.current.workspace.layout.view!=='Chat')return;const element=origin.current?.isConnected?origin.current:document.querySelector<HTMLElement>(`[data-research-id="${originId.current}"] button`)??document.querySelector<HTMLElement>('[aria-label="Chat message"]');element?.focus({preventScroll:true})})}
 return {reloadDetail:()=>{setDetailError('');setDetailRefresh(value=>value+1)},planDrafts,setPlanDraft:(key:string,value:ResearchPlanDraft)=>setPlanDrafts(old=>({...old,[key]:value})),restoreFocus,available:!!bridge,jobs,loading,error,pending,target,detail,detailError,open,openReport,close:()=>setTarget(null),setTab:(tab:ResearchTab)=>setTarget(old=>old?{...old,tab}:null),start,act,accept,retry}
}
export type ResearchController=ReturnType<typeof useResearch>
