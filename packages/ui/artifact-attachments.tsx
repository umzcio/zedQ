import {useEffect,useRef,useState} from 'react'
import {useHost,unwrap,type Artifact,type ArtifactReference} from '@zq/module-api'
import {File, DotsThree} from '@phosphor-icons/react'
import {ContextMenu,ContextMenuTrigger,ContextMenuContent,ContextMenuItem} from './components/context-menu'
import {DropdownMenu,DropdownMenuTrigger,DropdownMenuContent,DropdownMenuItem} from './components/dropdown-menu'
export function ArtifactAttachments({items,onChange}:{items:ArtifactReference[];onChange:(items:ArtifactReference[])=>void}){
 const focusTarget=useRef<HTMLElement|null>(null)
 function restoreFocus(e:Event){e.preventDefault();requestAnimationFrame(()=>{if(!document.querySelector('[data-slot=dialog-content][data-state=open]')&&focusTarget.current?.isConnected)focusTarget.current.focus()})}
 const {services,closing,notify,commands}=useHost(),[library,setLibrary]=useState<Artifact[]>([]),[busy,setBusy]=useState(false)
 useEffect(()=>{if(!items.length)return;let live=true;const apply=(v:Artifact[])=>{if(live)setLibrary(v)};unwrap(services.artifacts.list()).then(apply).catch(e=>notify(e.message));const stop=services.artifacts.subscribe(apply);return()=>{live=false;stop()}},[items.length])
 async function run(action:()=>Promise<void>){if(busy||closing)return;setBusy(true);try{await action()}catch(e){notify((e as Error).message)}finally{setBusy(false)}}
 function actions(ref:ArtifactReference){const artifact=library.find(a=>a.id===ref.artifactId),latest=artifact?.versions.at(-1);return[
 {label:'Open attachment',disabled:false,action:()=>commands.run('artifacts.open',{artifactId:ref.artifactId,versionId:ref.versionId})},
 {label:'Download…',disabled:false,action:()=>void run(async()=>{await unwrap(services.artifacts.save(ref))})},
 {label:'Update to latest version',disabled:!latest||latest.id===ref.versionId,action:()=>{if(latest){const next=items.map(a=>a===ref?{artifactId:ref.artifactId,versionId:latest.id,name:artifact!.name}:a);onChange(next.filter((a,index)=>next.findIndex(b=>b.artifactId===a.artifactId&&b.versionId===a.versionId)===index))}}},
 {label:'Detach artifact',disabled:false,action:()=>onChange(items.filter(a=>a!==ref))},
 ]}
 return <>{!!items.length&&<div className="artifact-attachments" aria-label="Attached artifacts">{items.map(ref=>{const a=library.find(a=>a.id===ref.artifactId),v=a?.versions.find(v=>v.id===ref.versionId);return <ContextMenu key={ref.artifactId+ref.versionId}><ContextMenuTrigger asChild><div className="artifact-attachment-row" onFocusCapture={e=>{if(e.target instanceof HTMLButtonElement)focusTarget.current=e.target}} onContextMenu={e=>{focusTarget.current=e.currentTarget.querySelector('button')}}><button type="button" disabled={busy||closing} onClick={actions(ref)[0].action}><File size={17}/><span>{ref.name}<small>{v?`Version ${v.number}`:'Saved version'}{a?.versions.at(-1)?.id!==ref.versionId&&a?' · Update available':''}</small></span></button><DropdownMenu><DropdownMenuTrigger asChild><button type="button" aria-label={`Actions for attached ${ref.name}`} disabled={busy||closing}><DotsThree size={18}/></button></DropdownMenuTrigger><DropdownMenuContent onCloseAutoFocus={restoreFocus}>{actions(ref).map(action=><DropdownMenuItem key={action.label} disabled={busy||closing||action.disabled} onSelect={action.action}>{action.label}</DropdownMenuItem>)}</DropdownMenuContent></DropdownMenu></div></ContextMenuTrigger><ContextMenuContent onCloseAutoFocus={restoreFocus}>{actions(ref).map(action=><ContextMenuItem key={action.label} disabled={busy||closing||action.disabled} onSelect={action.action}>{action.label}</ContextMenuItem>)}</ContextMenuContent></ContextMenu>})}</div>}
 </>
}
