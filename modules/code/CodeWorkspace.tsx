import { useEffect, useRef, useState } from "react";
import {
  useHost,
  type CodeProject,
  type CodeFile,
  type CodeFileEntry,
  type CodeChange,
  type CodePreview,
} from "@zq/module-api";
import {
  Button,
  Input,
  TooltipButton,
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@zq/ui";
import {
  ArrowClockwise,
  ArrowLeft,
  FolderSimple,
  File,
  ArrowSquareOut,
  X,
} from "@phosphor-icons/react";
import { ItemMenu, MoreMenu, type Action } from "./CodeManagement";

import { CodeRepository } from "./CodeRepository";
import { codeError } from "./errors";
type Tab = "repository" | "files" | "changes" | "preview";
export function CodeWorkspace({
  project,
  onClose,
}: {
  project: CodeProject;
  onClose: () => void;
}) {
  const host = useHost(),
    bridge = host.services.code,
    [tab, setTab] = useState<Tab>("repository"),
    [folder, setFolder] = useState(""),
    [entries, setEntries] = useState<CodeFileEntry[]>([]),
    [changes, setChanges] = useState<CodeChange[]>([]),
    [file, setFile] = useState<CodeFile | null>(null),
    [text, setText] = useState(""),
    [diff, setDiff] = useState<{
      path: string;
      staged: boolean;
      text: string;
    } | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [truncated, setTruncated] = useState(false),
    [discard, setDiscard] = useState<(() => void) | null>(null),
    [discardDraft, setDiscardDraft] = useState(false),
    [previews, setPreviews] = useState<CodePreview[]>([]),
    [url, setUrl] = useState("http://localhost:3000"),
    [frame, setFrame] = useState<CodePreview | null>(null),
    [reload, setReload] = useState(0);
  const request = useRef(0),
    dirty = !!file && text !== file.text;
  const copy = (value: string) => void host.services.clipboard.writeText(value);
  const fail = (err: unknown) => setError(codeError(err));
  async function refresh() {
    const token = ++request.current;
    setError("");
    try {
      if (tab === "repository") { setReload(value => value + 1); }
      else if (tab === "files") {
        const result = await bridge.invoke("listFiles", {
          projectId: project.id,
          path: folder,
        });
        if (token === request.current) {
          setEntries(result.entries);
          setTruncated(result.truncated);
        }
      } else if (tab === "changes") {
        const result = await bridge.invoke("gitStatus", {
          projectId: project.id,
        });
        if (token === request.current) {
          setChanges(result.changes);
          setTruncated(result.truncated);
        }
      } else if (tab === "preview")
        setPreviews(
          (await bridge.invoke("listPreviews", undefined)).filter(
            (p) => p.projectId === project.id && p.state === "ready",
          ),
        );
    } catch (err) {
      if (token === request.current) fail(err);
    }
  }
  useEffect(() => {
    void refresh();
    return () => {
      request.current++;
    };
  }, [project.id, tab, folder]);
  function guard(action: () => void, discardDraft = false) {
    setDiscardDraft(discardDraft);
    if (dirty) setDiscard(() => action);
    else action();
  }
  async function openFile(path: string) {
    setBusy(true);
    setError("");
    try {
      const result = await bridge.invoke("readFile", {
        projectId: project.id,
        path,
      });
      const saved = sessionStorage.getItem(
        `zq.code.draft.${project.id}.${path}`,
      );
      setFile(result);
      setText(result.text);
      if (saved) {
        try {
          const draft = JSON.parse(saved);
          if (
            typeof draft.text === "string" &&
            typeof draft.fingerprint === "string"
          ) {
            setFile({
              ...result,
              text: draft.base,
              fingerprint: draft.fingerprint,
            });
            setText(draft.text);
            if (draft.fingerprint !== result.fingerprint)
              setError(
                "This file changed since your saved draft. Copy your draft, then reload the file before saving.",
              );
          }
        } catch {}
      }
      setDiff(null);
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    if (!file) return;
    const key = `zq.code.draft.${project.id}.${file.path}`;
    if (dirty)
      sessionStorage.setItem(
        key,
        JSON.stringify({
          text,
          base: file.text,
          fingerprint: file.fingerprint,
        }),
      );
    else sessionStorage.removeItem(key);
  }, [file, text, dirty, project.id]);
  async function save() {
    if (!file || !dirty) return true;
    setBusy(true);
    setError("");
    try {
      const result = await bridge.invoke("writeFile", {
        projectId: project.id,
        path: file.path,
        text,
        fingerprint: file.fingerprint,
      });
      setFile(result);
      setText(result.text);
      await refresh();
      return true;
    } catch (err) {
      fail(err);
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function showDiff(path: string, staged = false) {
    setBusy(true);
    setError("");
    try {
      const result = await bridge.invoke("gitDiff", {
        projectId: project.id,
        path,
        staged,
      });
      setDiff({
        path,
        staged,
        text: result.diff + (result.truncated ? "\n… Diff truncated." : ""),
      });
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  }
  function fileActions(entry: CodeFileEntry): Action[] {
    return [
      {
        label: entry.kind === "directory" ? "Open folder" : "Open file",
        disabled: entry.kind === "symlink",
        run: () =>
          guard(() =>
            entry.kind === "directory"
              ? setFolder(entry.path)
              : void openFile(entry.path),
          ),
      },
      { label: "Copy relative path", run: () => copy(entry.path) },
      {
        label: "Reveal in Finder",
        disabled: project.hostId !== "local",
        run: () =>
          void bridge
            .invoke("revealFile", { projectId: project.id, path: entry.path })
            .catch(fail),
      },
    ];
  }
  function changeActions(change: CodeChange): Action[] {
    return [
      { label: "View working changes", run: () => void showDiff(change.path) },
      {
        label: "View staged changes",
        disabled: change.index === " " || change.index === "?",
        run: () => void showDiff(change.path, true),
      },
      {
        label: "Open file",
        run: () =>
          guard(() => {
            setTab("files");
            void openFile(change.path);
          }),
      },
      { label: "Copy relative path", run: () => copy(change.path) },
    ];
  }
  async function openPreview() {
    setBusy(true);
    setError("");
    try {
      const result = await bridge.invoke("openPreview", {
        projectId: project.id,
        url,
      });
      setFrame(result);
      await refresh();
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  }
  const previewActions = (preview: CodePreview): Action[] => [
    {
      label: "Reload preview",
      run: () => {
        setFrame(preview);
        setReload((value) => value + 1);
      },
    },
    {
      label: "Open in browser",
      run: () =>
        void bridge.invoke("openExternal", { url: preview.url }).catch(fail),
    },
    { label: "Copy preview URL", run: () => copy(preview.url) },
    {
      label: "Stop preview",
      run: () =>
        void bridge
          .invoke("stopPreview", { id: preview.id })
          .then(() => {
            if (frame?.id === preview.id) setFrame(null);
            void refresh();
          })
          .catch(fail),
    },
  ];
  return (
    <aside className="code-inspector" aria-label="Project workspace">
      <div className="code-inspector-tabs">
        {(["repository", "files", "changes", "preview"] as const).map((value) => (
          <ItemMenu
            key={value}
            actions={[
              { label: "Refresh", run: () => void refresh() },
              { label: "Close workspace panel", run: onClose },
            ]}
          >
            <button aria-pressed={tab === value} onClick={() => setTab(value)}>
              {value === "repository" ? "Git" : value === "files"
                ? "Files"
                : value === "changes"
                  ? "Changes"
                  : "Preview"}
            </button>
          </ItemMenu>
        ))}
        <TooltipButton
          aria-label="Refresh workspace"
          onClick={() => void refresh()}
        >
          <ArrowClockwise size={15} />
        </TooltipButton>
        <TooltipButton aria-label="Close workspace panel" onClick={onClose}>
          <X size={15} />
        </TooltipButton>
      </div>
      {error && (
        <p className="code-workspace-error" role="alert">
          {error}
        </p>
      )}
      {tab === "repository" && <CodeRepository key={`${project.id}-${reload}`} project={project} />}
      {tab === "files" && (
        <>
          <div className="code-file-path">
            <button
              disabled={!folder}
              onClick={() =>
                setFolder(folder.split("/").slice(0, -1).join("/"))
              }
              aria-label="Parent folder"
            >
              <ArrowLeft size={15} />
            </button>
            <span>{folder || project.name}</span>
          </div>
          <div className={`code-file-list ${file ? "with-editor" : ""}`}>
            {entries.map((entry) => (
              <ItemMenu key={entry.path} actions={fileActions(entry)}>
                <div className="code-file-row">
                  <button
                    disabled={entry.kind === "symlink" || busy}
                    onClick={() =>
                      guard(() =>
                        entry.kind === "directory"
                          ? setFolder(entry.path)
                          : void openFile(entry.path),
                      )
                    }
                  >
                    {entry.kind === "directory" ? (
                      <FolderSimple size={16} />
                    ) : (
                      <File size={16} />
                    )}
                    <span>{entry.name}</span>
                    {entry.kind === "symlink" && <small>symlink</small>}
                  </button>
                  <MoreMenu
                    label={`Actions for ${entry.name}`}
                    actions={fileActions(entry)}
                  />
                </div>
              </ItemMenu>
            ))}
            {!entries.length && (
              <p className="code-muted">This folder is empty.</p>
            )}
            {truncated && (
              <p className="code-muted">Folder listing is truncated.</p>
            )}
          </div>
          {file && (
            <div className="code-editor">
              <div className="code-editor-heading">
                <span>
                  {file.path}
                  {dirty ? " •" : ""}
                </span>
                <MoreMenu
                  label="File editor actions"
                  actions={[
                    {
                      label: "Save",
                      disabled: !dirty || busy,
                      run: () => void save(),
                    },
                    { label: "Copy contents", run: () => copy(text) },
                    {
                      label: "Reload from disk",
                      run: () =>
                        guard(() => {
                          sessionStorage.removeItem(
                            `zq.code.draft.${project.id}.${file.path}`,
                          );
                          void openFile(file.path);
                        }, true),
                    },
                    {
                      label: "Close file",
                      run: () =>
                        guard(() => {
                          setFile(null);
                        }),
                    },
                  ]}
                />
                <Button
                  disabled={!dirty || busy}
                  variant="outline"
                  onClick={() => void save()}
                >
                  Save
                </Button>
              </div>
              <textarea
                spellCheck={false}
                aria-label={`Edit ${file.path}`}
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if ((e.metaKey || e.ctrlKey) && e.key === "s") {
                    e.preventDefault();
                    void save();
                  }
                }}
              />
              <small>⌘S to save · Unsaved drafts stay in this window.</small>
            </div>
          )}
        </>
      )}
      {tab === "changes" && (
        <>
          <div className="code-change-list">
            {changes.map((change) => (
              <ItemMenu key={change.path} actions={changeActions(change)}>
                <div className="code-file-row">
                  <button onClick={() => void showDiff(change.path)}>
                    <code>
                      {change.untracked
                        ? "??"
                        : `${change.index}${change.worktree}`}
                    </code>
                    <span>{change.path}</span>
                  </button>
                  <MoreMenu
                    label={`Changes for ${change.path}`}
                    actions={changeActions(change)}
                  />
                </div>
              </ItemMenu>
            ))}
            {!changes.length && !error && (
              <p className="code-muted">No uncommitted changes.</p>
            )}
            {truncated && (
              <p className="code-muted">Change list is truncated.</p>
            )}
          </div>
          {diff && (
            <div className="code-diff">
              <div className="code-editor-heading">
                <span>{diff.path}</span>
                <button
                  aria-pressed={diff.staged}
                  onClick={() => void showDiff(diff.path, !diff.staged)}
                >
                  {diff.staged ? "Staged" : "Working tree"}
                </button>
              </div>
              <pre>
                {diff.text.split("\n").map((line, i) => (
                  <span
                    key={i}
                    className={
                      line.startsWith("+")
                        ? "added"
                        : line.startsWith("-")
                          ? "removed"
                          : ""
                    }
                  >
                    {line}
                    {"\n"}
                  </span>
                ))}
              </pre>
            </div>
          )}
        </>
      )}
      {tab === "preview" && (
        <>
          <form
            className="code-preview-form"
            onSubmit={(e) => {
              e.preventDefault();
              void openPreview();
            }}
          >
            <Input
              aria-label="Preview URL"
              type="url"
              required
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
            <Button disabled={busy}>Open</Button>
          </form>
          <p className="code-preview-hint">
            Start your development server in Terminal, then open its address
            here.
            {project.hostId !== "local"
              ? " Remote localhost ports are forwarded over SSH."
              : ""}
          </p>
          {previews.map((preview) => (
            <ItemMenu key={preview.id} actions={previewActions(preview)}>
              <div className="code-file-row">
                <button onClick={() => setFrame(preview)}>
                  <span>{preview.sourceUrl}</span>
                </button>
                <MoreMenu
                  label={`Actions for ${preview.sourceUrl}`}
                  actions={previewActions(preview)}
                />
              </div>
            </ItemMenu>
          ))}
          {frame && (
            <div className="code-preview">
              <div className="code-editor-heading">
                <span>{frame.forwarded ? "SSH preview" : "Local preview"}</span>
                <TooltipButton
                  aria-label="Reload preview"
                  onClick={() => setReload((value) => value + 1)}
                >
                  <ArrowClockwise size={15} />
                </TooltipButton>
                <TooltipButton
                  aria-label="Open preview in browser"
                  onClick={() =>
                    void bridge
                      .invoke("openExternal", { url: frame.url })
                      .catch(fail)
                  }
                >
                  <ArrowSquareOut size={15} />
                </TooltipButton>
              </div>
              <iframe
                key={`${frame.id}-${reload}`}
                title="Development preview"
                src={frame.url}
                sandbox="allow-scripts allow-forms allow-same-origin"
                referrerPolicy="no-referrer"
              />
              <small>
                If this site blocks embedding, open it in your browser.
              </small>
            </div>
          )}
        </>
      )}
      <Dialog
        open={!!discard}
        onOpenChange={(open) => {
          if (!open) setDiscard(null);
        }}
      >
        <DialogContent className="code-dialog">
          <DialogTitle>Unsaved file changes</DialogTitle>
          <DialogDescription>
            {discardDraft
              ? "Reloading replaces your unsaved draft with the file on disk."
              : "Save the file before continuing, or keep this draft for later."}
          </DialogDescription>
          <div className="code-actions">
            <Button variant="ghost" onClick={() => setDiscard(null)}>
              Cancel
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                const action = discard;
                setDiscard(null);
                action?.();
              }}
            >
              {discardDraft ? "Discard and reload" : "Keep draft and continue"}
            </Button>
            <Button
              disabled={busy}
              onClick={() =>
                void save().then((saved) => {
                  if (saved) setDiscard(null);
                })
              }
            >
              Save
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </aside>
  );
}
