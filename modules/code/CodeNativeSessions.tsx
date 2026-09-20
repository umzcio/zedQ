import { useEffect, useRef, useState } from 'react';
import { useHost, type CodeConversation, type CodeSession, type CodeSnapshot, type CodeAgent, type CodeMode } from '@zq/module-api';
import { Button, Input, SelectField, Dialog, DialogContent, DialogTitle, DialogDescription } from '@zq/ui';
import { ArrowClockwise, ChatCircle, Plus, TerminalWindow } from '@phosphor-icons/react';
import { ItemMenu, MoreMenu, type Action } from './CodeManagement';
import { codeError } from './errors';
const labels = {claude:'Claude',codex:'Codex',kimi:'Kimi',terminal:'Terminal'};
type Row = Omit<CodeConversation, 'agent'> & {agent: CodeAgent | 'terminal'; saved?:CodeSession};
export function CodeNativeSessions({snapshot, startNew=false, onClose, onOpen}: {snapshot:CodeSnapshot; startNew?:boolean; onClose:()=>void; onOpen:(session:CodeSession)=>void}) {
  const host=useHost(),bridge=host.services.code;
  const [native,setNative]=useState<CodeConversation[]>([]),[query,setQuery]=useState(''),[agent,setAgent]=useState('all'),[hostId,setHostId]=useState('all');
  const [loading,setLoading]=useState(true),[busy,setBusy]=useState(''),[error,setError]=useState(''),[warnings,setWarnings]=useState<{source:string;code:string}[]>([]),[truncated,setTruncated]=useState(false);
  const [choice,setChoice]=useState<{row?:Row;agent:CodeAgent;profileId:string;mode:CodeMode}|null>(startNew ? {agent:'claude',profileId:snapshot.profiles.find(p=>p.functionName==='claude')?.id||'',mode:'chat'} : null);
  const live=useRef(true),request=useRef(0);
  async function refresh(){
    const generation=++request.current;setLoading(true);setError('');setWarnings([]);setTruncated(false);
    await Promise.allSettled((['claude','codex','kimi'] as const).map(async agent=>{
      try{const result=await bridge.invoke('listNativeSessions',{agent});if(!live.current||generation!==request.current)return;
        setNative(old=>[...old.filter(r=>r.agent!==agent),...result.sessions]);setWarnings(old=>[...old,...result.errors]);if(result.truncated)setTruncated(true);
      }catch(e){if(live.current&&generation===request.current)setWarnings(old=>[...old,{source:labels[agent],code:codeError(e)}])}
    }));
    if(live.current&&generation===request.current)setLoading(false);
  }
  useEffect(()=>{live.current=true;void refresh();return()=>{live.current=false}},[]);
  const saved=snapshot.sessions.filter(s=>!s.archivedAt),byId=new Map(saved.map(s=>[s.id,s]));
  const rows:Row[]=native.map(row=>({...row,saved:row.sessionId?byId.get(row.sessionId):undefined}));
  const included=new Set(rows.map(r=>r.sessionId));
  for(const s of saved)if(!included.has(s.id))rows.push({key:'saved:'+s.id,sessionId:s.id,saved:s,agent:s.adapter||'claude',nativeId:s.nativeId,title:s.title,cwd:s.cwd,updatedAt:s.updatedAt,hostId:s.hostId,modes:s.adapter==='terminal'?['terminal']:['chat','terminal'],profileIds:s.profileId?[s.profileId]:[]});
  rows.sort((a,b)=>b.updatedAt-a.updatedAt);
  const hostName=(id:string)=>snapshot.hosts.find(h=>h.id===id)?.name || (id==='local'?'This Mac':id);
  const filtered=rows.filter(r=>(agent==='all'||r.agent===agent)&&(hostId==='all'||r.hostId===hostId)&&`${r.saved?.title||r.title} ${r.cwd} ${labels[r.agent]} ${hostName(r.hostId)}`.toLowerCase().includes(query.toLowerCase()));
  const profiles=(a:CodeAgent)=>snapshot.profiles.filter(p=>p.hostId==='local'&&(p.adapter||'claude')===a);
  const defaultProfile=(row:Row)=>row.saved?.profileId||row.profileIds[0]||'';
  const copy=(text:string)=>void host.services.clipboard.writeText(text).then(ok=>{if(!ok)setError('Could not copy to the clipboard.')}).catch(e=>setError(codeError(e)));
  const resumeCommand=(row:Row)=>`${snapshot.profiles.find(p=>p.id===defaultProfile(row))?.functionName||row.agent} ${row.agent==='kimi'?'--session':row.agent==='codex'?'resume':'--resume'} '${row.nativeId}'`;
  async function open(row:Row,mode?:CodeMode,profileId=defaultProfile(row)){
    if(busy)return;setBusy(row.key);setError('');
    try{
      if(row.saved&&(row.hostId!=='local'||row.agent==='terminal'||(!mode&&profileId===row.saved.profileId))){onOpen(row.saved);return}
      const result=await bridge.invoke('openNativeSession',{agent:row.agent as CodeAgent,nativeId:row.nativeId,profileId,mode:mode||row.saved?.mode||'chat'});
      if(result.error)throw Error(result.error);onOpen(result)
    }catch(e){setError(codeError(e))}finally{setBusy('')}
  }
  const actions=(row:Row):Action[]=>[
    {label:'Open session',run:()=>void open(row),disabled:!!busy},
    ...(row.agent!=='terminal'&&row.hostId==='local'?[
      {label:'Open in Chat',run:()=>void open(row,'chat'),disabled:!!busy||!row.modes.includes('chat')},
      {label:'Open in Terminal',run:()=>void open(row,'terminal'),disabled:!!busy||!row.modes.includes('terminal')},
      ...(row.agent!=='kimi'?[{label:'Continue with profile…',run:()=>setChoice({row,agent:row.agent as CodeAgent,profileId:defaultProfile(row),mode:row.saved?.mode||'chat'}),disabled:!!busy}]:[]),
      {label:'Copy resume command',run:()=>copy(resumeCommand(row))},
    ]:[]),
    {label:'Copy workspace path',run:()=>copy(row.cwd)},
    ...(row.nativeId?[{label:'Copy session ID',run:()=>copy(row.nativeId)}]:[]),
  ];
  async function submitChoice(){if(!choice||busy)return;if(choice.row){await open(choice.row,choice.mode,choice.profileId);return}
    setBusy('new');setError('');try{const cwd=await bridge.invoke('pickDirectory',undefined);if(!cwd)return;const result=await bridge.invoke('openNativeSession',{agent:choice.agent,cwd,profileId:choice.profileId,mode:choice.mode});if(result.error)throw Error(result.error);onOpen(result)}catch(e){setError(codeError(e))}finally{setBusy('')}
  }
  return <Dialog open onOpenChange={value=>{if(!value&&!busy)onClose()}}><DialogContent className="code-dialog code-native-dialog">
    <DialogTitle>{choice?(choice.row?'Continue conversation':'New agent session'):'Sessions'}</DialogTitle>
    <DialogDescription>{choice?'Use the agent’s native configuration and history.':'Your agent conversations and saved terminals. Exit a conversation in another app before continuing it here.'}</DialogDescription>
    {choice?<div className="code-native-choice">
      {choice.row?<p>{choice.row.title}</p>:<label>Agent<SelectField label="Agent" value={choice.agent} onValueChange={value=>{const a=value as CodeAgent;setChoice({...choice,agent:a,profileId:profiles(a)[0]?.id||''})}} options={(['claude','codex','kimi'] as const).map(a=>({value:a,label:labels[a]}))}/></label>}
      {choice.agent!=='kimi'&&<label>Account profile<SelectField label="Account profile" value={choice.profileId} onValueChange={profileId=>setChoice({...choice,profileId})} options={profiles(choice.agent).map(p=>({value:p.id,label:p.name}))}/></label>}
      <label>Interface<SelectField label="Interface" value={choice.mode} onValueChange={mode=>setChoice({...choice,mode:mode as CodeMode})} options={[{value:'chat',label:'Chat'},{value:'terminal',label:'Terminal'}]}/></label>
      {error&&<p role="alert" className="code-form-error">{error}</p>}
      <div className="code-actions"><Button variant="ghost" disabled={!!busy} onClick={()=>{setChoice(null);setError('')}}>Back</Button><Button disabled={!!busy||(choice.agent!=='kimi'&&!choice.profileId)} onClick={()=>void submitChoice()}>{busy?'Opening…':choice.row?'Continue':'Choose folder and start'}</Button></div>
    </div>:<>
      <div className="code-native-toolbar"><Input aria-label="Find session" placeholder="Find a conversation, folder, or host…" value={query} onChange={e=>setQuery(e.target.value)}/><Button variant="ghost" size="sm" disabled={loading||!!busy} onClick={()=>void refresh()} aria-label="Refresh sessions"><ArrowClockwise size={16}/></Button><Button size="sm" disabled={!!busy} onClick={()=>{const a=agent==='codex'||agent==='kimi'?agent:'claude';setChoice({agent:a,profileId:profiles(a)[0]?.id||'',mode:'chat'})}}><Plus size={15}/>New</Button></div>
      <div className="code-native-filters"><SelectField label="Filter by agent" value={agent} onValueChange={setAgent} options={[{value:'all',label:'All agents'},...Object.entries(labels).map(([value,label])=>({value,label}))]}/><SelectField label="Filter by host" value={hostId} onValueChange={setHostId} options={[{value:'all',label:'All hosts'},...snapshot.hosts.map(h=>({value:h.id,label:hostName(h.id)}))]}/></div>
      {error&&<p role="alert" className="code-form-error">{error}</p>}
      {!!warnings.length&&<details className="code-native-warning"><summary>Some histories couldn’t be loaded ({warnings.length})</summary>{warnings.map(w=><p key={w.source}>{w.source}: {codeError(w.code)}</p>)}</details>}
      <div className="code-native-list" aria-busy={loading||!!busy}>
        {loading&&<p role="status" className="code-muted">Loading native history…</p>}
        {filtered.map(row=><ItemMenu key={row.key} actions={actions(row)}><div className="code-native-row"><button disabled={!!busy} onClick={()=>void open(row)}>{row.agent==='terminal'?<TerminalWindow size={18}/>:<ChatCircle size={18}/>}<span><strong>{busy===row.key?'Opening…':row.saved?.title||row.title}</strong><small>{labels[row.agent]} · {hostName(row.hostId)}{row.saved?.profileId?' · '+(snapshot.profiles.find(p=>p.id===row.saved?.profileId)?.name||''):''}</small><small>{row.cwd}</small></span><time>{new Date(row.updatedAt).toLocaleDateString()}</time></button><MoreMenu label={`Actions for ${row.title}`} actions={actions(row)}/></div></ItemMenu>)}
        {!loading&&!filtered.length&&<p className="code-muted">{query?'No matching conversations.':'No sessions here yet. Choose New to start one.'}</p>}
      </div>
      {truncated&&<p className="code-muted">Showing the most recent 200 conversations from each native source.</p>}
      <div className="code-actions"><Button variant="ghost" disabled={!!busy} onClick={onClose}>Close</Button></div>
    </>}
  </DialogContent></Dialog>;
}
