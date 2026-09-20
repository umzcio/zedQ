import {useLayoutEffect,useMemo,useRef,useState} from 'react'
import {ModuleHostProvider,type CodeFileTransfer,type CodeProject,type Host} from '@zq/module-api'
import {CodeWorkspace} from '../../../../modules/code/CodeWorkspace'
import '../../../../modules/code/code.css'

type State={active:boolean;mounted:boolean;target:string;offscreen:boolean;seed:number}
type Finish={completed?:number;canceled?:boolean;states?:CodeFileTransfer['state'][]}
const oldRow:CodeFileTransfer={id:'history',name:'Saved transfer.txt',direction:'upload',bytes:100,total:100,state:'done'}
export default function TransferCompletionMotion(){
 const [state,setState]=useState<State>({active:true,mounted:true,target:'transfer-a',offscreen:false,seed:0})
 const store=useRef({rows:{'transfer-a':[oldRow]} as Record<string,CodeFileTransfer[]>,calls:[] as string[],id:0,fast:false,baselineFailure:false,pending:null as null|{target:string;direction:'upload'|'download';resolve:(result:{completed:number;canceled:boolean})=>void;reject:(error:Error)=>void}})
 const finish=(options:Finish={})=>{
  const pending=store.current.pending;if(!pending)throw Error('No fixture transfer pending')
  const states=options.states??['done']
  const rows=states.map(status=>({id:`transfer-${++store.current.id}`,name:`Transfer ${store.current.id}.txt`,direction:pending.direction,bytes:100,total:100,state:status}))
  store.current.rows[pending.target]=[...(store.current.rows[pending.target]||[]),...rows]
  store.current.pending=null
  pending.resolve({completed:options.completed??states.filter(s=>s==='done').length,canceled:options.canceled??false})
 }
 const bridge=useMemo(()=>({invoke:async(method:string,input:any)=>{
  store.current.calls.push(method)
  const key=input?.projectId??'transfer-a'
  if(method==='fileTransfers'){if(store.current.baselineFailure)throw Error('Fixture baseline unavailable');return structuredClone(store.current.rows[key]||[])}
  if(method==='listFiles')return {entries:[{name:'Download.txt',path:'Download.txt',kind:'file'}],truncated:false}
  if(method==='uploadFiles'||method==='downloadFile'){
   store.current.baselineFailure=false
   const result=new Promise<{completed:number;canceled:boolean}>((resolve,reject)=>{store.current.pending={target:key,direction:method==='uploadFiles'?'upload':'download',resolve,reject}})
   if(store.current.fast)finish()
   return result
  }
  throw Error('Unexpected fixture invocation '+method)
 }}),[])
 useLayoutEffect(()=>{
  ;(window as any).transferCompletionFixture={
   patch:(patch:Partial<State>)=>setState(old=>({...old,...patch})),
   reset:(rows:CodeFileTransfer[]=[oldRow])=>{
    store.current.pending?.reject(Error('Fixture reset'));store.current.pending=null
    store.current.rows={'transfer-a':rows};store.current.calls=[];store.current.fast=false;store.current.baselineFailure=false
    setState(old=>({active:true,mounted:true,target:'transfer-a',offscreen:false,seed:old.seed+1}))
   },
   complete:finish,
   fail:()=>{const pending=store.current.pending;store.current.pending=null;pending?.reject(Error('TRANSFER_FAILED'))},
   setRows:(rows:CodeFileTransfer[])=>{store.current.rows[state.target]=rows},
   failBaseline:()=>{store.current.baselineFailure=true},
   fast:(value:boolean)=>{store.current.fast=value},
   snapshot:()=>({state,rows:store.current.rows,calls:store.current.calls,pending:!!store.current.pending}),
  }
 },[state])
 const project:CodeProject={id:state.target,name:'Transfer fixture',hostId:'local',cwd:'/fixture',icon:'FolderSimple',color:'neutral',createdAt:1}
 const host={workspace:{layout:{view:state.active?'Code':'Notes'}},services:{code:bridge,clipboard:{writeText:async()=>{throw Error('Fixture does not allow clipboard writes')}}}} as unknown as Host
 return <section data-testid="transfer-completion" style={{width:520,height:440,overflow:'hidden',position:'relative'}}><h2>File transfer completion</h2><ModuleHostProvider value={host}><div style={{height:370,display:state.active?'flex':'none',...(state.offscreen?{transform:'translateX(200vw)'}:{})}}>{state.mounted&&<CodeWorkspace key={state.seed} project={project} onClose={()=>setState(old=>({...old,mounted:false}))}/>}</div></ModuleHostProvider></section>
}
