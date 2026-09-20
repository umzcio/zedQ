import {useLayoutEffect,useState} from 'react'
import ModuleSettings from '../../src/ModuleSettings'
import '../../src/settings.css'
const base={id:'zq.fixture',title:'Fixture module',version:'1.0.0',bundledVersion:'1.0.0',pendingVersion:null as string|null,previousVersion:'0.9.0',source:'bundled'}
let rows=[{...base}],pending:((value:any)=>void)|null=null,calls:string[]=[]
const modules={list:async()=>({ok:true,value:structuredClone(rows)}),install:()=>request('install'),download:()=>request('download'),rollback:()=>request('rollback')}
function request(kind:string){calls.push(kind);return new Promise(resolve=>{pending=resolve})}
export default function ModuleUpdateMotion(){
 const [view,setView]=useState({key:0,mounted:true,hidden:false,clipped:false,closing:false})
 useLayoutEffect(()=>{
  ;(window as any).zq={...(window as any).zq,modules}
  ;(window as any).moduleUpdateFixture={
   reset:(version:string|null=null)=>{rows=[{...base,pendingVersion:version}];pending=null;calls=[];setView(v=>({...v,key:v.key+1,mounted:true,hidden:false,clipped:false,closing:false}))},
   patch:(patch:Partial<typeof view>)=>setView(v=>({...v,...patch})),
   snapshot:()=>({rows,calls,pending:!!pending,view}),
   finish:({version='1.1.0',cancel=false,error=false,mismatch=false}:{version?:string;cancel?:boolean;error?:boolean;mismatch?:boolean}={})=>{
    const resolve=pending;pending=null;if(!resolve)throw Error('No native action is pending')
    if(cancel){resolve({ok:true,value:null});return}if(error){resolve({ok:false,error:{code:'FIXTURE',message:'Signature verification failed in fixture'}});return}
    const result={...base,pendingVersion:version};rows=[{...result,pendingVersion:mismatch?'9.9.9':version}];resolve({ok:true,value:result})
   },
  }
 },[view])
 return <section data-testid="module-update-ready" className="settings-page"><h2>Verified module update</h2><div className="settings-panel" hidden={view.hidden} inert={view.hidden} style={view.clipped?{height:60,overflow:'hidden'}:{}}>{view.mounted&&<ModuleSettings key={view.key} closing={view.closing}/>}</div></section>
}
