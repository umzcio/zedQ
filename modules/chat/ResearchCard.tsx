import type {ReactElement} from 'react'
import {useHost,type ResearchSummary} from '@zq/module-api'
import {Button,ContextMenu,ContextMenuTrigger,ContextMenuContent,ContextMenuItem,DropdownMenu,DropdownMenuTrigger,DropdownMenuContent,DropdownMenuItem} from '@zq/ui'
import {DotsThree,MagnifyingGlass} from '@phosphor-icons/react'
import {researchActive,researchLabel,type ResearchController} from './useResearch'
export function useResearchActions(research:ResearchController,job:ResearchSummary|undefined){
 const host=useHost();if(!job)return [];const blocked=host.closing||research.pending.includes(job.id)
 const act=(action:'stop'|'finish'|'resume')=>void research.act(job,action).catch(e=>host.notify(e.message))
 return [
  {label:'Open research',disabled:host.closing,run:()=>research.open(job)},
  {label:'View plan',disabled:host.closing,run:()=>research.open(job,'plan')},
  {label:'View sources',disabled:host.closing,run:()=>research.open(job,'sources')},
  ...(job.report?[{label:'Open report',disabled:host.closing,run:()=>research.openReport(job)}]:[]),
  ...(researchActive(job)?[{label:'Stop research',disabled:blocked,run:()=>act('stop')}]:[]),
  ...(['stopped','interrupted','failed'].includes(job.status)?[{label:'Resume research',disabled:blocked,run:()=>act('resume')}]:[]),
  ...(job.phase!=='planning'&&job.status!=='completed'?[{label:'Finish with saved evidence',disabled:blocked||job.finishRequested,run:()=>act('finish')}]:[]),
 ]
}
export function ResearchMenu({research,job,children}:{research:ResearchController;job:ResearchSummary;children:ReactElement}){
 const actions=useResearchActions(research,job)
 return <ContextMenu><ContextMenuTrigger asChild>{children}</ContextMenuTrigger><ContextMenuContent>{actions.map(a=><ContextMenuItem key={a.label} disabled={a.disabled} onSelect={a.run}>{a.label}</ContextMenuItem>)}</ContextMenuContent></ContextMenu>
}
export default function ResearchCard({research,job,compact=false}:{research:ResearchController;job:ResearchSummary;compact?:boolean}){
 const actions=useResearchActions(research,job),active=researchActive(job)
 return <ResearchMenu research={research} job={job}><section className={`research-card${compact?' research-card-compact':''}`} data-research-id={job.id} data-active={active}>
 <div className="research-card-heading"><MagnifyingGlass size={17}/><button type="button" onClick={()=>research.open(job)}><strong>{job.title}</strong><span role="status">{researchLabel(job)}</span></button><DropdownMenu><DropdownMenuTrigger asChild><Button type="button" variant="ghost" size="sm" aria-label={`Research actions for ${job.title}`}><DotsThree size={18}/></Button></DropdownMenuTrigger><DropdownMenuContent align="end">{actions.map(a=><DropdownMenuItem key={a.label} disabled={a.disabled} onSelect={a.run}>{a.label}</DropdownMenuItem>)}</DropdownMenuContent></DropdownMenu></div>
 {!compact&&<><p className="research-hint">{job.evidenceCount} evidence records · {job.findingCount} findings · {job.usedSourceIds.length} sources used</p>{job.error&&<p className="research-error" role="alert">{job.error.message}</p>}<div className="research-card-actions"><Button type="button" size="sm" variant={job.status==='awaiting_plan'?'default':'outline'} onClick={()=>job.report?research.openReport(job):research.open(job,job.status==='awaiting_plan'?'plan':'overview')}>{job.report?'Open report':job.status==='awaiting_plan'?'Review plan':'View progress'}</Button>{actions.filter(a=>['Stop research','Resume research','Finish with saved evidence'].includes(a.label)).map(a=><Button type="button" size="sm" variant="ghost" key={a.label} disabled={a.disabled} onClick={a.run}>{a.label}</Button>)}</div></>}
 </section></ResearchMenu>
}
