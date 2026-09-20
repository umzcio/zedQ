import {useState} from 'react'
import {useHost,type ResearchDetail,type ResearchEvidence,unwrap} from '@zq/module-api'
import {Button,Input,Tabs,TabsList,TabsTrigger,TabsContent,Dialog,DialogContent,DialogTitle,DialogDescription,ContextMenu,ContextMenuTrigger,ContextMenuContent,ContextMenuItem} from '@zq/ui'
import {researchLabel,type ResearchController} from './useResearch'
import {useResearchActions} from './ResearchCard'
function PlanEditor({job,research}:{job:ResearchDetail;research:ResearchController}){
 const {closing}=useHost(),[error,setError]=useState('')
 const key=`${job.id}:${job.planVersion}`,draft=research.planDrafts[key]??{title:job.plan?.title??'',steps:job.plan?.steps.join('\n')??'',answers:[]}, {title,steps,answers}=draft
 const setTitle=(title:string)=>research.setPlanDraft(key,{...draft,title}),setSteps=(steps:string)=>research.setPlanDraft(key,{...draft,steps})
 const questions=job.plan?.questions??[],busy=closing||research.pending.includes(job.id)
 async function accept(){setError('');try{const resolved=questions.map((q,i)=>`Clarification — ${q}: ${answers[i]?.trim()}`);await research.accept(job,{title,steps:[...steps.split('\n').map(s=>s.trim()).filter(Boolean),...resolved],questions:[]});research.setTab('overview')}catch(e){setError((e as Error).message)}}
 return <form className="research-plan" onSubmit={e=>{e.preventDefault();void accept()}}><label>Report title<Input aria-label="Research plan title" value={title} maxLength={200} disabled={busy} onChange={e=>setTitle(e.target.value)}/></label><label>Research steps<textarea aria-label="Research steps" value={steps} rows={5} disabled={busy} onChange={e=>setSteps(e.target.value)}/></label><p className="research-hint">One step per line. Up to 16 steps, including clarification answers.</p>
 {questions.map((q,i)=><label key={i}>{q}<textarea aria-label={`Answer: ${q}`} maxLength={1200} rows={2} value={answers[i]??''} disabled={busy} onChange={e=>research.setPlanDraft(key,{...draft,answers:Object.assign([...answers],{[i]:e.target.value})})}/></label>)}
 <div className="research-plan-sources"><strong>Authorized sources</strong>{job.sources.map(s=><p key={s.id}>{s.label} — {s.scopeDescription}</p>)}<p>Selected reference text goes to this chat’s model. Connector access is read-only. Research continues while zQ is open.</p></div>
 {error&&<p role="alert" className="research-error">{error}</p>}<Button type="submit" disabled={busy||!title.trim()||!steps.trim()||questions.some((_,i)=>!answers[i]?.trim())}>{busy?'Starting…':'Accept plan and research'}</Button></form>
}
function EvidenceRow({item}:{item:ResearchEvidence}){
 const host=useHost(),[expanded,setExpanded]=useState(false)
 const copy=()=>void unwrap(host.services.clipboard.writeText(`${item.title} — ${item.url??item.locator}`)).catch(e=>host.notify(e.message))
 return <ContextMenu><ContextMenuTrigger asChild><section className="research-evidence"><button type="button" aria-expanded={expanded} onClick={()=>setExpanded(!expanded)}><strong>{item.title}</strong><small>{item.level} · {new Date(item.retrievedAt).toLocaleString()}</small></button>{expanded&&<><pre>{item.excerpt}</pre><p className="research-hint">{item.locator} · {item.provenance.tool}</p>{item.url&&<a href={item.url} target="_blank" rel="noreferrer">Open original</a>}</>}</section></ContextMenuTrigger><ContextMenuContent><ContextMenuItem onSelect={()=>setExpanded(!expanded)}>{expanded?'Hide evidence':'View evidence'}</ContextMenuItem><ContextMenuItem onSelect={copy}>Copy citation</ContextMenuItem>{item.url&&<ContextMenuItem asChild><a href={item.url} target="_blank" rel="noreferrer">Open original</a></ContextMenuItem>}</ContextMenuContent></ContextMenu>
}
function Content({research,job}:{research:ResearchController;job:ResearchDetail}){
 const actions=useResearchActions(research,job),tab=research.target?.tab
 return <Tabs value={tab} onValueChange={value=>research.setTab(value as 'overview'|'plan'|'sources')} className="research-dialog-tabs"><TabsList className="research-tabs" aria-label="Research details">{(['overview','plan','sources'] as const).map(name=><TabsTrigger key={name} value={name}>{name==='overview'?'Progress':name==='plan'?'Plan':'Sources'}</TabsTrigger>)}</TabsList>
 <TabsContent value={tab??'overview'} className="research-detail-body">
 {tab==='plan'?(job.plan?job.status==='awaiting_plan'?<PlanEditor key={`${job.id}:${job.planVersion}`} job={job} research={research}/>:<><h3>{job.plan.title}</h3><ol>{job.plan.steps.map((step,i)=><li key={i}>{step}</li>)}</ol>{job.plan.questions.length>0&&<p>Resume planning to answer the clarification questions.</p>}</>:<p>The plan is being prepared.</p>):tab==='sources'?<>
 <h3>Selected sources</h3>{job.sources.map(s=><div className="research-bound-source" key={s.id}><strong>{s.label}</strong><span>{job.usedSourceIds.includes(s.id)?'Used':'Selected · not used yet'}</span><p>{s.scopeDescription}</p></div>)}<h3>Saved evidence ({job.evidence.length})</h3>{job.evidence.map(item=><EvidenceRow key={item.id} item={item}/>)}{!job.evidence.length&&<p>No evidence collected yet.</p>}
 </>:<><p>{job.brief}</p><p role="status">{researchLabel(job)} · {job.evidenceCount} evidence records · {job.findingCount} findings</p><p className="research-hint">{job.choice.model} · {job.usage.steps}/{job.limits.maxSteps} steps · {Math.round(job.usage.activeMs/1000)} seconds of active budget{job.usage.unmeasuredSteps?' · Some usage is unmeasured':''}</p>
 {job.error&&<p className="research-error" role="alert">{job.error.message}</p>}
 <h3>Activity</h3>{job.steps.length?<ol className="research-activity">{job.steps.map(step=><li key={step.id}><strong>{step.activity?.description??({planning:'Prepare plan',researching:'Investigate sources',checking:'Check findings',writing:'Write report',publishing:'Save report'})[step.phase]}</strong><small>{step.status==='started'?'In progress':step.status==='complete'?'Complete':'Interrupted'}</small></li>)}</ol>:<p>Waiting to start.</p>}
 {!!job.findings.length&&<><h3>Findings</h3>{job.findings.map(f=><p key={f.id}>{f.text}<small className="research-hint"> {f.kind} · {f.evidenceIds.length} evidence references</small></p>)}</>}
 {!!job.gaps.length&&<><h3>Gaps and limitations</h3><ul>{job.gaps.map((gap,i)=><li key={i}>{gap}</li>)}</ul></>}
 </>}
 </TabsContent><div className="research-dialog-footer">{actions.filter(a=>!['Open research','View plan','View sources'].includes(a.label)).map(a=><Button type="button" key={a.label} disabled={a.disabled} variant={a.label==='Open report'?'default':'outline'} size="sm" onClick={()=>{a.run();if(a.label==='Open report')research.close()}}>{a.label}</Button>)}</div></Tabs>
}
export default function ResearchDialog({research}:{research:ResearchController}){
 const {closing}=useHost(),job=research.detail?.id===research.target?.id?research.detail:null
 return <Dialog open={!!research.target&&!closing} onOpenChange={open=>{if(!open)research.close()}}><DialogContent className="research-dialog" onCloseAutoFocus={e=>{e.preventDefault();research.restoreFocus()}}><DialogTitle>{job?.title??'Research'}</DialogTitle><DialogDescription>Saved research stays with this chat. You can leave this view while the job runs.</DialogDescription>{research.detailError?<div><p role="alert">{research.detailError}</p><Button type="button" variant="outline" onClick={research.reloadDetail}>Retry loading research</Button></div>:job?<Content research={research} job={job}/>:<p role="status">Loading research…</p>}</DialogContent></Dialog>
}
