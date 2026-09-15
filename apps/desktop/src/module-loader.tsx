import { Component, type ReactNode } from 'react'
import { unwrap, ModuleSurface, useHost, type ModuleDefinition, type ModuleRuntime } from '@zq/module-api'
import { loadWithRecovery } from './module-recovery'
export type LoadedModule=Omit<ModuleRuntime,'code'|'css'>&ModuleDefinition
function execute(code:string):Promise<ModuleDefinition>{
 return new Promise((resolve,reject)=>{
  const url=URL.createObjectURL(new Blob([code],{type:'text/javascript'})),script=document.createElement('script')
  const cleanup=()=>{clearTimeout(timeout);window.removeEventListener('error',failed);script.remove();URL.revokeObjectURL(url)}
  const failed=(event?:ErrorEvent)=>{if(event&&event.filename!==url)return;cleanup();reject(Error(event?.message||'Module code could not load'))}
  const timeout=setTimeout(()=>failed(),10000)
  window.__zqLatestModule=undefined
  window.addEventListener('error',failed)
  script.src=url
  script.onerror=()=>failed()
  script.onload=()=>{const value=window.__zqLatestModule;window.__zqLatestModule=undefined;cleanup();if(!value||typeof value.Root!=='function')reject(Error('Module does not export a Root component'));else resolve(value)}
  document.head.append(script)
 })
}
export async function loadModules():Promise<LoadedModule[]>{
 const records=await unwrap(window.zq.modules.runtime()),loaded:LoadedModule[]=[]
 for(const initial of records){
  let attempted=initial
  try{
   const {record,component}=await loadWithRecovery(initial,record=>{attempted=record;return execute(record.code)},record=>unwrap(window.zq.modules.recover(record.manifest.id,record.manifest.version)))
   const style=document.createElement('style');style.dataset.module=record.manifest.id;style.textContent=record.css
   document.head.insertBefore(style,document.head.querySelector('link[rel="stylesheet"]'))
   const {code,css,...metadata}=record
   loaded.push({...metadata,...component})
  }catch(error){
   const {code,css,...metadata}=attempted
   const message=error instanceof Error?error.message:String(error)
   // Keep the verified identity in navigation, without mounting any failed
   // module controller or installing its styles. Shell Settings stays usable.
   function UnavailableModule(){
    const host=useHost()
    return <ModuleSurface><div className="empty-state" role="alert"><h2>{metadata.manifest.title} could not open</h2><p>{message}</p><p>Install a compatible update or choose a rollback in Module Settings.</p><button type="button" onClick={()=>host.openSettings?host.openSettings('modules'):host.navigate('Settings')}>Open Module Settings</button></div></ModuleSurface>
   }
   loaded.push({...metadata,error:message,Root:UnavailableModule})
  }
 }
 return loaded
}
export class ModuleBoundary extends Component<{module:LoadedModule;active:boolean;children:ReactNode},{error:string;recovery:string}>{
 state={error:'',recovery:'Preparing recovery…'}
 static getDerivedStateFromError(error:Error){return {error:error.message}}
 componentDidCatch(){const current=this.props.module;void unwrap(window.zq.modules.recover(current.manifest.id,current.manifest.version)).then(next=>this.setState({recovery:next.manifest.version!==current.manifest.version||next.source!==current.source?'Close and reopen zQ to use the fallback version.':'No earlier working version is available. Install a compatible update from Settings → Modules.'})).catch(()=>this.setState({recovery:'Recovery could not be prepared. Your saved data has been kept.'}))}
 render(){if(this.state.error)return <ModuleSurface><div className="empty-state" role="alert"><h2>{this.props.module.manifest.title} could not open</h2><p>{this.state.error}</p><p>{this.state.recovery}</p></div></ModuleSurface>;return this.props.children}
}
declare global {interface Window {__zqLatestModule?:ModuleDefinition;__zqRuntime:unknown}}
