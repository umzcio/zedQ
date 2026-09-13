import { createContext, useContext, useCallback, useLayoutEffect, useRef, type Dispatch, type SetStateAction, type ReactNode } from 'react'
import { IconContext } from '@phosphor-icons/react'
import { createPortal } from 'react-dom'
import type { DesktopBridge, WorkspaceState, FileDocument } from './desktop'
import type { Note, Task, Status } from './data'
import type { ModuleManifest, View } from './types'
export type Commands = {
 'artifacts.open':{artifactId?:string;versionId?:string};
 'notes.attachArtifact':{id:string;artifact:import('./artifact-types').ArtifactReference}; 'tasks.attachArtifact':{id:string;artifact:import('./artifact-types').ArtifactReference};
 'chat.open':{conversationId:string;messageId?:string;versionId?:string}; 'notes.append':{id:string;body:string}; 'notes.open':string; 'notes.new':string|undefined; 'notes.rename':string; 'notes.pin':string; 'notes.split':string;
 'files.open':undefined; 'files.save':'save'|'saveAs';
 'tasks.new':Partial<Task>|undefined; 'tasks.edit':Task; 'tasks.move':{id:string;status:Status}; 'tasks.show':{project:string;scope:string};
}
export type CommandBus = {run:<K extends keyof Commands>(name:K,payload:Commands[K])=>boolean;register:<K extends keyof Commands>(name:K,handler:(payload:Commands[K])=>void)=>()=>void}
export type SettingsSection='appearance'|'connections'|'skills'|'connectors'|'voice'|'modules'
export type Host = {
 manifest:ModuleManifest;
 workspace:WorkspaceState;setWorkspace:Dispatch<SetStateAction<WorkspaceState>>;
 registerFlush:(id:string,flush:()=>Promise<void>)=>()=>void;
 closing:boolean;saveStatus:string;initialFiles:FileDocument[];
 onFilesChange:(files:FileDocument[])=>void;onFileFlush:(flush:()=>Promise<void>)=>void;flushWorkspace:()=>Promise<void>;
 services:Pick<DesktopBridge,'chat'|'connectors'|'attachments'|'files'|'voice'|'artifacts'|'clipboard'>;
 openSettings?:(section:SettingsSection)=>void;
 commands:CommandBus;navigate:(view:View)=>void;notify:(message:string)=>void;
 focusMode:boolean;setFocusMode:Dispatch<SetStateAction<boolean>>;
 targets:{view:HTMLElement|null;sidebar:HTMLElement|null;settings:HTMLElement|null;skillsSettings?:HTMLElement|null;connectorsSettings?:HTMLElement|null};
}
const HostContext=createContext<Host|null>(null)
export const ModuleHostProvider=HostContext.Provider
export function useHost(){const host=useContext(HostContext);if(!host)throw Error('Module must be mounted by zQ');return host}
export function useCommand<K extends keyof Commands>(name:K,handler:(payload:Commands[K])=>void){
 const host=useHost(),latest=useRef(handler);useLayoutEffect(()=>{latest.current=handler})
 useLayoutEffect(()=>host.commands.register(name,payload=>{if(!host.closing)latest.current(payload)}),[host.commands,name,host.closing])
}
export function useWorkspaceField<K extends keyof WorkspaceState>(key:K):[WorkspaceState[K],Dispatch<SetStateAction<WorkspaceState[K]>>]{
 const {workspace,setWorkspace,manifest}=useHost()
 const writable=manifest.capabilities.includes('workspace.write')
 const set=useCallback<Dispatch<SetStateAction<WorkspaceState[K]>>>(value=>{
  if(!writable)throw Error('Module cannot write workspace data')
  setWorkspace(old=>{const next=typeof value==='function'?(value as (v:WorkspaceState[K])=>WorkspaceState[K])(old[key]):value;return Object.is(old[key],next)?old:{...old,[key]:next}})
 },[setWorkspace,key,writable])
 return [workspace[key],set]
}
export function ModuleSurface({slot='view',children}:{slot?:'view'|'sidebar'|'settings'|'skillsSettings'|'connectorsSettings';children:ReactNode}){
 const {targets,workspace,manifest}=useHost();const visible=(slot==='settings'||slot==='skillsSettings'||slot==='connectorsSettings')?workspace.layout.view==='Settings':workspace.layout.view===manifest.view
 return visible&&targets[slot]?createPortal(slot==='sidebar'?<IconContext.Provider value={{weight:'light'}}>{children}</IconContext.Provider>:children,targets[slot]!):null
}
export function useLayoutField<K extends keyof WorkspaceState['layout']>(key:K){
 const [layout,setLayout]=useWorkspaceField('layout')
 const set=useCallback<Dispatch<SetStateAction<WorkspaceState['layout'][K]>>>(value=>setLayout(old=>({...old,[key]:typeof value==='function'?(value as (v:WorkspaceState['layout'][K])=>WorkspaceState['layout'][K])(old[key]):value})),[key,setLayout])
 return [layout[key],set] as const
}
