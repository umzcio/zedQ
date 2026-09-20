import { useRef, useState, type ReactNode } from "react";
import { codeError } from "./errors";
import {
  Button,
  Input,
  SelectField,
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  TooltipButton,
} from "@zq/ui";
import {
  DotsThree,
  FolderSimple,
  Code,
  TerminalWindow,
  Cube,
  Globe,
  GearSix,
  Flask,
  BookOpen,
  Lightning,
  Database,
  Briefcase,
  Tree,
  Star,
  Compass,
  Rocket,
} from "@phosphor-icons/react";
import {
  useHost,
  type CodeProject,
  type CodeProfile,
  type CodeSnapshot,
} from "@zq/module-api";

export type Action = {
  label: string;
  run: (activation?: import("./TransferCompletion").TransferActivation) => void;
  disabled?: boolean;
  danger?: boolean;
};
export function ItemMenu({
  actions,
  children,
}: {
  actions: Action[];
  children: ReactNode;
}) {
  const activation=useRef<import("./TransferCompletion").TransferActivation>("unknown");
  return (
    <ContextMenu onOpenChange={()=>{activation.current="unknown"}}>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent onKeyDownCapture={()=>{activation.current="keyboard"}}>
        {actions.map((action) => (
          <ContextMenuItem
            key={action.label}
            disabled={action.disabled}
            onClickCapture={event=>{activation.current=event.detail>0?"pointer":"keyboard"}}
            onSelect={()=>{const source=activation.current;activation.current="unknown";action.run(source)}}
            className={action.danger ? "code-danger" : ""}
          >
            {action.label}
          </ContextMenuItem>
        ))}
      </ContextMenuContent>
    </ContextMenu>
  );
}
export function MoreMenu({
  actions,
  label,
  trigger,
}: {
  actions: Action[];
  label: string;
  trigger?: ReactNode;
}) {
  const activation=useRef<import("./TransferCompletion").TransferActivation>("unknown");
  return (
    <DropdownMenu onOpenChange={()=>{activation.current="unknown"}}>
      <DropdownMenuTrigger asChild>
        {trigger || <TooltipButton aria-label={label} className="code-more">
          <DotsThree size={20} />
        </TooltipButton>}
      </DropdownMenuTrigger>
      <DropdownMenuContent align={trigger ? "start" : "end"} onKeyDownCapture={()=>{activation.current="keyboard"}}>
        {actions.map((action) => (
          <DropdownMenuItem
            key={action.label}
            disabled={action.disabled}
            onClickCapture={event=>{activation.current=event.detail>0?"pointer":"keyboard"}}
            onSelect={()=>{const source=activation.current;activation.current="unknown";action.run(source)}}
            className={action.danger ? "code-danger" : ""}
          >
            {action.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
const icons = {
  FolderSimple,
  Code,
  TerminalWindow,
  Cube,
  Globe,
  GearSix,
  Flask,
  BookOpen,
  Lightning,
  Database,
  Briefcase,
  Tree,
  Star,
  Compass,
  Rocket,
};
const colors = ["neutral", "blue", "green", "purple", "orange", "red"];
export function ProjectIcon({
  project,
}: {
  project: Pick<CodeProject, "icon" | "color">;
}) {
  const Icon = icons[project.icon as keyof typeof icons] || FolderSimple;
  return (
    <Icon
      weight="light"
      size={18}
      className={`code-project-icon code-color-${project.color}`}
    />
  );
}
export type Management =
  | { kind: "project"; item?: CodeProject; iconOnly?: boolean; hostId?: string }
  | { kind: "profile"; item?: CodeProfile }
  | { kind: "profiles" }
  | { kind: "rename"; id: string; title: string }
  | {
      kind: "confirm";
      title: string;
      description: string;
      action: () => Promise<unknown>;
    };
export function CodeManagement({
  dialog,
  snapshot,
  onClose,
  onError,
  onDialog,
}: {
  dialog: Management | null;
  snapshot: CodeSnapshot;
  onClose: () => void;
  onError: (message: string) => void;
  onDialog: (dialog: Management) => void;
}) {
  const bridge = useHost().services.code;
  return (
    <Dialog
      open={!!dialog}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="code-dialog">
        <DialogTitle>
          {!dialog
            ? ""
            : dialog.kind === "project"
              ? dialog.iconOnly
                ? "Edit project icon"
                : dialog.item
                  ? "Project settings"
                  : "Add project"
              : dialog.kind === "profile"
                ? dialog.item
                  ? "Edit profile"
                  : "Add profile"
                : dialog.kind === "profiles"
                  ? "Coding profiles"
                  : dialog.kind === "rename"
                    ? "Rename session"
                    : dialog.title}
        </DialogTitle>
        <DialogDescription>
          {dialog?.kind === "project"
            ? "Use an existing folder. Your files stay where they are."
            : dialog?.kind === "profile"
              ? "Use your existing shell launcher and shared Claude configuration."
              : dialog?.kind === "profiles"
                ? "Switch accounts without leaving the conversation."
                : dialog?.kind === "confirm"
                  ? dialog.description
                  : "Give this session a recognizable name."}
        </DialogDescription>
        {dialog && (dialog.kind === "project" || dialog.kind === "profile") ? (
          <EditForm
            key={`${dialog.kind}-${dialog.item?.id || "new"}-${dialog.kind === "project" && dialog.iconOnly}`}
            dialog={dialog}
            snapshot={snapshot}
            onClose={onClose}
          />
        ) : dialog?.kind === "profiles" ? (
          <div className="code-profile-list">
            {snapshot.profiles.map((profile) => (
              <ItemMenu
                key={profile.id}
                actions={[
                  {
                    label: "Rename / edit launcher",
                    run: () => onDialog({ kind: "profile", item: profile }),
                  },
                  {
                    label: "Duplicate",
                    run: () =>
                      void bridge
                        .invoke("duplicateProfile", { id: profile.id })
                        .catch((error) => onError(error.message)),
                  },
                  {
                    label: "Remove from zQ",
                    danger: true,
                    run: () =>
                      onDialog({
                        kind: "confirm",
                        title: "Remove profile?",
                        description:
                          "This removes only the zQ profile. Your account, configuration and conversation history are kept.",
                        action: () =>
                          bridge.invoke("deleteProfile", { id: profile.id }),
                      }),
                  },
                ]}
              >
                <div className="code-profile-row">
                  <button
                    onClick={() => onDialog({ kind: "profile", item: profile })}
                  >
                    <TerminalWindow size={18} />
                    <span>
                      <strong>{profile.name}</strong>
                      <small>{profile.functionName}</small>
                    </span>
                  </button>
                  <MoreMenu
                    label={`Actions for ${profile.name}`}
                    actions={[
                      {
                        label: "Edit launcher",
                        run: () => onDialog({ kind: "profile", item: profile }),
                      },
                      {
                        label: "Duplicate",
                        run: () =>
                          void bridge
                            .invoke("duplicateProfile", { id: profile.id })
                            .catch((error) => onError(error.message)),
                      },
                      {
                        label: "Remove from zQ",
                        danger: true,
                        run: () =>
                          onDialog({
                            kind: "confirm",
                            title: "Remove profile?",
                            description:
                              "Your account and native history are kept.",
                            action: () =>
                              bridge.invoke("deleteProfile", {
                                id: profile.id,
                              }),
                          }),
                      },
                    ]}
                  />
                </div>
              </ItemMenu>
            ))}
            <Button onClick={() => onDialog({ kind: "profile" })}>
              Add profile
            </Button>
          </div>
        ) : dialog?.kind === "rename" ? (
          <RenameForm id={dialog.id} title={dialog.title} onClose={onClose} />
        ) : dialog?.kind === "confirm" ? (
          <ConfirmForm dialog={dialog} onClose={onClose} />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
function ConfirmForm({
  dialog,
  onClose,
}: {
  dialog: Extract<Management, { kind: "confirm" }>;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <>
      <p role="alert" className="code-form-error">
        {codeError(error)}
      </p>
      <div className="code-actions">
        <Button variant="ghost" onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button
          disabled={busy}
          onClick={() => {
            setBusy(true);
            void dialog
              .action()
              .then(onClose)
              .catch((error) => setError(error.message))
              .finally(() => setBusy(false));
          }}
        >
          Confirm
        </Button>
      </div>
    </>
  );
}
function RenameForm({
  id,
  title,
  onClose,
}: {
  id: string;
  title: string;
  onClose: () => void;
}) {
  const bridge = useHost().services.code,
    [name, setName] = useState(title),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        setBusy(true);
        void bridge
          .invoke("updateSession", { id, title: name })
          .then(onClose)
          .catch((error) => setError(error.message))
          .finally(() => setBusy(false));
      }}
    >
      <Input
        autoFocus
        aria-label="Session name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        maxLength={160}
      />
      <p role="alert" className="code-form-error">
        {codeError(error)}
      </p>
      <div className="code-actions">
        <Button type="button" variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button disabled={busy || !name.trim()}>Save</Button>
      </div>
    </form>
  );
}
function EditForm({
  dialog,
  snapshot,
  onClose,
}: {
  dialog: Extract<Management, { kind: "project" | "profile" }>;
  snapshot: CodeSnapshot;
  onClose: () => void;
}) {
  const bridge = useHost().services.code,
    item = dialog.item,
    [name, setName] = useState(item?.name || ""),
    [hostId, setHostId] = useState(item?.hostId || (dialog.kind === "project" ? dialog.hostId : undefined) || "local"),
    [cwd, setCwd] = useState(
      dialog.kind === "project" ? dialog.item?.cwd || "" : "",
    ),
    [icon, setIcon] = useState(
      dialog.kind === "project"
        ? dialog.item?.icon || "FolderSimple"
        : "FolderSimple",
    ),
    [color, setColor] = useState(
      dialog.kind === "project" ? dialog.item?.color || "neutral" : "neutral",
    ),
    [file, setFile] = useState(
      dialog.kind === "profile"
        ? dialog.item?.launcherFile || snapshot.profiles[0]?.launcherFile || ""
        : "",
    ),
    [fn, setFn] = useState(
      dialog.kind === "profile" ? dialog.item?.functionName || "" : "",
    ),
    [shared, setShared] = useState(
      dialog.kind === "profile"
        ? (dialog.item?.sharedHistoryConfirmed ?? true)
        : true,
    ),
    [adapter, setAdapter] = useState<"claude" | "codex" | "terminal">(
      dialog.kind === "profile" ? dialog.item?.adapter || "claude" : "claude",
    ),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function save() {
    setBusy(true);
    setError("");
    try {
      if (dialog.kind === "project") {
        const patch = {
          name,
          icon,
          color,
          ...(dialog.item?.cwd !== cwd ? { cwd } : {}),
          ...(dialog.item?.hostId !== hostId ? { hostId } : {}),
        };
        if (item) await bridge.invoke("updateProject", { id: item.id, patch });
        else
          await bridge.invoke("createProject", {
            name,
            cwd,
            hostId,
            icon,
            color,
          });
      } else {
        const patch = {
          name,
          hostId,
          launcherFile: file,
          functionName: fn,
          adapter,
          modes: (adapter === "terminal"
            ? ["terminal"]
            : ["chat", "terminal"]) as ("chat" | "terminal")[],
          sharedHistoryConfirmed: adapter !== "terminal" && shared,
        };
        if (item) await bridge.invoke("updateProfile", { id: item.id, patch });
        else await bridge.invoke("createProfile", patch);
      }
      onClose();
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form
      className="code-form"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      {!(dialog.kind === "project" && dialog.iconOnly) && (
        <>
          <label>
            Name
            <Input
              autoFocus
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={160}
            />
          </label>
          {snapshot.hosts.length > 1 && (
            <label>
              Host
              <SelectField
                label="Execution host"
                value={hostId}
                onValueChange={setHostId}
                options={snapshot.hosts.map((host) => ({
                  value: host.id,
                  label: host.kind === "ssh" ? `${host.name} · ${host.runAs === "root" ? "root" : "SSH login user"}` : host.name,
                }))}
              />
            </label>
          )}
          {dialog.kind === "project" ? (
            <label>
              Folder
              <div className="code-input-action">
                <Input
                  aria-label="Project folder"
                  required
                  value={cwd}
                  onChange={(e) => setCwd(e.target.value)}
                  placeholder="/path/to/project"
                />
                <Button
                  type="button"
                  variant="outline"
                  disabled={hostId !== "local"}
                  onClick={() =>
                    void bridge
                      .invoke("pickDirectory", undefined)
                      .then((path) => {
                        if (path) setCwd(path);
                      })
                      .catch((error) => setError(error.message))
                  }
                >
                  Browse
                </Button>
              </div>
            </label>
          ) : (
            <>
              <label>
                Agent type
                <SelectField
                  label="Agent type"
                  value={adapter}
                  onValueChange={(value) =>
                    setAdapter(value as "claude" | "codex" | "terminal")
                  }
                  options={[
                    { value: "claude", label: "Claude · Chat and Terminal" },
                    { value: "codex", label: "Codex · Chat and Terminal" },
                    { value: "terminal", label: "Other CLI · Terminal only" },
                  ]}
                />
              </label>
              <label>
                Launcher file
                <Input
                  required
                  value={file}
                  onChange={(e) => setFile(e.target.value)}
                  placeholder="/path/to/profiles.zsh"
                />
              </label>
              <label>
                Shell function
                <Input
                  required
                  value={fn}
                  onChange={(e) => setFn(e.target.value)}
                  placeholder="claude-work"
                  pattern="[A-Za-z_][A-Za-z0-9_-]*"
                />
              </label>
              {adapter !== "terminal" && (
                <label className="code-check">
                  <input
                    type="checkbox"
                    checked={shared}
                    onChange={(e) => setShared(e.target.checked)}
                  />
                  This profile shares my Claude conversation history
                </label>
              )}
            </>
          )}
        </>
      )}
      {dialog.kind === "project" && (
        <>
          <label>Icon</label>
          <div className="code-icon-grid">
            {Object.entries(icons).map(([key, Icon]) => (
              <TooltipButton
                type="button"
                key={key}
                aria-label={`${key} icon`}
                aria-pressed={icon === key}
                onClick={() => setIcon(key)}
              >
                <Icon weight="light" size={24} />
              </TooltipButton>
            ))}
          </div>
          <div className="code-color-grid" aria-label="Icon color">
            {colors.map((value) => (
              <TooltipButton
                type="button"
                key={value}
                aria-label={`${value} color`}
                aria-pressed={color === value}
                onClick={() => setColor(value)}
              >
                <span className={`code-color-${value}`}>●</span>
              </TooltipButton>
            ))}
          </div>
        </>
      )}
      <p role="alert" className="code-form-error">
        {codeError(error)}
      </p>
      <div className="code-actions">
        <Button type="button" variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button disabled={busy || !name.trim()}>
          {busy ? "Saving…" : "Save"}
        </Button>
      </div>
    </form>
  );
}
