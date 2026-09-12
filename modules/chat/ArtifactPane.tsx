import {SourcesPane} from './ChatSources'
import {useEffect,useRef,useState,type ReactNode} from 'react'
import {useHost,unwrap,type Artifact,type ArtifactDocumentFile} from '@zq/module-api'
import {ArtifactDocumentView,Button,Input,SelectField,Dialog,DialogContent,DialogTitle,DialogDescription,ContextMenu,ContextMenuTrigger,ContextMenuContent,ContextMenuItem,DropdownMenu,DropdownMenuTrigger,DropdownMenuContent,DropdownMenuItem} from '@zq/ui'
import {ArrowsOutSimple,ArrowsInSimple,DownloadSimple,DotsThree,File,X} from '@phosphor-icons/react'
import type {ChatController} from './useChat'
import ArtifactEditor from './ArtifactEditor'
import ArtifactAttachDialog from './ArtifactAttachDialog'
import './artifact-pane.css'

export function ArtifactWorkspace({chat,children}:{chat:ChatController;children:ReactNode}){
 const element=useRef<HTMLDivElement>(null),[width,setWidth]=useState(1200),[ratio,setRatio]=useState(.52),[expanded,setExpanded]=useState(false),[dragging,setDragging]=useState(false)
 const open=!!chat.artifactTarget||!!chat.sourceTarget,full=expanded||width<800
 const minimum=Math.max(.3,340/Math.max(800,width)),maximum=Math.min(.7,1-340/Math.max(800,width)),clamp=(value:number)=>Math.max(minimum,Math.min(maximum,value)),effectiveRatio=clamp(ratio)
 useEffect(()=>{if(!element.current)return;const observer=new ResizeObserver(entries=>setWidth(entries[0].contentRect.width));observer.observe(element.current);return()=>observer.disconnect()},[])
 useEffect(()=>{setExpanded(false)},[open,!!chat.sourceTarget])
 function resize(clientX:number){const box=element.current?.getBoundingClientRect();if(box)setRatio(clamp((box.right-clientX)/box.width))}
 const actualWidth=width*effectiveRatio
 return <div ref={element} className={`artifact-workspace ${open?'has-artifact':''} ${open&&full?'artifact-expanded':''} ${dragging?'artifact-resizing':''}`} style={{'--artifact-pane-width':`${actualWidth}px`} as React.CSSProperties}>
  <div className="artifact-primary">{children}</div>
  {open&&<><div className="artifact-resizer" role="separator" aria-label={chat.sourceTarget?"Resize sources pane":"Resize artifact pane"} aria-orientation="vertical" aria-valuemin={Math.ceil(minimum*100)} aria-valuemax={Math.floor(maximum*100)} aria-valuenow={Math.round(effectiveRatio*100)} tabIndex={full?-1:0} onDoubleClick={()=>setRatio(.52)} onKeyDown={e=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(e.key)){e.preventDefault();setRatio(e.key==='Home'?minimum:e.key==='End'?maximum:clamp(effectiveRatio+(e.key==='ArrowLeft'?.025:-.025)))}}} onPointerDown={e=>{if(e.button!==0)return;e.preventDefault();e.currentTarget.setPointerCapture(e.pointerId);setDragging(true)}} onPointerMove={e=>{if(e.currentTarget.hasPointerCapture(e.pointerId))resize(e.clientX)}} onPointerUp={e=>{if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId);setDragging(false)}} onLostPointerCapture={()=>setDragging(false)}/>{chat.sourceMessage?<SourcesPane chat={chat} message={chat.sourceMessage}/>:<ArtifactPane chat={chat} expanded={full} canSplit={width>=800} toggleExpanded={()=>setExpanded(old=>!old)}/>}</>}
 </div>
}

function ArtifactPane({chat,expanded,canSplit,toggleExpanded}:{chat:ChatController;expanded:boolean;canSplit:boolean;toggleExpanded:()=>void}){
 const {services,closing,commands}=useHost(),target=chat.artifactTarget!,key=JSON.stringify(target)
 const [items,setItems]=useState<Artifact[]>([]),[loaded,setLoaded]=useState<{key:string;file?:ArtifactDocumentFile;error?:string}|null>(null),[zoom,setZoom]=useState<number|'fit'>('fit'),[error,setError]=useState(''),[busy,setBusy]=useState(false),lock=useRef(false)
 const [rename,setRename]=useState(false),[title,setTitle]=useState(''),[remove,setRemove]=useState(false),[edit,setEdit]=useState<{existing:Artifact;content:string}|null>(null),[attach,setAttach]=useState<'note'|'task'|null>(null)
 const currentKey=useRef(key);currentKey.current=key
 useEffect(()=>()=>{currentKey.current=''},[])
 const artifact=items.find(a=>a.id===target.artifactId),version=artifact?.versions.find(v=>v.id===target.versionId)
 useEffect(()=>{let live=true;const apply=(a:Artifact[])=>{if(live)setItems(a)};const stop=services.artifacts.subscribe(apply);unwrap(services.artifacts.list()).then(apply).catch(e=>{if(live)setError(e.message)});return()=>{live=false;stop()}},[])
 useEffect(()=>{let live=true;setLoaded(null);setError('');setZoom('fit');setRename(false);setRemove(false);setEdit(null);setAttach(null);unwrap(services.artifacts.document(target)).then(file=>{if(live)setLoaded({key,file})}).catch(e=>{if(live)setLoaded({key,error:e.message})});return()=>{live=false}},[key])
 function close(){if(document.querySelector('[role="dialog"],[role="menu"],[role="listbox"]'))return;chat.closeArtifact()}
 useEffect(()=>{function escape(e:KeyboardEvent){if(e.key==='Escape'&&!e.defaultPrevented&&!document.querySelector('[role="dialog"],[role="menu"],[role="listbox"]')){e.preventDefault();chat.closeArtifact()}}document.addEventListener('keydown',escape);return()=>document.removeEventListener('keydown',escape)},[chat.closeArtifact])
 async function run(fn:()=>Promise<void>){if(lock.current||closing)return;lock.current=true;setBusy(true);setError('');try{await fn()}catch(e){setError((e as Error).message)}finally{lock.current=false;setBusy(false)}}
 const actions=artifact&&version?[
  {label:'Rename…',action:()=>{setTitle(artifact.name);setRename(true)}},
  {label:'Download…',action:()=>void run(async()=>{await unwrap(services.artifacts.save(target))})},
  {label:'Revise in chat…',disabled:!!artifact.deletedAt||!['pdf','docx','xlsx','pptx'].includes(artifact.format),action:()=>void run(()=>chat.reviseArtifact(target))},
  {label:'Create new version…',disabled:!!artifact.deletedAt||!['pdf','docx','xlsx','pptx'].includes(artifact.format),action:()=>void run(async()=>{const saved=await unwrap(services.artifacts.version(target));const content=saved.content??(await unwrap(services.artifacts.preview(target))).text??'';if(currentKey.current===key)setEdit({existing:artifact,content})})},
  {label:'Attach to Notes…',action:()=>setAttach('note')},
  {label:'Attach to Tasks…',action:()=>setAttach('task')},
  {label:'Open source chat',disabled:!version.source?.conversationId,action:()=>commands.run('chat.open',{conversationId:version.source!.conversationId!,messageId:version.source!.messageId,versionId:version.source!.versionId})},
  {label:artifact.deletedAt?'Restore artifact':'Delete…',action:()=>artifact.deletedAt?void run(async()=>{await unwrap(services.artifacts.update({id:artifact.id,deleted:false}))}):setRemove(true)},
 ]:[]
 const filename=artifact?.name??loaded?.file?.name??'Artifact',format=artifact?.format??loaded?.file?.name.split('.').at(-1)??''
 return <aside className="artifact-pane" aria-label="Artifact preview">
  <ContextMenu><ContextMenuTrigger asChild><header className="artifact-pane-header"><File size={17}/><div className="artifact-pane-title"><strong title={filename}>{filename}</strong><span>{format.toUpperCase()}{artifact?.deletedAt?' · Deleted':''}</span></div><Button variant="ghost" size="icon-sm" aria-label="Download artifact" disabled={busy||closing||!version} onClick={()=>void run(async()=>{await unwrap(services.artifacts.save(target))})}><DownloadSimple size={17}/></Button><DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="icon-sm" aria-label="Artifact actions" disabled={busy||closing||!version}><DotsThree size={18}/></Button></DropdownMenuTrigger><DropdownMenuContent align="end">{actions.map(a=><DropdownMenuItem key={a.label} disabled={busy||closing||a.disabled} onSelect={a.action}>{a.label}</DropdownMenuItem>)}</DropdownMenuContent></DropdownMenu>{canSplit&&<Button variant="ghost" size="icon-sm" aria-label={expanded?'Restore split view':'Expand artifact'} onClick={toggleExpanded}>{expanded?<ArrowsInSimple size={17}/>:<ArrowsOutSimple size={17}/>}</Button>}<Button variant="ghost" size="icon-sm" data-pane-close aria-label="Close artifact" onClick={()=>chat.closeArtifact()}><X size={17}/></Button></header></ContextMenuTrigger><ContextMenuContent>{actions.map(a=><ContextMenuItem key={a.label} disabled={busy||closing||a.disabled} onSelect={a.action}>{a.label}</ContextMenuItem>)}</ContextMenuContent></ContextMenu>
  <div className="artifact-pane-toolbar">{artifact&&version?<SelectField label="Artifact version" value={version.id} onValueChange={id=>chat.openArtifact({artifactId:artifact.id,versionId:id},false,{focus:false})} options={artifact.versions.slice().reverse().map(v=>({value:v.id,label:`Version ${v.number}`}))}/>:<span/>}<SelectField label="Artifact zoom" value={String(zoom)} onValueChange={value=>setZoom(value==='fit'?'fit':Number(value))} options={[{value:'fit',label:'Fit width'},...['50','75','100','125','150','200'].map(value=>({value,label:`${value}%`}))]}/></div>
  {error&&<p className="artifact-pane-error" role="alert">{error}</p>}
  <div className="artifact-pane-document">{loaded?.key!==key?<div className="artifact-pane-status" role="status">Preparing document…</div>:loaded.error?<div className="artifact-pane-status" role="alert"><p>{loaded.error}</p><Button variant="ghost" onClick={()=>void run(async()=>{await unwrap(services.artifacts.save(target))})}>Download file</Button></div>:loaded.file?<ArtifactDocumentView file={loaded.file} zoom={zoom} onEscape={close}/>:null}</div>
  <Dialog open={rename} onOpenChange={setRename}><DialogContent><DialogTitle>Rename artifact</DialogTitle><DialogDescription>Changes its library name. Saved files keep their original names.</DialogDescription><form onSubmit={e=>{e.preventDefault();if(artifact)void run(async()=>{await unwrap(services.artifacts.update({id:artifact.id,name:title}));setRename(false)})}}><Input aria-label="Artifact name" value={title} onChange={e=>setTitle(e.target.value)}/>{error&&<p role="alert">{error}</p>}<div className="dialog-actions"><Button type="button" variant="ghost" onClick={()=>setRename(false)}>Cancel</Button><Button type="submit" disabled={busy||!title.trim()}>Rename</Button></div></form></DialogContent></Dialog>
  <Dialog open={remove} onOpenChange={setRemove}><DialogContent><DialogTitle>Delete {filename}?</DialogTitle><DialogDescription>The artifact moves to Deleted. Existing attachments keep their saved versions.</DialogDescription>{error&&<p role="alert">{error}</p>}<div className="dialog-actions"><Button variant="ghost" onClick={()=>setRemove(false)}>Cancel</Button><Button disabled={busy} onClick={()=>artifact&&void run(async()=>{await unwrap(services.artifacts.update({id:artifact.id,deleted:true}));setRemove(false)})}>Delete artifact</Button></div></DialogContent></Dialog>
  {edit&&<ArtifactEditor {...edit} library={items} onClose={()=>setEdit(null)} onCreated={a=>{setEdit(null);chat.openArtifact({artifactId:a.id,versionId:a.versions.at(-1)!.id})}}/>}
  {attach&&artifact&&version&&<ArtifactAttachDialog artifact={artifact} version={version} kind={attach} onClose={()=>setAttach(null)}/>}
 </aside>
}
