import { useEffect, useState } from "react";
import {
  useHost,
  type CodeSnapshot,
  type CodeHost,
  type CodeExternalTerminal,
  type CodeProject,
} from "@zq/module-api";
import {
  Button,
  Input,
  SelectField,
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@zq/ui";
import { ItemMenu, MoreMenu, type Action } from "./CodeManagement";
import { codeError } from "./errors";
export function CodeHosts({
  open,
  snapshot,
  onClose,
  onChanged,
}: {
  open: boolean;
  snapshot: CodeSnapshot;
  onClose: () => void;
  onChanged: () => void;
}) {
  const bridge = useHost().services.code,
    [editing, setEditing] = useState<CodeHost | null>(null),
    [name, setName] = useState(""),
    [alias, setAlias] = useState(""),
    [aliases, setAliases] = useState<string[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [remove, setRemove] = useState<CodeHost | null>(null);
  useEffect(() => {
    if (open)
      void bridge
        .invoke("discoverHosts", undefined)
        .then((result) => setAliases(result.aliases))
        .catch((err) => setError(err.message));
  }, [open, bridge]);
  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await action();
      onChanged();
    } catch (err) {
      setError(codeError(err));
    } finally {
      setBusy(false);
    }
  }
  function actions(host: CodeHost): Action[] {
    return [
      {
        label: host.available ? "Disconnect" : "Connect",
        disabled: busy,
        run: () =>
          void run(() =>
            host.available
              ? bridge.invoke("disconnectHost", { id: host.id })
              : bridge.invoke("connectHost", { id: host.id }),
          ),
      },
      {
        label: "Edit host",
        run: () => {
          setEditing(host);
          setName(host.name);
          setAlias(host.sshAlias || "");
        },
      },
      { label: "Remove host", danger: true, run: () => setRemove(host) },
    ];
  }
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!value) onClose();
      }}
    >
      <DialogContent className="code-dialog">
        <DialogTitle>Execution hosts</DialogTitle>
        <DialogDescription>
          Use this Mac or connect to a host from your SSH configuration.
          Connecting installs zQ’s session helper in your remote user directory;
          sessions continue after disconnecting.
        </DialogDescription>
        <div className="code-host-list">
          <div className="code-profile-row">
            <strong>This Mac</strong>
            <span className="code-muted">Local</span>
          </div>
          {snapshot.hosts
            .filter((host) => host.kind === "ssh")
            .map((host) => (
              <ItemMenu key={host.id} actions={actions(host)}>
                <div className="code-profile-row">
                  <button
                    disabled={busy}
                    onClick={() =>
                      void run(() =>
                        host.available
                          ? bridge.invoke("disconnectHost", { id: host.id })
                          : bridge.invoke("connectHost", { id: host.id }),
                      )
                    }
                  >
                    <span>
                      <strong>{host.name}</strong>
                      <small>
                        {host.available
                          ? "Connected"
                          : host.error || "Disconnected"}{" "}
                        · {host.sshAlias} · {host.runAs === "root" ? "root" : "SSH login user"}
                      </small>
                    </span>
                  </button>
                  <MoreMenu
                    label={`Actions for ${host.name}`}
                    actions={actions(host)}
                  />
                </div>
              </ItemMenu>
            ))}
        </div>
        <form
          className="code-form"
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              if (editing)
                await bridge.invoke("updateHost", {
                  id: editing.id,
                  patch: { name, sshAlias: alias },
                });
              else await bridge.invoke("createHost", { name, sshAlias: alias });
              setEditing(null);
              setName("");
              setAlias("");
            });
          }}
        >
          <label>
            Host name
            <Input
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Development server"
            />
          </label>
          {aliases.length > 0 && (
            <label>
              SSH configuration
              <SelectField
                label="SSH configuration"
                value={aliases.includes(alias) ? alias : ""}
                onValueChange={(value) => {
                  setAlias(value);
                  if (!name) setName(value);
                }}
                options={aliases.map((value) => ({ value, label: value }))}
              />
            </label>
          )}
          <label>
            SSH alias
            <Input
              disabled={!!editing}
              required
              value={alias}
              onChange={(e) => setAlias(e.target.value)}
              placeholder="my-server"
            />
          </label>
          <p className="code-muted">
            Uses your SSH keys and agent. Set up host keys and login in Terminal
            first.
          </p>
          {error && (
            <p role="alert" className="code-form-error">
              {error}
            </p>
          )}
          <div className="code-actions">
            {editing && (
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setEditing(null);
                  setName("");
                  setAlias("");
                }}
              >
                Cancel edit
              </Button>
            )}
            <Button disabled={busy || !name.trim() || !alias.trim()}>
              {editing ? "Save host" : "Add host"}
            </Button>
          </div>
        </form>
        {remove && (
          <div className="code-permission">
            <strong>Remove {remove.name}?</strong>
            <p>Disconnect first. Remote files and processes are kept.</p>
            <div className="code-actions">
              <Button variant="ghost" onClick={() => setRemove(null)}>
                Cancel
              </Button>
              <Button
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    await bridge.invoke("deleteHost", { id: remove.id });
                    setRemove(null);
                  })
                }
              >
                Remove
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
export function ExternalTerminals({
  project,
  onClose,
  onAttached,
}: {
  project: CodeProject | null;
  onClose: () => void;
  onAttached: (id: string) => void;
}) {
  const bridge = useHost().services.code,
    [rows, setRows] = useState<CodeExternalTerminal[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  function refresh() {
    if (project) {
      setError("");
      void bridge
        .invoke("discoverTerminals", { hostId: project.hostId })
        .then(setRows)
        .catch((err) => setError(err.message));
    }
  }
  useEffect(refresh, [project?.id]);
  function attach(row: CodeExternalTerminal) {
    if (!project) return;
    setBusy(true);
    setError("");
    void bridge
      .invoke("attachExternalTerminal", {
        projectId: project.id,
        target: row.target,
        identity: row.identity,
        title: row.name,
      })
      .then((session) => onAttached(session.id))
      .catch((err) => setError(err.message))
      .finally(() => setBusy(false));
  }
  return (
    <Dialog
      open={!!project}
      onOpenChange={(value) => {
        if (!value) onClose();
      }}
    >
      <DialogContent className="code-dialog">
        <DialogTitle>Attach an existing terminal</DialogTitle>
        <DialogDescription>
          Attach to a tmux session on this project’s host. zQ won’t stop or take
          ownership of its process.
        </DialogDescription>
        <div className="code-profile-list">
          {rows.map((row) => (
            <ItemMenu
              key={row.target}
              actions={[
                {
                  label: "Attach terminal",
                  disabled: busy,
                  run: () => attach(row),
                },
              ]}
            >
              <div className="code-profile-row">
                <button disabled={busy} onClick={() => attach(row)}>
                  <span>
                    <strong>{row.name}</strong>
                    <small>
                      {row.attached
                        ? "Already has an attached client"
                        : "Available"}
                    </small>
                  </span>
                  <span>Attach</span>
                </button>
              </div>
            </ItemMenu>
          ))}
          {!rows.length && !error && (
            <p className="code-muted">No existing tmux sessions found.</p>
          )}
          {error && (
            <p role="alert" className="code-form-error">
              {error}
            </p>
          )}
          <Button variant="outline" onClick={refresh} disabled={busy}>
            Refresh
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
