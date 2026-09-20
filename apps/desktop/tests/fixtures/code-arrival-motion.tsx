import {useLayoutEffect,useState} from 'react'
import type {GitHubBoardSnapshot,PRRun,PRStage} from '@zq/module-api'
import {CodeTaskArrival,useCodeTaskArrivals} from '../../../../modules/code/useCodeTaskArrivals'
import '../../../../modules/code/code-tasks.css'

type RunState=PRRun['state']
type View={active:boolean;scope:string;shown:boolean;offscreen:boolean}
type Delivery={state?:RunState;runId?:string;stage?:PRStage;automatic?:boolean;ticket?:number}
const stages:PRStage[]=['Agent reviewing','Needs your input','Ready to merge']
function initial(state:RunState):GitHubBoardSnapshot{
 return {cards:[],issues:[],repositories:[],login:'fixture',projects:[],profiles:[],tasks:[{
  id:'arrival-task',source:'task',title:'Investigate fixture issue',description:'No external services or saved data.',category:'General',state:'OPEN',head:'fixture',updatedAt:'2026-09-19',
  stage:state==='complete'?'Needs your input':'Agent reviewing',
  runs:[{id:'run-1',agent:'codex',profileId:'fixture',projectId:'fixture',state,startedAt:1,report:state==='complete'?'Fixture report':'',head:'fixture'}],
 }]}
}

function Board({initialState,reset}:{initialState:RunState;reset:(state?:RunState)=>void}){
 const [data,setData]=useState(()=>initial(initialState))
 const [view,setView]=useState<View>({active:true,scope:'all',shown:true,offscreen:false})
 const tracker=useCodeTaskArrivals(data,view.shown?['arrival-task']:[],view.scope,view.active)
 useLayoutEffect(()=>{
  const send=({state,runId,stage,automatic=true,ticket}:Delivery={})=>{
   const task=data.tasks[0],run=task.runs.at(-1)!
   const nextRun={...run,id:runId??run.id,state:state??run.state,report:state==='complete'?'Fixture report':run.report}
   const next:GitHubBoardSnapshot={...data,tasks:[{...task,stage:stage??(nextRun.state==='complete'?'Needs your input':'Agent reviewing'),runs:[nextRun]}]}
   tracker.observe(next,automatic?(ticket??tracker.begin()):undefined)
   setData(next)
  }
  ;(window as any).codeArrivalFixture={
   reset,send,begin:tracker.begin,
   patch:(patch:Partial<View>)=>setView(old=>({...old,...patch})),
   snapshot:()=>({data,view,arrivals:tracker.arrivals}),
  }
 },[data,view,tracker.arrivals,tracker.observe,tracker.begin,reset])
 return <section data-testid="kanban-arrival" className="pr-view" style={{display:'block',height:220,padding:12}}>
  <h2>Background task completion</h2>
  <div style={{display:'grid',gridTemplateColumns:'repeat(3,minmax(150px,1fr))',gap:16}}>
   {stages.map((stage,index)=><div key={stage} data-fixture-stage={stage}>
    <h3>{['In progress','Human Review','Done'][index]}</h3>
    {view.active&&view.shown&&data.tasks.filter(task=>task.stage===stage).map(task=><article key={task.id} className="pr-card" data-card-id={task.id} data-stage={index+2} style={{minHeight:100,padding:12,...(view.offscreen?{marginLeft:'200vw',width:200}:{})}}>
     {tracker.arrivals[task.id]&&<CodeTaskArrival id={task.id} runId={tracker.arrivals[task.id]} finish={tracker.finish}/>}
     <strong>{task.title}</strong><p>{task.runs.at(-1)?.state==='complete'?'Report ready':'Agent working'}</p><button>Open fixture report</button>
    </article>)}
   </div>)}
  </div>
 </section>
}

export default function CodeArrivalMotion(){
 const [seed,setSeed]=useState<{key:number;state:RunState}>({key:0,state:'running'})
 return <Board key={seed.key} initialState={seed.state} reset={(state='running')=>setSeed(old=>({key:old.key+1,state}))}/>
}
