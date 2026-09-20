import {useLayoutEffect,useRef,useState} from 'react'
import {ModuleHostProvider} from '@zq/module-api'
import ChatCode from '../../../../modules/chat/ChatCode'
import ChatMessageActions from '../../../../modules/chat/ChatMessageActions'

type Mode='success'|'failure'|'hold'
const initial={codeMounted:true,messageMounted:true,code:'console.log("fixture")',content:'A **fixture** response.',identity:'one',epoch:0}
export default function CopyFeedbackMotion(){
 const [state,setState]=useState(initial)
 const control=useRef({mode:'success' as Mode,requests:[] as {id:number;text:string}[],notices:[] as string[],pending:new Map<number,(result:unknown)=>void>(),sequence:0})
 const outcome=(success:boolean)=>success?{ok:true,value:null}:{ok:false,error:{code:'FIXTURE',message:'Simulated clipboard rejection'}}
 const host={closing:false,commands:{run:()=>true},notify:(text:string)=>control.current.notices.push(text),services:{clipboard:{writeText:(text:string)=>{
  const c=control.current,id=++c.sequence;c.requests.push({id,text})
  return c.mode==='hold'?new Promise(resolve=>c.pending.set(id,resolve)):Promise.resolve(outcome(c.mode==='success'))
 }},chat:{saveTextFile:()=>Promise.resolve({ok:true,value:false})},artifacts:{list:()=>Promise.resolve({ok:true,value:[]})}}}
 useLayoutEffect(()=>{
  ;(window as any).copyFeedbackFixture={
   patch:(patch:Partial<typeof initial>)=>setState(old=>({...old,...patch})),
   mode:(mode:Mode)=>{control.current.mode=mode},
   settle:(id:number,success=true)=>{const c=control.current,resolve=c.pending.get(id);if(!resolve)throw Error('Unknown pending clipboard request');c.pending.delete(id);resolve(outcome(success))},
   snapshot:()=>({state,requests:control.current.requests,notices:control.current.notices,pending:[...control.current.pending.keys()]}),
   reset:()=>{const c=control.current;for(const resolve of c.pending.values())resolve(outcome(false));c.pending.clear();c.requests=[];c.notices=[];c.mode='success';setState(old=>({...initial,epoch:old.epoch+1}))},
  }
 },[state])
 const message={id:'message-'+state.identity,role:'assistant',content:state.content,thinking:'',status:'complete',createdAt:1,context:[],error:''}
 const chat={conversation:{id:'conversation-'+state.identity,title:'Fixture conversation'},state:{connections:[]}}
 return <ModuleHostProvider value={host as any}><section data-testid="copy-feedback"><h2>Clipboard confirmation</h2>
  <div data-testid="copy-code">{state.codeMounted&&<ChatCode key={'code-'+state.epoch+'-'+state.identity} code={state.code} language="javascript"/>}</div>
  <div data-testid="copy-message">{state.messageMounted&&<ChatMessageActions key={'message-'+state.epoch+'-'+state.identity} message={message as any} chat={chat as any} choice={null} disabled={false} notes={[]} settings={()=>{}}><p>{state.content}</p></ChatMessageActions>}</div>
 </section></ModuleHostProvider>
}
