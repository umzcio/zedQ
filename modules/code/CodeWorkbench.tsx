import {useEffect,useRef,useState,type Dispatch,type SetStateAction} from 'react';
import {useHost,type CodeSession,type CodeSnapshot} from '@zq/module-api';
import {Button,TooltipButton} from '@zq/ui';
import {X,Plus,Columns,Rows,Square} from '@phosphor-icons/react';
import {ItemMenu,MoreMenu,type Action} from './CodeManagement';
import {CodeTerminal} from './CodeTerminal';
import {CodeChat} from './CodeChat';
import {hostLabel} from './CodeSSH';
import {stateLabel} from './session-model';
import {closeTab,moveTab,mergePanes,splitLayout,type WorkbenchLayout} from './workbench-layout';
export function WorkbenchControls({layout,setLayout}:{layout:WorkbenchLayout;setLayout:Dispatch<SetStateAction<WorkbenchLayout>>}) {
 return <div className="code-split-controls"><TooltipButton aria-label="Split side by side" onClick={()=>setLayout(s=>splitLayout(s,'columns'))}><Columns size={17}/></TooltipButton><TooltipButton aria-label="Split top and bottom" onClick={()=>setLayout(s=>splitLayout(s,'rows'))}><Rows size={17}/></TooltipButton>{layout.panes.length===2&&<TooltipButton aria-label="Merge panes" onClick={()=>setLayout(mergePanes)}><Square size={17}/></TooltipButton>}</div>;
}
export function useWorkbenchOwnership(layout:WorkbenchLayout,snapshot:CodeSnapshot|null,onError:(message:string)=>void) {
 const bridge=useHost().services.code;
 // Hold ownership for all open tabs. Moving/focusing a pane must never release
 // another pane's live PTY. Terminal views manage their own attachment generation.
 const claimed=useRef(new Set<string>());
 useEffect(()=>{
  if(!snapshot)return;
  const ids=new Set(layout.panes.flatMap(p=>p.tabs).filter(id=>{const s=snapshot.sessions.find(s=>s.id===id);return s&&s.state!=='disconnected';}));
  for(const id of ids)if(!claimed.current.has(id)){claimed.current.add(id);void bridge.invoke('claimSession',{id}).catch(e=>{claimed.current.delete(id);onError(e.message);});}
  for(const id of claimed.current)if(!ids.has(id)){claimed.current.delete(id);void bridge.invoke('releaseSession',{id}).catch(()=>{});}
 },[bridge,layout.panes,snapshot?.seq]);
 useEffect(()=>()=>{for(const id of claimed.current)void bridge.invoke('releaseSession',{id}).catch(()=>{});claimed.current.clear();},[bridge]);
 }
export function CodeWorkbench({layout,setLayout,snapshot,onOpen,actions,onError}:{layout:WorkbenchLayout;setLayout:Dispatch<SetStateAction<WorkbenchLayout>>;snapshot:CodeSnapshot;onOpen:(s:CodeSession)=>void;actions:(s:CodeSession)=>Action[];onError:(message:string)=>void}) {
 const container=useRef<HTMLDivElement>(null),bridge=useHost().services.code;
 const [creating,setCreating]=useState<number|null>(null);
 async function createTerminal(index:number,source:CodeSession) {
  setCreating(index);
  try {
   const session=await bridge.invoke('createTerminal',{hostId:source.hostId,...(source.projectId?{projectId:source.projectId}:{}),name:`shell-${Date.now().toString(36)}`});
   setLayout(l=>{if(l.panes.length===1)return {...l,shown:true,focus:0,panes:[{tabs:[...l.panes[0].tabs,session.id],active:session.id}]};return moveTab(l,session.id,index);});
   onOpen(session);
  } catch(e){onError(e instanceof Error?e.message:String(e));}
  finally {setCreating(null);}
 }

 function focus(index:number){setLayout(s=>s.focus===index||!s.panes[index].active?s:{...s,focus:index});}
 const focused=layout.panes[layout.focus].active;
 return <div ref={container} className={`code-workbench code-workbench-${layout.axis}`} style={{gridTemplateColumns:layout.panes.length===2&&layout.axis==='columns'?`minmax(0,${layout.ratio}fr) 5px minmax(0,${100-layout.ratio}fr)`:undefined,gridTemplateRows:layout.panes.length===2&&layout.axis==='rows'?`minmax(0,${layout.ratio}fr) 5px minmax(0,${100-layout.ratio}fr)`:undefined}}>
 {layout.panes.flatMap((pane,index)=>{
  const session=snapshot.sessions.find(s=>s.id===pane.active),source=snapshot.sessions.find(s=>s.id===layout.panes[index===0?1:0]?.active),visible=pane.tabs.map(id=>snapshot.sessions.find(s=>s.id===id)).filter((s):s is CodeSession=>!!s);
  const body=<section key={`pane-${index}`} className={`code-pane ${layout.focus===index?'focused':''}`} aria-label={`Session pane ${index+1}`} onPointerDownCapture={()=>focus(index)} onFocusCapture={()=>focus(index)}>
   <div className="code-tabs" role="tablist" aria-label={`Sessions in pane ${index+1}`}>
    {visible.map(s=><ItemMenu key={s.id} actions={[...actions(s),{label:'Close other tabs',run:()=>setLayout(l=>({...l,panes:l.panes.map((p,i)=>i===index?{tabs:[s.id],active:s.id}:p)}))}]}><div className={`code-tab ${pane.active===s.id?'active':''}`}>
      <button role="tab" aria-selected={pane.active===s.id} tabIndex={pane.active===s.id?0:-1} title={`${s.title} · ${hostLabel(snapshot.hosts.find(h=>h.id===s.hostId))}`} onClick={()=>onOpen(s)} onKeyDown={e=>{if(['ArrowRight','ArrowLeft','Home','End'].includes(e.key)){e.preventDefault();const at=visible.findIndex(v=>v.id===s.id),next=e.key==='Home'?0:e.key==='End'?visible.length-1:(at+(e.key==='ArrowRight'?1:-1)+visible.length)%visible.length;onOpen(visible[next]);const tabs=e.currentTarget.closest('[role=tablist]')?.querySelectorAll<HTMLButtonElement>('[role=tab]');tabs?.[next]?.focus();}}}>
       <span className={`code-state-dot code-state-${s.state}`} aria-label={stateLabel(s)}/><span>{s.title}</span><small>{snapshot.hosts.find(h=>h.id===s.hostId)?.sshAlias||'This Mac'}</small>
      </button><TooltipButton aria-label={`Close tab ${s.title}`} tooltip="Close tab (⌘W) — session keeps running" onClick={()=>setLayout(l=>closeTab(l,s.id))}><X size={12}/></TooltipButton>
    </div></ItemMenu>)}
    {session&&<TooltipButton aria-label={`New terminal tab in pane ${index+1}`} tooltip={`New shell on ${hostLabel(snapshot.hosts.find(h=>h.id===session.hostId))}${session.projectId?'':' in the home folder'}`} disabled={creating!==null||session.state==='disconnected'} onClick={()=>void createTerminal(index,session)}><Plus size={14}/></TooltipButton>}
    {layout.panes.length===2&&<MoreMenu label={`Pane ${index+1} actions`} actions={[{label:'Merge panes',run:()=>setLayout(mergePanes)},{label:'Close pane',run:()=>setLayout(l=>({...l,focus:0,panes:[l.panes[index===0?1:0]],shown:!!l.panes[index===0?1:0].active}))}]}/>}
   </div>
   <div className="code-pane-content" role="tabpanel" aria-label={session?.title||'Choose a session'}>
   {session?.state==='disconnected' ? <div className="code-pane-empty"><p>{hostLabel(snapshot.hosts.find(h=>h.id===session.hostId))} · Disconnected</p><Button variant="outline" onClick={()=>onOpen(session)}>Reconnect session</Button></div> : session ? session.mode==='terminal'?<CodeTerminal key={`${session.id}-${session.revision}`} session={session} focused={focused===session.id}/>:<CodeChat key={session.id} session={session} onError={onError}/>:<div className="code-pane-empty"><p>Open a session in this pane</p>{source&&<Button aria-label={`New terminal in pane ${index+1}`} variant="outline" disabled={creating!==null||source.state==='disconnected'} onClick={()=>void createTerminal(index,source)}>{creating===index?'Starting…':'New terminal'}<small>{hostLabel(snapshot.hosts.find(h=>h.id===source.hostId))}</small></Button>}{snapshot.sessions.filter(s=>!s.archivedAt&&s.id!==layout.panes[index===0?1:0]?.active).map(s=><ItemMenu key={s.id} actions={actions(s)}><Button variant="ghost" onClick={()=>{setLayout(l=>moveTab(l,s.id,index));onOpen(s);}}>{s.title}<small>{hostLabel(snapshot.hosts.find(h=>h.id===s.hostId))}</small></Button></ItemMenu>)}{!snapshot.sessions.length&&<p>Start a session from a project or SSH host.</p>}</div>}
   </div>
  </section>;
  if(!index)return [body];
  return [<div key="divider" className="code-pane-divider" role="separator" tabIndex={0} aria-label="Resize session panes" aria-orientation={layout.axis==='columns'?'vertical':'horizontal'} aria-valuemin={20} aria-valuemax={80} aria-valuenow={Math.round(layout.ratio)} onDoubleClick={()=>setLayout(s=>({...s,ratio:50}))} onKeyDown={e=>{if(['ArrowLeft','ArrowUp','ArrowRight','ArrowDown','Home','End'].includes(e.key)){e.preventDefault();setLayout(s=>({...s,ratio:e.key==='Home'?20:e.key==='End'?80:Math.max(20,Math.min(80,s.ratio+(['ArrowLeft','ArrowUp'].includes(e.key)?-5:5)))}));}}} onPointerDown={e=>{e.currentTarget.setPointerCapture(e.pointerId);e.preventDefault();}} onPointerMove={e=>{if(!e.currentTarget.hasPointerCapture(e.pointerId)||!container.current)return;const r=container.current.getBoundingClientRect(),ratio=layout.axis==='columns'?(e.clientX-r.left)/r.width*100:(e.clientY-r.top)/r.height*100;setLayout(s=>({...s,ratio:Math.max(20,Math.min(80,ratio))}));}} onPointerUp={e=>e.currentTarget.releasePointerCapture(e.pointerId)}/>,body];
 })}
 </div>;
}
