import {SidebarSection} from '@zq/ui'
import {CodeTasks} from './CodeTasks';
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ModuleSurface,
  useHost,
  useCommand,
  type CodeSnapshot,
  type CodeProject,
  type CodeSession,
  type CodeMode,
} from "@zq/module-api";
import {
  Button,
  TooltipButton,
  ControlTooltip,
  SelectField,
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  Input,
} from "@zq/ui";
import {
  Kanban,
  Plus,
  TerminalWindow,
  ChatCircle,
  FolderPlus,
  GearSix,
  ArrowClockwise,
  Stop,
  Archive,
  WarningCircle,
  CaretRight,
  CaretDown,
  FolderSimple,
  Code,
} from "@phosphor-icons/react";
import { CodeSSH, hostLabel } from "./CodeSSH";
import { CodeSessionNavigation } from "./CodeSessionNavigation";
import { CodeWorkbench, WorkbenchControls, useWorkbenchOwnership } from "./CodeWorkbench";
import { restoreLayout, openTab, closeTab, moveTab, type WorkbenchLayout } from "./workbench-layout";

import { CodeNativeSessions } from "./CodeNativeSessions";
import { CodeModel } from "./CodeModel";
import { CodeRepository } from "./CodeRepository";
import { CodeWorkspace } from "./CodeWorkspace";
import { CodeHosts, ExternalTerminals } from "./CodeHosts";
import {
  CodeManagement,
  ItemMenu,
  MoreMenu,
  ProjectIcon,
  type Management,
  type Action,
} from "./CodeManagement";
import { canSwitch, stateLabel } from "./session-model";
import "./code.css";
import { codeError } from "./errors";

function CodeRoot() {
  const host = useHost(),
    bridge = host.services.code,
    [snapshot, setSnapshot] = useState<CodeSnapshot | null>(null),
    [error, setError] = useState(""),
    [layout, setLayout] = useState<WorkbenchLayout>(() => {
      try { return restoreLayout(JSON.parse(localStorage.getItem('zq.code.workbench') || 'null'), localStorage.getItem('zq.code.selected') || ''); }
      catch { return restoreLayout(null); }
    }),
    [projectId, setProjectId] = useState(() => localStorage.getItem("zq.code.project") || ""),
    [dialog, setDialog] = useState<Management | null>(null),
    [newSession, setNewSession] = useState(false),
    [nativeSessions, setNativeSessions] = useState<"browse" | "new" | null>(null),
    [setup, setSetup] = useState(false),
    [archived, setArchived] = useState(false),
    [busy, setBusy] = useState(false),
    [collapsed, setCollapsed] = useState<Set<string>>(new Set()),
    [workspace, setWorkspace] = useState(() => localStorage.getItem("zq.code.workspace-open") === "true"),
    [hostsOpen, setHostsOpen] = useState(false),
    [opening, setOpening] = useState(""),
    [area, setArea] = useState(() => localStorage.getItem("zq.code.area") || "project"),
    [linking, setLinking] = useState<CodeSession | null>(null),
    [linkedProject, setLinkedProject] = useState(""),
    [external, setExternal] = useState<CodeProject | null>(null),
    [switchTo, setSwitchTo] = useState<{
      profileId: string;
      mode: CodeMode;
      model?: string;
    } | null>(null);
  const terminalCreating = useRef(false);
  const selected = layout.shown ? layout.panes[layout.focus].active || layout.panes.find(p => p.active)?.active || '' : '';
  useCommand('code.open', ({id}) => {
    host.navigate('Code');
    void run(async () => {
      const next = await bridge.invoke('snapshot', undefined);
      setSnapshot(next);
      const session = next.sessions.find(s => s.id === id);
      if (!session) throw Error('This review session is unavailable. Its native conversation remains in the agent history.');
      openSession(session);
    });
  });
  useCommand('code.dismissSession', ({id}) => {
    setLayout(l => closeTab(l, id));
    void bridge.invoke('snapshot', undefined).then(setSnapshot).catch(() => {});
  });
  useCommand('code.closeTab', () => {
    if (host.workspace.layout.view === 'Code' && selected) setLayout(l => closeTab(l, selected));
  });
  async function newLocalTerminal() {
    if (terminalCreating.current) return;
    terminalCreating.current = true;
    try {
      await run(async () => {
        const terminal = await bridge.invoke('createTerminal', {hostId:'local', name:`terminal-${crypto.randomUUID().slice(0,8)}`});
        openSession(terminal);
      });
    } finally { terminalCreating.current = false; }
  }
  useEffect(() => {
    if (host.workspace.layout.view !== 'Code') return;
    const keydown = (event: KeyboardEvent) => {
      if (host.closing || !(/Mac/.test(navigator.platform) ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey) || event.altKey || event.repeat || event.isComposing || document.querySelector('[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]')) return;
      const key = event.key.toLowerCase();
      const newTab = key === 't' && !event.shiftKey;
      const close = key === 'w' && !event.shiftKey && !!selected;
      const direction = event.shiftKey && ['[', '{'].includes(key) ? -1 : event.shiftKey && [']', '}'].includes(key) ? 1 : 0;
      if (!newTab && !close && !(direction && selected)) return;
      event.preventDefault(); event.stopImmediatePropagation();
      if (newTab) void newLocalTerminal();
      else if (close) setLayout(l => closeTab(l, selected));
      else setLayout(l => {
        const pane = l.panes[l.focus];
        if (!pane.tabs.length) return l;
        const next = (pane.tabs.indexOf(pane.active) + direction + pane.tabs.length) % pane.tabs.length;
        return openTab(l, pane.tabs[next]);
      });
    };
    window.addEventListener('keydown', keydown, true);
    return () => window.removeEventListener('keydown', keydown, true);
  });
  useWorkbenchOwnership(layout,snapshot,setError);
  useEffect(() => {
    if (!snapshot) return;
    const known=new Set(snapshot.sessions.map(s=>s.id));
    setLayout(l => l.panes.flatMap(p=>p.tabs).filter(id=>!known.has(id)).reduce(closeTab,l));
  }, [snapshot?.seq]);
  const setSelected = (id: string) => setLayout(l => openTab(l,id));
  useEffect(() => { localStorage.setItem('zq.code.workbench', JSON.stringify(layout)); }, [layout]);
  useEffect(() => { localStorage.setItem('zq.code.workspace-open', String(workspace)); }, [workspace]);
  useEffect(() => { localStorage.setItem('zq.code.area', area); }, [area]);
  useEffect(() => { localStorage.setItem('zq.code.project', projectId); }, [projectId]);
  const receiveSnapshot = useCallback((next:CodeSnapshot) => {
    setSnapshot(previous => previous?.seq === next.seq ? previous : next);
  }, []);
  const refresh = useCallback(
    () =>
      bridge
        .invoke("snapshot", undefined)
        .then(receiveSnapshot)
        .catch((error) => setError(error.message)),
    [bridge, receiveSnapshot],
  );
  useEffect(() => {
    const unsubscribe = bridge.subscribe(receiveSnapshot);
    void refresh();
    return () => {
      unsubscribe();
    };
  }, [bridge, refresh, receiveSnapshot]);
  const session = snapshot?.sessions.find((row) => row.id === selected),
    project = snapshot?.projects.find(
      (row) => row.id === (session?.projectId || projectId),
    ),
    profile = snapshot?.profiles.find((row) => row.id === session?.profileId);
  useEffect(() => {
    localStorage.setItem("zq.code.selected", selected);
  }, [selected]);
  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    try {
      await action();
      await refresh();
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };
  function switchView(row: CodeSession, mode: CodeMode) {
    if (['kimi','codex'].includes(row.adapter || '')) void run(async () => {
      const result = await bridge.invoke('switchSession', {id: row.id, expectedRevision: row.revision, profileId: row.profileId, mode});
      if (result.error) setError(result.error);
    });
    else setSwitchTo({profileId: row.profileId, mode});
  }
  const copy = (text: string) =>
    void host.services.clipboard.writeText(text).then((result) => {
      if (!result.ok) setError(result.error.message);
    });
  function openSession(s: CodeSession) {
    const select = (row: CodeSession) => {setSelected(row.id);setProjectId(row.projectId);setArea('project');setError('');};
    if (s.hostId !== 'local' && !snapshot?.hosts.find(h => h.id === s.hostId)?.available) {
      setOpening(s.id);
      void run(async () => {
        await bridge.invoke('connectHost', {id:s.hostId});
        const next = await bridge.invoke('snapshot', undefined);
        setSnapshot(next);
        const current = next.sessions.find(row => row.id === s.id);
        if (!current) throw new Error('This session is no longer on the host. Open SSH hosts to see its current sessions.');
        select(current);
      }).finally(() => setOpening(''));
    } else select(s);
  }
  function openProject(p: CodeProject) { setProjectId(p.id); setSelected(''); setArea('project'); }
  function projectActions(row: CodeProject): Action[] {
    return [
      { label: "Open project", run: () => openProject(row) },
      { label: "Open project shell", run: () => void run(async () => openSession(await bridge.invoke("createTerminal", {hostId:row.hostId,projectId:row.id,name:`zq-${Date.now().toString(36)}`}))) },
      {
        label: "New session",
        run: () => {
          setProjectId(row.id);
          setSetup(false);
          setNewSession(true);
        },
      },
      { label: "Attach existing terminal", run: () => setExternal(row) },
      {
        label: "Open setup terminal",
        run: () => {
          setProjectId(row.id);
          setSetup(true);
          setNewSession(true);
        },
      },
      {
        label: "Browse files",
        run: () => {
          setArea("project");
          setProjectId(row.id);
          setSelected("");
          setWorkspace(true);
        },
      },
      { label: "Rename", run: () => setDialog({ kind: "project", item: row }) },
      {
        label: "Settings",
        run: () => setDialog({ kind: "project", item: row }),
      },
      {
        label: "Edit icon",
        run: () => setDialog({ kind: "project", item: row, iconOnly: true }),
      },
      { label: "Copy workspace path", run: () => copy(row.cwd) },
      {
        label: "Delete project record",
        danger: true,
        run: () =>
          setDialog({
            kind: "confirm",
            title: "Delete project record?",
            description:
              "Your checkout, files and Claude history are kept. Projects with retained sessions cannot be removed.",
            action: () => bridge.invoke("deleteProject", { id: row.id }),
          }),
      },
    ];
  }
  function sessionActions(row: CodeSession): Action[] {
    return [
      { label: 'Open session', run: () => openSession(row) },
      { label: 'Close view (detach)', run: () => { setLayout(l => closeTab(l,row.id)); if(layout.panes.flatMap(p=>p.tabs).filter(id=>id!==row.id).length===0)setArea('terminals'); } },
      { label: layout.panes.some(p=>p.tabs.includes(row.id)) ? 'Move to other pane' : 'Open in other pane', run: () => { setLayout(l => { const index=l.panes.findIndex(p=>p.tabs.includes(row.id)); return moveTab(l,row.id,1-(index<0?l.focus:index)); }); openSession(row); } },
      ...(row.ownership === 'external' ? [{ label:'Link to project', run:() => {setLinking(row);setLinkedProject(row.projectId || '');} }] : []),
      {
        label: "Rename",
        run: () => setDialog({ kind: "rename", id: row.id, title: row.title }),
      },
      {
        label: "Switch profile and continue",
        disabled: busy || row.adapter === "kimi" ||
          !canSwitch(row) ||
          snapshot?.profiles.find((p) => p.id === row.profileId)?.adapter ===
            "terminal",
        run: () => {
          setArea("project");setSelected(row.id);
          setSwitchTo({ profileId: row.profileId, mode: row.mode });
        },
      },
      {
        label: row.mode === "chat" ? "Switch to Terminal" : "Switch to Chat",
        disabled: busy ||
          !canSwitch(row) ||
          snapshot?.profiles.find((p) => p.id === row.profileId)?.adapter ===
            "terminal",
        run: () => {
          setArea("project");setSelected(row.id);
          switchView(row, row.mode === "chat" ? "terminal" : "chat");
        },
      },
      ...(['kimi','codex','claude'].includes(row.adapter || 'claude') && row.nativeId ? [{label: 'Copy resume command', run: () => copy(`${snapshot?.profiles.find(p => p.id === row.profileId)?.functionName || row.adapter || 'claude'} ${row.adapter === 'kimi' ? '--session' : row.adapter === 'codex' ? 'resume' : '--resume'} '${row.nativeId}'`)}] : []),
      { label: "Copy workspace path", run: () => copy(row.cwd) },
      {
        label: row.archivedAt ? "Restore session" : "Archive",
        run: () =>
          void run(() =>
            bridge.invoke("updateSession", {
              id: row.id,
              archived: !row.archivedAt,
            }),
          ),
      },
      {
        label:
          row.ownership === "external" ? "Detach terminal" : "Stop session",
        disabled: busy || ["stopped", "switching", "disconnected"].includes(row.state),
        run: () =>
          setDialog({
            kind: "confirm",
            title:
              row.ownership === "external"
                ? "Detach this terminal?"
                : "Stop this session?",
            description:
              row.ownership === "external"
                ? "The external process keeps running."
                : "The running process will stop. Native agent conversations can be resumed later.",
            action: () =>
              bridge.invoke("stopSession", {
                id: row.id,
                expectedRevision: row.revision,
              }),
          }),
      },
    ];
  }
  return (
    <>
      <ModuleSurface slot="sidebar">
        <div className="code-sidebar">
          <TooltipButton className="code-new" aria-label="New terminal" tooltip="Open a terminal on This Mac (⌘T)" disabled={busy} onClick={() => void newLocalTerminal()}>
            <TerminalWindow size={17}/>New terminal<kbd>⌘T</kbd>
          </TooltipButton>
          <button
            className="code-new-agent"
            onClick={() => setNativeSessions("new")}
          >
            <Plus size={17} />
            New agent session
          </button>
          <button className="code-new-agent" onClick={() => setNativeSessions("browse")}><ChatCircle size={17}/>Sessions</button>
          <div className="code-sidebar-navigation"><ItemMenu actions={[{label:"Open Code tasks",run:()=>setArea("tasks")}]}><button aria-label="Code tasks" aria-pressed={area === "tasks"} onClick={()=>setArea("tasks")}><Kanban size={17}/>Tasks</button></ItemMenu><button aria-pressed={area === 'ssh'} onClick={() => setArea('ssh')}><TerminalWindow size={17}/>SSH hosts</button><button aria-pressed={area === 'terminals'} onClick={() => setArea('terminals')}><TerminalWindow size={17}/>Terminals</button></div>
          <CodeSessionNavigation snapshot={snapshot} selected={area === 'project' ? selected : ''} archived={archived} busy={busy} opening={opening} onOpen={openSession} actions={sessionActions}/>
          <SidebarSection storageKey="code.projects" title="Projects" actions={<TooltipButton aria-label="Add Code project" onClick={()=>setDialog({kind:"project"})}><Plus size={15}/></TooltipButton>}>
          {snapshot?.projects.map((row) => (
            <section className="code-project-group" key={row.id}>
              <ItemMenu actions={projectActions(row)}>
                <div className="code-project-row">
                  <button
                    onClick={() => {
                      setArea("project");setSelected("");setProjectId(row.id);
                      setCollapsed((old) => {
                        const next = new Set(old);
                        if (next.has(row.id)) next.delete(row.id);
                        else next.add(row.id);
                        return next;
                      });
                    }}
                    aria-expanded={!collapsed.has(row.id)}
                  >
                    <CaretRight
                      size={12}
                      className={!collapsed.has(row.id) ? "expanded" : ""}
                    />
                    <ProjectIcon project={row} />
                    <span>{row.name}</span>
                  </button>
                  <MoreMenu
                    label={`Actions for ${row.name}`}
                    actions={projectActions(row)}
                  />
                </div>
              </ItemMenu>
              {!collapsed.has(row.id) &&
                snapshot.sessions
                  .filter(
                    (item) =>
                      item.projectId === row.id &&
                      !!item.archivedAt === archived,
                  )
                  .map((item) => (
                    <ItemMenu key={item.id} actions={sessionActions(item)}>
                      <div
                        className={`code-session-row ${area === "project" && selected === item.id ? "selected" : ""}`}
                      >
                        <button
                          onClick={() => {
                            openSession(item);
                          }}
                          aria-current={
                            area === "project" && selected === item.id ? "page" : undefined
                          }
                        >
                          <span
                            className={`code-state-dot code-state-${item.state}`}
                          />
                          <span>{item.title}</span>
                        </button>
                        <MoreMenu
                          label={`Actions for ${item.title}`}
                          actions={sessionActions(item)}
                        />
                      </div>
                    </ItemMenu>
                  ))}
            </section>
          ))}
          {snapshot && !snapshot.projects.length && (
            <p className="code-sidebar-hint">
              Add a project folder to organize your coding sessions.
            </p>
          )}
          </SidebarSection>
          <div className="code-sidebar-bottom">
            <button
              onClick={() => setArchived((value) => !value)}
              aria-pressed={archived}
            >
              <Archive size={17} />
              {archived ? "Show active sessions" : "Archived sessions"}
            </button>
            <button onClick={() => setDialog({ kind: "profiles" })}>
              <GearSix size={17} />
              Manage profiles
            </button>
            <button onClick={() => setHostsOpen(true)}>
              <TerminalWindow size={17} />
              Execution hosts
            </button>
          </div>
        </div>
      </ModuleSurface>
      <CodeTasks active={area === "tasks" && host.workspace.layout.view === "Code"} pickerSignal={0} refreshSignal={0}/>
      <ModuleSurface>
        <div className="code-workspace" style={area === "tasks" ? {display:"none"} : undefined}>
          {error && area !== 'project' && <p role="alert" className="code-form-error">{codeError(error)}</p>}
          {!snapshot ? (
            <div className="code-empty">
              <Code size={32} weight="light" />
              <h2>{error ? "Code could not connect" : "Opening Code…"}</h2>
              {error && (
                <>
                  <p role="alert">{error}</p>
                  <Button onClick={() => void refresh()}>Retry</Button>
                </>
              )}
            </div>
          ) : area === 'ssh' ? <CodeSSH snapshot={snapshot} onChanged={refresh} onSession={openSession} onProject={openProject} onAddProject={hostId => setDialog({kind:'project',hostId})} sessionActions={sessionActions} projectActions={projectActions}/> : area === 'terminals' ? <div className="code-terminal-list"><header className="code-toolbar"><strong>Terminals & sessions</strong><Button variant="outline" size="sm" onClick={() => setArea('ssh')}>Open SSH host</Button></header><p className="code-muted">Closing a view detaches. Sessions remain on their execution host.</p>{snapshot.sessions.filter(s => !s.archivedAt).map(s => <ItemMenu key={s.id} actions={sessionActions(s)}><div className="code-profile-row"><button onClick={() => openSession(s)}><TerminalWindow size={18}/><span><strong>{s.title}</strong><small>{hostLabel(snapshot.hosts.find(h => h.id === s.hostId))} · {snapshot.projects.find(p => p.id === s.projectId)?.name || 'No project'} · {stateLabel(s)}</small></span></button><MoreMenu label={`Actions for ${s.title}`} actions={sessionActions(s)}/></div></ItemMenu>)}{!snapshot.sessions.some(s => !s.archivedAt) && <p className="code-muted">Open an SSH host or a project to start a session.</p>}</div> : (
            <>
              <header className="code-toolbar">
                <div className="code-toolbar-title">
                  {session ? <>
                    <ControlTooltip content={`${stateLabel(session)} · ${hostLabel(snapshot.hosts.find(h => h.id === session.hostId))}`}>
                      <span className="code-session-host" tabIndex={0} aria-label={`${stateLabel(session)} · ${hostLabel(snapshot.hosts.find(h => h.id === session.hostId))}`}>
                        <span className={`code-state-dot code-state-${session.state}`} aria-hidden="true"/>
                        <span>{session.hostId === 'local' ? 'This Mac' : snapshot.hosts.find(h => h.id === session.hostId)?.sshAlias || 'Remote host'}</span>
                      </span>
                    </ControlTooltip>
                    <span className="code-slash" aria-hidden="true">/</span>
                    <ItemMenu actions={sessionActions(session)}>
                      <div className="code-session-name">
                        <MoreMenu label="Session actions" actions={sessionActions(session)} trigger={
                          <button className="code-session-name-trigger" aria-label="Session actions" title={session.title}>
                            <strong>{session.title}</strong><CaretDown size={12}/>
                          </button>
                        }/>
                      </div>
                    </ItemMenu>
                    {session.cwd && <>
                      <span className="code-slash" aria-hidden="true">/</span>
                      <ItemMenu actions={[{label: 'Copy workspace path', run: () => copy(session.cwd)}]}>
                        <span className="code-session-path" tabIndex={0} aria-label={`Workspace path: ${session.cwd}`} title={session.cwd}>{session.cwd.replace(/^\/(?!$)/, '')}</span>
                      </ItemMenu>
                    </>}
                  </> : <>{project && <ProjectIcon project={project}/>}<span>{project?.name || 'Code'}</span></>}
                </div>
                {session && (
                  <>
                    {session.state !== 'ready' && <span className="code-session-state" role="status">{stateLabel(session)}</span>}
                    {session.state === 'disconnected' && <Button size="sm" variant="ghost" disabled={busy} onClick={() => openSession(session)}><ArrowClockwise size={14}/>{busy ? 'Connecting…' : 'Reconnect to host'}</Button>}
                    {profile?.adapter !== "terminal" &&
                      session.adapter !== "terminal" &&
                      session.ownership !== "external" &&
                      [
                        "stopped",
                        "recoverable",
                        "limited",
                        "error",
                        "disconnected",
                      ].includes(session.state) && (
                        <Button size="sm" variant="ghost"
                          disabled={busy}
                          onClick={() =>
                            void run(() =>
                              bridge.invoke("resumeSession", {
                                id: session.id,
                                expectedRevision: session.revision,
                              }),
                            )
                          }
                        >
                          <ArrowClockwise size={14} />
                          Resume
                        </Button>
                      )}
                    {session.adapter !== 'kimi' && session.ownership !== 'external' && profile?.adapter !== 'terminal' && (
                    <button
                      className="code-profile-button"
                      disabled={
                        busy ||
                        !canSwitch(session)
                      }
                      onClick={() =>
                        setSwitchTo({
                          profileId: session.profileId,
                          mode: session.mode,
                        })
                      }
                    >
                      {profile?.name || "Profile"}
                      {canSwitch(session) && <CaretRight size={12} />}
                    </button>
                    )}
                    <div
                      className="code-mode-switch"
                      aria-label="Session interface"
                    >
                      {(["chat", "terminal"] as const).map((mode) => (
                        <TooltipButton
                          key={mode}
                          tooltip={
                            mode === session.mode
                              ? false
                              : canSwitch(session)
                                ? `Continue this conversation in ${mode === "chat" ? "Chat" : "Terminal"}`
                                : "Finish or interrupt the current turn before switching"
                          }
                          aria-pressed={session.mode === mode}
                          disabled={
                            busy ||
                            (mode !== session.mode &&
                              (!canSwitch(session) ||
                                profile?.adapter === "terminal"))
                          }
                          onClick={() => {
                            if (mode !== session.mode)
                              switchView(session, mode);
                          }}
                        >
                          {mode === "chat" ? (
                            <ChatCircle size={16} />
                          ) : (
                            <TerminalWindow size={16} />
                          )}
                          <span>{mode === "chat" ? "Chat" : "Terminal"}</span>
                        </TooltipButton>
                      ))}
                    </div>
                    {session.adapter !== "kimi" && session.adapter !== "codex" && session.adapter !== "terminal" && session.ownership !== "external" && <button
                      className="code-profile-button" disabled={busy || !canSwitch(session)}
                      aria-label="Change Claude model" onClick={() => setSwitchTo({ profileId: session.profileId, mode: session.mode, model: session.model || "default" })}>
                      {session.resolvedModel || (session.model && session.model !== "default" ? session.model : "Profile default")}<CaretRight size={12}/>
                    </button>}
                  </>
                )}
                {session && ['kimi','codex'].includes(session.adapter || '') && <span className="code-muted" title="Uses the native agent configuration. Change models with /model in Terminal.">{session.resolvedModel || (session.adapter === 'codex' ? 'Codex' : 'Kimi')}</span>}
                {session && <WorkbenchControls layout={layout} setLayout={setLayout}/>}
                {(project || session) && (
                  <button
                    className="code-workspace-toggle"
                    aria-pressed={workspace}
                    onClick={() => setWorkspace((value) => !value)}
                  >
                    <FolderSimple size={16} />
                    Workspace
                  </button>
                )}
              </header>
              {!snapshot.runtime.tmux && (
                <div className="code-alert" role="alert">
                  <WarningCircle size={18} />
                  <div>
                    <strong>tmux is required</strong>
                    <p>
                      Install tmux on this Mac, then retry. Your sessions run
                      independently of the zQ window.
                    </p>
                    <code>brew install tmux</code>
                  </div>
                  <Button variant="ghost" onClick={() => void refresh()}>
                    Retry
                  </Button>
                </div>
              )}
              {session ? (
                <>
                  {session.purpose === "profile-setup" && (
                    <div className="code-setup-note">
                      Complete the native setup below, then use Session actions
                      → Stop session and return to your conversation.
                    </div>
                  )}
                  <div className="code-session-body">
                    <CodeWorkbench layout={layout} setLayout={setLayout} snapshot={snapshot} onOpen={openSession} actions={sessionActions} onError={setError}/>
                    {workspace && (
                      <CodeWorkspace
                        key={project?.id || session.id}
                        project={project}
                        session={session}
                        onClose={() => setWorkspace(false)}
                      />
                    )}
                  </div>
                  {(error || session.error || session.recovery?.code) && (
                    <div className="code-alert code-bottom-alert" role="alert">
                      <WarningCircle size={18} />
                      <div>
                        <strong>
                          {error
                            ? "Action could not finish"
                            : "Session needs attention"}
                        </strong>
                        <p>
                          {codeError(
                            error || session.error || session.recovery?.code,
                          )}
                        </p>
                      </div>
                      <button
                        onClick={() => {
                          setProjectId(session.projectId);
                          setSetup(true);
                          setNewSession(true);
                        }}
                      >
                        Open setup terminal
                      </button>
                      <button
                        onClick={() => setError("")}
                        aria-label="Dismiss action error"
                        disabled={!error}
                      >
                        Dismiss
                      </button>
                    </div>
                  )}
                </>
              ) : (
                <div className="code-session-body">
                  {project ? <CodeRepository key={project.id} project={project} onNewSession={() => { setSetup(false); setNewSession(true); }} /> : <div className="code-empty">
                    <TerminalWindow size={36} weight="light" />
                    <h1>Your code. Your agents.</h1>
                    <p>
                      Open a terminal on this Mac, connect to an SSH host, or choose a project to work with an agent.
                    </p>
                    <div className="code-actions">
                      <Button disabled={busy} onClick={() => void newLocalTerminal()}><TerminalWindow size={17}/>Open local terminal</Button>
                      <Button
                        variant="outline"
                        onClick={() => setDialog({ kind: "project" })}
                      >
                        <FolderPlus size={17} />
                        Add project
                      </Button>
                      {snapshot.projects.length > 0 && (
                        <Button
                          onClick={() => {
                            setProjectId(
                              snapshot.projects[0].id,
                            );
                            setSetup(false);
                            setNewSession(true);
                          }}
                        >
                          <Plus size={17} />
                          New session
                        </Button>
                      )}
                    </div>
                    {error && (
                      <p role="alert" className="code-form-error">
                        {error}
                      </p>
                    )}
                  </div>}
                  {workspace && project && (
                    <CodeWorkspace
                      key={project.id}
                      project={project}
                      onClose={() => setWorkspace(false)}
                    />
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </ModuleSurface>
      {snapshot && (
        <>
          <Dialog open={!!linking} onOpenChange={open => {if(!open)setLinking(null);}}><DialogContent className="code-dialog"><DialogTitle>Link terminal to project</DialogTitle><DialogDescription>{linking?.title} · {hostLabel(snapshot.hosts.find(h => h.id === linking?.hostId))}. Linking leaves its working directory and process unchanged.</DialogDescription><SelectField label="Linked project" value={linkedProject || '__none'} onValueChange={v => setLinkedProject(v === '__none' ? '' : v)} options={[{value:'__none',label:'No project'},...snapshot.projects.filter(p => p.hostId === linking?.hostId).map(p => ({value:p.id,label:p.name}))]}/>{error && <p role="alert" className="code-form-error">{codeError(error)}</p>}<div className="code-actions"><Button variant="ghost" onClick={() => setLinking(null)}>Cancel</Button><Button disabled={busy} onClick={() => void run(async () => {if(linking)await bridge.invoke('linkTerminal',{id:linking.id,projectId:linkedProject || null});setLinking(null);})}>Save link</Button></div></DialogContent></Dialog>
          <CodeHosts
            open={hostsOpen}
            snapshot={snapshot}
            onClose={() => setHostsOpen(false)}
            onChanged={() => void refresh()}
          />
          <ExternalTerminals
            project={external}
            onClose={() => setExternal(null)}
            onAttached={(id) => {
              setArea("project");setSelected(id);
              setExternal(null);
              void refresh();
            }}
          />
          {nativeSessions && <CodeNativeSessions startNew={nativeSessions === "new"} snapshot={snapshot} onClose={() => setNativeSessions(null)} onOpen={row => { openSession(row); setNativeSessions(null); void refresh(); }} />}
          <CodeManagement
            dialog={dialog}
            snapshot={snapshot}
            onClose={() => {
              setDialog(null);
              void refresh();
            }}
            onDialog={setDialog}
            onError={setError}
          />
          <NewSession
            open={newSession}
            setup={setup}
            initialProfile={
              session?.recovery?.targetProfileId || session?.profileId
            }
            projectId={projectId}
            snapshot={snapshot}
            onClose={() => setNewSession(false)}
            onCreated={(id) => {
              setArea("project");setSelected(id);
              setNewSession(false);
              void refresh();
            }}
          />
          <Dialog
            open={!!switchTo}
            onOpenChange={(open) => {
              if (!open) setSwitchTo(null);
            }}
          >
            <DialogContent className="code-dialog">
              <DialogTitle>Continue this conversation</DialogTitle>
              <DialogDescription>
                The current controller stops before the selected profile opens
                the same conversation. Your files and native history stay in
                place.
              </DialogDescription>
              {switchTo && session && (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void run(async () => {
                      const result = await bridge.invoke("switchSession", {
                        id: session.id,
                        expectedRevision: session.revision,
                        ...switchTo,
                      });
                      if (
                        result.state === "recoverable" ||
                        result.state === "error" ||
                        result.state === "switching"
                      )
                        throw new Error(
                          codeError(
                            result.error ||
                              result.recovery?.code ||
                              "TARGET_NOT_READY",
                          ),
                        );
                      setSwitchTo(null);
                    });
                  }}
                >
                  <label>
                    Profile
                    <SelectField
                      label="Continue with profile"
                      value={switchTo.profileId}
                      onValueChange={(profileId) =>
                        setSwitchTo({ ...switchTo, profileId })
                      }
                      options={snapshot.profiles
                        .filter(
                          (row) =>
                            row.hostId === session.hostId &&
                            (row.adapter || "claude") === (session.adapter || "claude"),
                        )
                        .map((row) => ({ value: row.id, label: row.name }))}
                    />
                  </label>
                  <label>
                    Interface
                    <SelectField
                      label="Continue in interface"
                      value={switchTo.mode}
                      onValueChange={(mode) =>
                        setSwitchTo({ ...switchTo, mode: mode as CodeMode })
                      }
                      options={[
                        { value: "chat", label: "Chat" },
                        { value: "terminal", label: "Terminal" },
                      ]}
                    />
                  </label>
                  {session.adapter !== "codex" && <CodeModel value={switchTo.model ?? session.model ?? "default"} onChange={model => setSwitchTo({ ...switchTo, model })} />}
                  {error && (
                    <p role="alert" className="code-form-error">
                      {codeError(error)}
                    </p>
                  )}
                  <div className="code-actions">
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => setSwitchTo(null)}
                    >
                      Cancel
                    </Button>
                    <Button disabled={busy || !canSwitch(session) || switchTo.model === ""}>
                      {busy ? "Switching…" : "Switch and continue"}
                    </Button>
                  </div>
                </form>
              )}
            </DialogContent>
          </Dialog>
        </>
      )}
    </>
  );
}
function NewSession({
  open,
  setup,
  initialProfile,
  projectId,
  snapshot,
  onClose,
  onCreated,
}: {
  open: boolean;
  setup: boolean;
  initialProfile?: string;
  projectId: string;
  snapshot: CodeSnapshot;
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const bridge = useHost().services.code,
    [project, setProject] = useState(projectId),
    [profile, setProfile] = useState(""),
    [mode, setMode] = useState<CodeMode>("chat"),
    [title, setTitle] = useState(""),
    [model, setModel] = useState("default"),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) {
      setProject(projectId || snapshot.projects[0]?.id || "");
      setTitle("");
      if (initialProfile) setProfile(initialProfile);
      if (setup) setMode("terminal");
      setError("");
    }
  }, [open, projectId]);
  const hostId = snapshot.projects.find((row) => row.id === project)?.hostId,
    profiles = snapshot.profiles.filter((row) => row.hostId === hostId),
    terminalOnly =
      profiles.find((row) => row.id === profile)?.adapter === "terminal",
    claudeProfile = (profiles.find((row) => row.id === profile)?.adapter || "claude") === "claude";
  useEffect(() => {
    if (terminalOnly) setMode("terminal");
  }, [terminalOnly]);
  useEffect(() => {
    if (!profiles.some((row) => row.id === profile))
      setProfile(profiles[0]?.id || "");
  }, [project, snapshot.profiles]);
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!value) onClose();
      }}
    >
      <DialogContent className="code-dialog">
        <DialogTitle>
          {setup ? "Set up this profile" : "New coding session"}
        </DialogTitle>
        <DialogDescription>
          {setup
            ? "Complete the CLI’s native login and folder trust prompts here. Stop this setup terminal when finished, then resume your original conversation. Stop other sessions in this project before setup."
            : "Run a coding agent in your project with your existing account and configuration."}
        </DialogDescription>
        <form
          className="code-form"
          onSubmit={(e) => {
            e.preventDefault();
            setBusy(true);
            setError("");
            void (
              setup
                ? bridge.invoke("createSetupSession", {
                    projectId: project,
                    profileId: profile,
                  })
                : bridge.invoke("createSession", {
                    projectId: project,
                    profileId: profile,
                    mode,
                    ...(claudeProfile ? { model } : {}),
                    ...(title.trim() ? { title: title.trim() } : {}),
                  })
            )
              .then((row) => onCreated(row.id))
              .catch((error) => setError(codeError(error)))
              .finally(() => setBusy(false));
          }}
        >
          <label>
            Project
            <SelectField
              label="Project"
              value={project}
              onValueChange={setProject}
              options={snapshot.projects.map((row) => ({
                value: row.id,
                label: row.name,
              }))}
            />
          </label>
          <label>
            Profile
            <SelectField
              label="Coding profile"
              value={profile}
              onValueChange={setProfile}
              options={profiles.map((row) => ({
                value: row.id,
                label: row.name,
              }))}
            />
          </label>
          {!profiles.length && <p>Add a profile from Manage profiles first.</p>}
          {claudeProfile && !setup && <CodeModel value={model} onChange={setModel} />}
          <label>
            Interface
            <SelectField
              label="Session interface"
              value={mode}
              onValueChange={(value) => setMode(value as CodeMode)}
              options={
                terminalOnly || setup
                  ? [{ value: "terminal", label: "Terminal" }]
                  : [
                      { value: "chat", label: "Chat" },
                      { value: "terminal", label: "Terminal" },
                    ]
              }
            />
          </label>
          <label>
            Name <span className="code-muted">(optional)</span>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="What are you working on?"
              maxLength={160}
            />
          </label>
          {error && (
            <p role="alert" className="code-form-error">
              {error}
            </p>
          )}
          <div className="code-actions">
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button disabled={busy || !project || !profile || (claudeProfile && !setup && !model)}>
              {busy ? "Starting…" : "Start session"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
export default { Root: CodeRoot };
