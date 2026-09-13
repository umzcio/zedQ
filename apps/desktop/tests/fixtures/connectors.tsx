import React,{useState} from 'react'
import {createRoot} from 'react-dom/client'
import {ModuleHostProvider} from '@zq/module-api'
import ConnectorSettings from '../../../../modules/chat/ConnectorSettings'
import '@zq/ui/styles.css'
import '../../../../modules/chat/chat.css'
import '../../src/shell.css'
import '../../src/settings.css'
const ok=value=>Promise.resolve({ok:true,value})
const names=['Scite.AI','arXiv','Gmail','Google Calendar','Google Drive','Microsoft 365','GitHub'],ids=['scite','arxiv','gmail','google-calendar','google-drive','microsoft365','github']
const catalog=window.catalog??ids.map((id,i)=>({id,name:names[i],description:['Find research and check how papers cite one another.','Search papers and retrieve abstracts and PDF source links.','Search and read your personal email.','Find events and manage your personal schedule.','Search and work with your personal files.','Work email, calendar, OneDrive files, and Teams.','Work with repositories, issues, and pull requests.'][i],category:i<2?'Research':i===6?'Development':'Productivity',url:id==='arxiv'?'zq://arxiv/mcp':`https://${id}.example.test/mcp`,publisher:i>=2&&i<=4?'Google':names[i],documentationUrl:`https://docs.example.test/${id}`,accountLabel:i>=2&&i<=4?'Personal Google account':i===5?'Work Microsoft account':i===1?'Public research':`${names[i]} account`,setupNote:i>=2&&i<=4?'Google Workspace MCP is in developer preview. Configure a Google Cloud project and OAuth app; add your personal Google account as a test user. Enter your client ID and secret below.':i===5?'Your organization must allow Work IQ and approve the requested permissions.':i===6?'Use a GitHub access token or register an OAuth app.':'Connect to discover available tools.',authType:i===6?'bearer':'oauth',requiresSetup:i>=2,bundled:i===1,...(i>=2&&i<=4?{redirectHost:'127.0.0.1',redirectPort:42819}:{})}))
window.events=[]
function Fixture(){
 const [connectors,setConnectors]=useState([{id:'same-name',name:'Gmail',url:'https://unrelated.example.test/mcp',status:'disconnected',revision:1,tools:[]},{id:'legacy',name:'My renamed Scite',url:catalog[0].url.replace('https://','https://').replace('/mcp','/mcp/'),status:'disconnected',revision:1,tools:[]},{id:'stale-id',name:'Unrelated calendar',catalogId:'google-calendar',url:'https://unrelated.example.test/calendar',status:'connected',revision:1,tools:[]}])
 window.connectors=connectors
 window.seedCredentials=()=>setConnectors(old=>[...old,{id:'saved-github',name:'My code',url:catalog[6].url,catalogId:'github',authType:'bearer',hasToken:true,hasClientSecret:true,clientId:'existing-client',status:'disconnected',revision:1,tools:[]},{id:'stale-id',name:'Unrelated calendar',catalogId:'google-calendar',url:'https://unrelated.example.test/calendar',status:'connected',revision:1,tools:[]}])
 window.seedConnected=()=>setConnectors(old=>old.map(row=>row.id==='legacy'?{...row,status:'connected'}:row))
 const services={clipboard:{writeText:text=>{window.events.push(['copy',text]);return ok(null)}},chat:{openLink:url=>{window.events.push(['openLink',url]);return ok(null)}},connectors:{
 save:async input=>{window.events.push(['save',input]);if(window.failSave)return{ok:false,error:{code:'TEST',message:'Could not save connector.'}};if(window.holdSave)await new Promise(resolve=>window.finishSave=resolve);const existing=connectors.find(row=>row.id===input.id),{token,clientSecret,...publicInput}=input;const row={...existing,...publicInput,id:input.id??'saved-'+input.catalogId,status:'disconnected',revision:1,hasToken:token===undefined?existing?.hasToken:!!token,hasClientSecret:clientSecret===undefined?existing?.hasClientSecret:!!clientSecret,tools:[]};const next=[...connectors.filter(value=>value.id!==row.id),row];setConnectors(next);return ok(next)},
 connect:async id=>{window.events.push(['connect',id]);if(window.failConnect)return{ok:false,error:{code:'TEST',message:'Could not connect fixture.'}};if(window.holdConnect)return await new Promise(resolve=>window.pendingConnect={id,resolve});setConnectors(old=>old.map(row=>row.id===id?{...row,status:'connected',tools:[{name:'search',description:'Search',inputSchema:{},enabled:false,readOnly:true}]}:row));return ok([])},
 disconnect:async id=>{window.events.push(['disconnect',id]);if(window.pendingConnect?.id===id){window.pendingConnect.resolve({ok:false,error:{code:'TEST',message:'Connector connection cancelled.'}});window.pendingConnect=null}setConnectors(old=>old.map(row=>row.id===id?{...row,status:'disconnected'}:row));return ok([])},
 remove:async id=>{window.events.push(['remove',id]);setConnectors(old=>old.filter(row=>row.id!==id));return ok([])},setTools:async()=>ok([])
 }}
 const host={services,notify:message=>window.events.push(['notify',message]),closing:false}
 return <ModuleHostProvider value={host}><main className="settings-page" style={{minHeight:'100vh',background:'var(--canvas)',color:'var(--text)'}}><ConnectorSettings chat={{connectors,connectorsLoading:false,connectorsError:'',connectorCatalog:catalog,connectorCatalogLoading:false,connectorCatalogError:'',refreshConnectorCatalog:()=>{}}} closing={false}/></main></ModuleHostProvider>
}
createRoot(document.getElementById('root')).render(<Fixture/>)
