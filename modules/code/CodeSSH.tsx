import { useEffect, useRef, useState } from 'react';
import { useHost, type CodeSnapshot, type CodeHost, type CodeSession, type CodeProject, type CodeExternalTerminal } from '@zq/module-api';
import { Button, Input, SelectField, Dialog, DialogContent, DialogTitle, DialogDescription } from '@zq/ui';
import { Desktop, Plus, TerminalWindow, FolderSimple } from '@phosphor-icons/react';
import { ItemMenu, MoreMenu, type Action } from './CodeManagement';
import { codeError } from './errors';
export const hostLabel = (host?: CodeHost) => host?.kind === 'ssh' ? `${host.sshAlias} · ${host.runAs === 'root' ? 'root' : 'SSH login user'}` : 'This Mac';

export function CodeSSH({ snapshot, onChanged, onSession, onProject, onAddProject, sessionActions, projectActions }: {
  snapshot: CodeSnapshot; onChanged: () => Promise<unknown>; onSession: (s: CodeSession) => void;
  onProject: (p: CodeProject) => void; onAddProject: (hostId: string) => void;
  sessionActions: (s: CodeSession) => Action[]; projectActions: (p: CodeProject) => Action[];
}) {
  const bridge = useHost().services.code;
  const [aliases, setAliases] = useState<string[]>([]), [selected, setSelected] = useState(''), [query, setQuery] = useState('');
  const [picker, setPicker] = useState(false), [draft, setDraft] = useState<string[]>([]), [search, setSearch] = useState('');
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<CodeExternalTerminal[]>([]), [newTerminal, setNewTerminal] = useState(false), [name, setName] = useState('');
  const [preferences, setPreferences] = useState<Record<string, 'login' | 'root'>>(() => {
    try { const parsed = JSON.parse(localStorage.getItem('zq.code.ssh-users') || '{}'); return Object.fromEntries(Object.entries(parsed).filter(([,v]) => v === 'login' || v === 'root')) as Record<string, 'login' | 'root'>; } catch { return {}; }
  });
  useEffect(() => { try { localStorage.setItem('zq.code.ssh-users', JSON.stringify(preferences)); } catch {} }, [preferences]);
  useEffect(() => { void bridge.invoke('discoverHosts', undefined).then(r => setAliases(r.aliases)).catch(e => setError(codeError(e))); }, [bridge]);
  const hosts = snapshot.hosts.filter(h => h.kind === 'ssh');
  const visible = [...new Set(hosts.filter(h => h.visible !== false).map(h => h.sshAlias!))];
  const alias = visible.includes(selected) ? selected : visible[0];
  const runAs = preferences[alias] || ((hosts.find(h => h.sshAlias === alias)?.runAs || 'login') === 'login' ? 'login' : 'root');
  const current = hosts.find(h => h.sshAlias === alias && (h.runAs || 'login') === runAs);
  const currentId = current?.id;
  const generation = useRef(0);
  async function load(hostId: string) {
    const token = ++generation.current; setLoading(true); setError('');
    try { const result = await bridge.invoke('discoverTerminals', {hostId}); if(token === generation.current) setRows(result); }
    catch(e) { if(token === generation.current) setError(codeError(e)); }
    finally { if(token === generation.current) setLoading(false); }
  }
  useEffect(() => { setRows([]); setError(''); if(current?.available) void load(current.id); else setLoading(false); return () => { generation.current++; }; }, [currentId, current?.available, alias, runAs]);
  async function run(fn: () => Promise<unknown>) { setBusy(true); setError(''); try { await fn(); await onChanged(); } catch(e) { setError(codeError(e)); } finally { setBusy(false); } }
  async function connect() {
    await run(async () => {
      const host = current || await bridge.invoke('createHost', {name: alias, sshAlias: alias, runAs, visible:true});
      await bridge.invoke('connectHost', {id:host.id});
      await load(host.id);
    });
  }
  async function savePicker() {
    await run(async () => {
      for(const h of hosts) if((h.visible !== false) !== draft.includes(h.sshAlias!)) await bridge.invoke('updateHost',{id:h.id,patch:{visible:draft.includes(h.sshAlias!)}});
      for(const a of draft) if(!hosts.some(h => h.sshAlias === a)) await bridge.invoke('createHost',{name:a,sshAlias:a,runAs:'root',visible:true});
      setPicker(false);
    });
  }
  const attach = (row: CodeExternalTerminal) => { if(!current) return; void run(async () => onSession(await bridge.invoke('attachExternalTerminal',{hostId:current.id,target:row.target,identity:row.identity}))); };
  const hostActions = (a: string): Action[] => [
    {label:'Open host',run:() => setSelected(a)},
    {label:'Hide from explorer',disabled:busy,run:() => void run(async () => { for(const h of hosts.filter(h => h.sshAlias === a)) await bridge.invoke('updateHost',{id:h.id,patch:{visible:false}}); })},
    {label:'Disconnect host',disabled:busy || !hosts.some(h => h.sshAlias === a && h.available),run:() => void run(async () => {for(const h of hosts.filter(h => h.sshAlias === a && h.available)) await bridge.invoke('disconnectHost',{id:h.id});})},
  ];
  const available = [...new Set([...aliases, ...hosts.map(h => h.sshAlias!)])].sort();
  const filtered = available.filter(a => a.toLowerCase().includes(search.toLowerCase()));
  const openPicker = () => { setDraft(visible); setSearch(''); setPicker(true); };
  const toggle = (a: string) => setDraft(d => d.includes(a) ? d.filter(v => v !== a) : [...d,a]);
  return <div className="code-ssh"><header className="code-toolbar"><strong>Remote Explorer</strong>{alias && <Button variant="outline" size="sm" onClick={openPicker}>Choose hosts</Button>}</header>
    <div className={`code-ssh-layout ${!alias ? 'code-ssh-layout-empty' : ''}`}>{alias && <aside className="code-ssh-tree"><Input aria-label="Find SSH host" placeholder="Find a host…" value={query} onChange={e => setQuery(e.target.value)}/>{visible.filter(a => a.toLowerCase().includes(query.toLowerCase())).map(a => <ItemMenu key={a} actions={hostActions(a)}><div className={`code-ssh-host ${a === alias ? 'selected' : ''}`}><button onClick={() => setSelected(a)}><Desktop size={17}/>{a}</button><MoreMenu label={`Actions for ${a}`} actions={hostActions(a)}/></div></ItemMenu>)}</aside>}
    <section className="code-ssh-detail">{alias ? <><h2><Desktop size={24}/>{alias}</h2><label className="code-ssh-user">Open this host as<SelectField label="SSH session user" value={runAs} disabled={busy} onValueChange={v => setPreferences(p => ({...p,[alias]:v as 'root'|'login'}))} options={[{value:'root',label:'root · passwordless sudo'},{value:'login',label:'SSH login user'}]}/></label><p className="code-muted">Remembered for this host. Each user keeps its own tmux sessions and CLI configuration. Existing terminals keep their original user.</p>
      {!current?.available ? <><Button disabled={busy} onClick={() => void connect()}>{busy ? 'Connecting…' : 'Open host'}</Button><p className="code-muted">Uses your SSH configuration. On first connection, zQ installs its session helper in this user’s private directory. Requires Node.js and tmux.</p></> : <><div className="code-ssh-section"><h3>tmux sessions · {runAs === 'root' ? 'root' : 'SSH login user'}</h3><Button variant="ghost" size="sm" disabled={busy || loading} onClick={() => void load(current.id)}>Refresh</Button></div>{loading && <p role="status">Loading sessions…</p>}{rows.map(row => { const known = snapshot.sessions.find(s => s.hostId === current.id && s.tmuxTarget === row.target && s.state !== 'stopped'); const actions = [{label:'Attach terminal',disabled:busy,run:() => attach(row)},...(known ? sessionActions(known) : [])]; return <ItemMenu key={row.target} actions={actions}><div className="code-profile-row"><button disabled={busy} onClick={() => attach(row)}><TerminalWindow size={18}/><span><strong>{row.name}</strong><small>{row.windows || 1} windows · {row.attached ? 'Client attached' : 'Available'}{row.cwd ? ` · ${row.cwd}` : ''}</small></span><span>Attach</span></button><MoreMenu label={`Actions for ${row.name}`} actions={actions}/></div></ItemMenu>; })}{!loading && !rows.length && !error && <p className="code-muted">No tmux sessions for this user. Create one below.</p>}
      <div className="code-actions"><Button size="sm" variant="outline" disabled={busy} onClick={() => {setName('');setNewTerminal(true);}}><Plus/>New tmux session</Button><Button size="sm" variant="ghost" onClick={() => onAddProject(current.id)}>Add project folder</Button></div>
      <h3>Sessions in zQ</h3>{snapshot.sessions.filter(s => s.hostId === current.id && !s.archivedAt).map(s => <ItemMenu key={s.id} actions={sessionActions(s)}><div className="code-profile-row"><button onClick={() => onSession(s)}><TerminalWindow size={18}/><span><strong>{s.title}</strong><small>{snapshot.projects.find(p => p.id === s.projectId)?.name || 'No project'} · {s.state}</small></span></button><MoreMenu label={`Session actions for ${s.title}`} actions={sessionActions(s)}/></div></ItemMenu>)}
      <h3>Projects</h3>{snapshot.projects.filter(p => p.hostId === current.id).map(p => <ItemMenu key={p.id} actions={projectActions(p)}><div className="code-profile-row"><button onClick={() => onProject(p)}><FolderSimple size={18}/><span><strong>{p.name}</strong><small>{p.cwd}</small></span></button><MoreMenu label={`Project actions for ${p.name}`} actions={projectActions(p)}/></div></ItemMenu>)}</>}
    </> : <div className="code-empty"><Desktop size={32}/><h2>Choose the servers you use</h2><p>Choose which SSH hosts appear here.</p><div className="code-actions"><Button size="sm" variant="outline" onClick={openPicker}>Choose hosts</Button></div></div>}{error && <p role="alert" className="code-form-error">{error}</p>}</section></div>
    <Dialog open={picker} onOpenChange={v => {if(!busy)setPicker(v);}}><DialogContent className="code-dialog"><DialogTitle>Choose SSH hosts</DialogTitle><DialogDescription>Only selected servers appear in the explorer. Hiding one preserves its projects and sessions.</DialogDescription><Input autoFocus aria-label="Search available SSH hosts" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search SSH configuration…"/><div className="code-ssh-picker-toolbar"><span>{draft.length} selected</span><Button variant="ghost" size="sm" disabled={busy} onClick={() => setDraft(d => [...new Set([...d,...filtered])])}>Select results</Button><Button variant="ghost" size="sm" disabled={busy} onClick={() => setDraft(d => d.filter(a => !filtered.includes(a)))}>Clear results</Button></div><div className="code-ssh-picker">{filtered.map(a => <ItemMenu key={a} actions={[{label:draft.includes(a)?'Deselect host':'Select host',run:() => toggle(a)}]}><label className="code-ssh-picker-row"><input type="checkbox" checked={draft.includes(a)} disabled={busy} onChange={() => toggle(a)}/><Desktop size={16}/><span>{a}</span></label></ItemMenu>)}</div>{!available.length && <p className="code-muted">No named hosts found in your SSH configuration. Add a host through Execution hosts.</p>}{error && <p role="alert" className="code-form-error">{error}</p>}<div className="code-actions"><Button variant="ghost" disabled={busy} onClick={() => setPicker(false)}>Cancel</Button><Button disabled={busy} onClick={() => void savePicker()}>{busy?'Saving…':'Save selection'}</Button></div></DialogContent></Dialog>
    <Dialog open={newTerminal} onOpenChange={v => {if(!busy)setNewTerminal(v);}}><DialogContent className="code-dialog"><DialogTitle>New tmux session</DialogTitle><DialogDescription>{hostLabel(current)}. Starts your configured tmux shell in this user’s home directory. You can link it to a project afterward.</DialogDescription><form className="code-form" onSubmit={e => {e.preventDefault();if(!current)return;void run(async () => {const session=await bridge.invoke('createTerminal',{hostId:current.id,name:name.trim()});setNewTerminal(false);onSession(session);});}}><label>Session name<Input autoFocus required value={name} onChange={e => setName(e.target.value)} placeholder="project-work"/></label><p className="code-muted">Letters, numbers, dashes, and underscores. Existing tmux sessions are never replaced.</p>{error && <p role="alert" className="code-form-error">{error}</p>}<Button disabled={busy || !/^[a-zA-Z0-9_-]{1,64}$/.test(name.trim())}>{busy?'Starting…':'Create session'}</Button></form></DialogContent></Dialog>
  </div>;
}
