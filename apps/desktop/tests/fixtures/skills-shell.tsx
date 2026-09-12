import React from 'react'
import {createRoot} from 'react-dom/client'
import {ModuleSurface,useHost,freshWorkspace} from '@zq/module-api'
import App from '../../src/App'
import SkillsSettings from '../../../../modules/chat/SkillsSettings'
import '@zq/ui/styles.css'
import '../../src/shell.css'
import '../../../../modules/chat/chat.css'
const ok=value=>Promise.resolve({ok:true,value})
window.zq={onCommand:fn=>{window.nativeCommand=fn;return()=>{}},modules:{list:()=>ok([])},voice:{},chat:{},attachments:{},files:{},artifacts:{},clipboard:{}}
function Root(){const host=useHost();return <><ModuleSurface><button onClick={()=>host.openSettings('skills')}>Manage skills from chat</button></ModuleSurface><ModuleSurface slot="settings"><h2>Connections fixture</h2></ModuleSurface><ModuleSurface slot="skillsSettings"><SkillsSettings closing={false} chat={{loading:false,error:'',state:{skills:[],error:''}}}/></ModuleSurface></>}
const initial=freshWorkspace();initial.layout.view='Chat';initial.theme='light'
createRoot(document.getElementById('root')!).render(<App initialState={initial} initialFiles={[]} onSnapshot={()=>{}} onFilesChange={()=>{}} saveStatus="Isolated fixture" onWorkspaceFlush={async()=>{}} onFileFlush={()=>{}} closing={false} modules={[{manifest:{id:'zq.chat',title:'Chat',view:'Chat',icon:'chat',version:'1.9.0',apiVersion:1,capabilities:['chat','attachments','skills.v1']},Root}]}/> )
