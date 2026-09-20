import React,{useState} from 'react'
import {createRoot} from 'react-dom/client'
import {ModuleHostProvider} from '@zq/module-api'
import {useChat} from '../../../../modules/chat/useChat'
import {ArtifactWorkspace} from '../../../../modules/chat/ArtifactPane'
import ChatView from '../../../../modules/chat/ChatView'
import ChatSidebar from '../../../../modules/chat/ChatSidebar'
import ShellNotice from '../../src/ShellNotice'
import '@zq/ui/styles.css'
import '../../../../modules/chat/chat.css'
import '../../src/shell.css'
const ok=value=>Promise.resolve({ok:true,value})
const request=(service,method,input)=>window.researchFixtureCall(service,method,input)
const handlers=new Map(),commands={register:(name,fn)=>{handlers.set(name,fn);return()=>handlers.delete(name)},run:(name,input)=>{window.events.push(['command',name,input]);handlers.get(name)?.(input);return handlers.has(name)}}
window.events=[]
const services={
 attachments:new Proxy({},{get:(_,key)=>(input=>request('attachments',key,input))}),
 artifacts:new Proxy({subscribe:fn=>{window.artifactsChanged=fn;return()=>{window.artifactsChanged=null}}},{get:(object,key)=>object[key]??(input=>request('artifacts',key,input))}),
 chat:new Proxy({subscribe:fn=>{window.chatChanged=fn;return()=>{window.chatChanged=null}}},{get:(object,key)=>object[key]??(input=>request('chat',key,input))}),
 research:new Proxy({subscribe:fn=>{window.researchChanged=fn;return()=>{window.researchChanged=null}}},{get:(object,key)=>object[key]??(input=>request('research',key,input))}),
 connectors:{list:()=>ok([]),catalog:()=>ok([]),subscribe:()=>()=>{}},
 voice:{status:()=>ok({}),settings:()=>ok({})},clipboard:{writeText:text=>{window.events.push(['copy',text]);return ok(null)}}
}
function Content({view,boot}){const chat=useChat();window.chatState=chat;return <><nav style={{padding:8,display:'flex',gap:12}}><button onClick={()=>chat.select(boot.ids[0])}>First chat</button><button onClick={()=>chat.select(boot.ids[1])}>Second chat</button></nav>{view==='Chat'?<div style={{display:'flex',flex:1,minHeight:0}}><aside style={{width:240,padding:12,borderRight:'1px solid var(--line)',overflow:'auto'}}><ChatSidebar chat={chat} closing={false}/></aside><main style={{flex:1,minWidth:0,display:'flex',flexDirection:'column'}}><ArtifactWorkspace chat={chat}><ChatView chat={chat} notes={boot.notes} closing={false} settings={()=>{}} prepareNotes={async()=>{}}/></ArtifactWorkspace></main></div>:<div tabIndex={0} id="other-module">Code workspace remains usable</div>}</>}
function Fixture({boot}){
 const [view,setView]=useState('Chat'),[notice,setNotice]=useState(null)
 const host={workspace:{layout:{view},notes:boot.notes,tasks:[],settings:{},profile:{}},closing:false,registerFlush:()=>()=>{},commands,navigate:setView,notify:(text,action)=>setNotice({text,action}),services}
 return <ModuleHostProvider value={host}><div style={{height:'100vh',display:'flex',flexDirection:'column'}}><nav style={{display:'flex',gap:12,padding:8,borderBottom:'1px solid var(--line)'}}><button onClick={()=>setView('Chat')}>Chat module</button><button onClick={()=>setView('Code')}>Code module</button><button onClick={()=>document.documentElement.dataset.theme=document.documentElement.dataset.theme==='dark'?'light':'dark'}>Toggle theme</button></nav><Content view={view} boot={boot}/><ShellNotice notice={notice?.text??''} action={notice?.action} onDismiss={()=>setNotice(null)}/></div></ModuleHostProvider>
}
request('fixture','bootstrap').then(result=>createRoot(document.getElementById('root')).render(<Fixture boot={result.value}/>))
