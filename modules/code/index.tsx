import { useCallback, useEffect, useState } from "react";
import {
  ModuleSurface,
  useHost,
  type CodeSnapshot,
  type CodeProject,
  type CodeSession,
  type CodeMode,
} from "@zq/module-api";
import {
  Button,
  TooltipButton,
  SelectField,
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  Input,
} from "@zq/ui";
import {
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
  FolderSimple,
  Code,
} from "@phosphor-icons/react";
import { CodeTerminal } from "./CodeTerminal";
import { CodeChat } from "./CodeChat";
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
    [selected, setSelected] = useState(
      () => localStorage.getItem("zq.code.selected") || "",
    ),
    [projectId, setProjectId] = useState(""),
    [dialog, setDialog] = useState<Management | null>(null),
    [newSession, setNewSession] = useState(false),
    [setup, setSetup] = useState(false),
    [archived, setArchived] = useState(false),
    [busy, setBusy] = useState(false),
    [collapsed, setCollapsed] = useState<Set<string>>(new Set()),
    [workspace, setWorkspace] = useState(false),
    [hostsOpen, setHostsOpen] = useState(false),
    [external, setExternal] = useState<CodeProject | null>(null),
    [switchTo, setSwitchTo] = useState<{
      profileId: string;
      mode: CodeMode;
    } | null>(null);
  const refresh = useCallback(
    () =>
      bridge
        .invoke("snapshot", undefined)
        .then(setSnapshot)
        .catch((error) => setError(error.message)),
    [bridge],
  );
  useEffect(() => {
    const unsubscribe = bridge.subscribe(setSnapshot);
    void refresh();
    const timer = setInterval(() => void refresh(), 3000);
    return () => {
      unsubscribe();
      clearInterval(timer);
    };
  }, [bridge, refresh]);
  const session = snapshot?.sessions.find((row) => row.id === selected),
    project = snapshot?.projects.find(
      (row) => row.id === (session?.projectId || projectId),
    ),
    profile = snapshot?.profiles.find((row) => row.id === session?.profileId);
  useEffect(() => {
    localStorage.setItem("zq.code.selected", selected);
  }, [selected]);
  useEffect(() => {
    if (!session) return;
    void bridge
      .invoke("claimSession", { id: session.id })
      .catch((error) => setError(error.message));
    return () => {
      void bridge.invoke("releaseSession", { id: session.id }).catch(() => {});
    };
  }, [bridge, session?.id]);
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
  const copy = (text: string) =>
    void host.services.clipboard.writeText(text).then((result) => {
      if (!result.ok) setError(result.error.message);
    });
  function projectActions(row: CodeProject): Action[] {
    return [
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
      {
        label: "Rename",
        run: () => setDialog({ kind: "rename", id: row.id, title: row.title }),
      },
      {
        label: "Switch profile and continue",
        disabled:
          !canSwitch(row) ||
          snapshot?.profiles.find((p) => p.id === row.profileId)?.adapter ===
            "terminal",
        run: () => {
          setSelected(row.id);
          setSwitchTo({ profileId: row.profileId, mode: row.mode });
        },
      },
      {
        label: row.mode === "chat" ? "Switch to Terminal" : "Switch to Chat",
        disabled:
          !canSwitch(row) ||
          snapshot?.profiles.find((p) => p.id === row.profileId)?.adapter ===
            "terminal",
        run: () => {
          setSelected(row.id);
          setSwitchTo({
            profileId: row.profileId,
            mode: row.mode === "chat" ? "terminal" : "chat",
          });
        },
      },
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
        disabled: ["stopped", "switching", "disconnected"].includes(row.state),
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
                : "The running process will stop. Claude conversations can be resumed later.",
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
          <button
            className="code-new"
            onClick={() => {
              if (snapshot?.projects.length) {
                setProjectId(project?.id || snapshot.projects[0].id);
                setSetup(false);
                setNewSession(true);
              } else setDialog({ kind: "project" });
            }}
          >
            <Plus size={17} />
            New session
          </button>
          <div className="code-sidebar-heading">
            <span>Projects</span>
            <TooltipButton
              aria-label="Add Code project"
              onClick={() => setDialog({ kind: "project" })}
            >
              <Plus size={15} />
            </TooltipButton>
          </div>
          {snapshot?.projects.map((row) => (
            <section className="code-project-group" key={row.id}>
              <ItemMenu actions={projectActions(row)}>
                <div className="code-project-row">
                  <button
                    onClick={() => {
                      setProjectId(row.id);
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
                        className={`code-session-row ${selected === item.id ? "selected" : ""}`}
                      >
                        <button
                          onClick={() => {
                            setSelected(item.id);
                            setProjectId(row.id);
                            setError("");
                          }}
                          aria-current={
                            selected === item.id ? "page" : undefined
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
              Add a project folder to start a coding session.
            </p>
          )}
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
      <ModuleSurface>
        <div className="code-workspace">
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
          ) : (
            <>
              <header className="code-toolbar">
                <div className="code-toolbar-title">
                  {project && <ProjectIcon project={project} />}
                  <span>{project?.name || "Code"}</span>
                  {session && (
                    <>
                      <span className="code-slash">/</span>
                      <strong>{session.title}</strong>
                    </>
                  )}
                </div>
                {session && (
                  <>
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
                              setSwitchTo({
                                profileId: session.profileId,
                                mode,
                              });
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
                    <button
                      className="code-profile-button"
                      disabled={
                        busy ||
                        !canSwitch(session) ||
                        profile?.adapter === "terminal"
                      }
                      onClick={() =>
                        setSwitchTo({
                          profileId: session.profileId,
                          mode: session.mode,
                        })
                      }
                    >
                      {profile?.name || "Profile"}
                      <CaretRight size={12} />
                    </button>
                    <MoreMenu
                      label="Session actions"
                      actions={sessionActions(session)}
                    />
                  </>
                )}
                {project && (
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
                  <div className="code-session-status">
                    <span
                      className={`code-state-dot code-state-${session.state}`}
                    />
                    {stateLabel(session)}
                    <span>{session.cwd}</span>
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
                        <button
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
                        </button>
                      )}
                  </div>
                  {session.purpose === "profile-setup" && (
                    <div className="code-setup-note">
                      Complete the native setup below, then use Session actions
                      → Stop session and return to your conversation.
                    </div>
                  )}
                  <div className="code-session-body">
                    <div className="code-main-area">
                      {session.mode === "terminal" ? (
                        <CodeTerminal
                          key={`${session.id}-${session.revision}`}
                          session={session}
                          onError={setError}
                        />
                      ) : (
                        <CodeChat
                          key={session.id}
                          session={session}
                          onError={setError}
                        />
                      )}
                    </div>
                    {workspace && project && (
                      <CodeWorkspace
                        key={project.id}
                        project={project}
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
                  <div className="code-empty">
                    <TerminalWindow size={36} weight="light" />
                    <h1>Your code. Your agents.</h1>
                    <p>
                      Open a project, choose a Claude profile, and pick up where
                      you left off.
                    </p>
                    <div className="code-actions">
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
                              project?.id || snapshot.projects[0].id,
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
                    {project && <p className="code-muted">{project.cwd}</p>}
                    {error && (
                      <p role="alert" className="code-form-error">
                        {error}
                      </p>
                    )}
                  </div>
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
              setSelected(id);
              setExternal(null);
              void refresh();
            }}
          />
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
              setSelected(id);
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
                the same conversation. Your files and Claude history stay in
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
                            row.adapter !== "terminal",
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
                  {error && (
                    <p role="alert" className="code-form-error">
                      {error}
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
                    <Button disabled={busy || !canSwitch(session)}>
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
      profiles.find((row) => row.id === profile)?.adapter === "terminal";
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
            <Button disabled={busy || !project || !profile}>
              {busy ? "Starting…" : "Start session"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
export default { Root: CodeRoot };
