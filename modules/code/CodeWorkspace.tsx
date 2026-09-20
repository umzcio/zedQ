import { useEffect, useMemo, useRef, useState } from "react";
import {
  useHost,
  type CodeProject,
  type CodeFile,
  type CodeSession,
  type CodeWorkspaceTarget,
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
  UploadSimple,
  ArrowSquareOut,
  X,
} from "@phosphor-icons/react";
import { ItemMenu, MoreMenu, type Action } from "./CodeManagement";

import { CodeFileTree } from "./CodeFileTree";
import { CodeRepository } from "./CodeRepository";
import { TransferCompletion, type TransferActivation } from "./TransferCompletion";
import { useWorkspaceTransfers } from "./useWorkspaceTransfers";
import { codeError } from "./errors";
type Tab = "repository" | "files" | "changes" | "preview";
export function CodeWorkspace({
  project,
  session,
  onClose,
}: {
  project?: CodeProject;
  session?: CodeSession;
  onClose: () => void;
}) {
  const resource = project || {id:`session:${session!.id}`,name:session!.title,cwd:session!.cwd,hostId:session!.hostId};
  const target = useMemo<CodeWorkspaceTarget>(() => project ? {projectId:project.id} : {sessionId:session!.id}, [project?.id,session?.id]);
  const host = useHost(),
    bridge = host.services.code,
    [tab, setTab] = useState<Tab>("files"),
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
  const request = useRef(0), fileRequest=useRef(0),
    dirty = !!file && text !== file.text;
  const copy = (value: string) => void host.services.clipboard.writeText(value);
  const fail = (err: unknown) => setError(codeError(err));
  const {transfers,transferring,completion,consume,transfer}=useWorkspaceTransfers(bridge,target,host.workspace.layout.view==='Code',()=>setReload(value=>value+1),fail);
  const transferActive=transferring||transfers.some(t=>t.state==='running');
  useEffect(()=>()=>{fileRequest.current++},[target]);
  const upload=(path='',activation:TransferActivation='unknown')=>{setError('');void transfer('upload',path,activation)};
  const download=(path:string,activation:TransferActivation='unknown')=>{setError('');void transfer('download',path,activation)};
  async function refresh() {
    const token = ++request.current;
    setError("");
    try {
      if (tab === "repository") { setReload(value => value + 1); }
      else if (tab === "files") {
        setReload(value => value + 1);
      } else if (tab === "changes") {
        const result = await bridge.invoke("gitStatus", {
          ...target,
        });
        if (token === request.current) {
          setChanges(result.changes);
          setTruncated(result.truncated);
        }
      } else if (tab === "preview")
        setPreviews(
          (await bridge.invoke("listPreviews", undefined)).filter(
            (p) => p.projectId === resource.id && p.state === "ready",
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
  }, [resource.id, tab]);
  function guard(action: () => void, discardDraft = false) {
    setDiscardDraft(discardDraft);
    if (dirty) setDiscard(() => action);
    else action();
  }
  async function openFile(path: string) {
    const token=++fileRequest.current;
    setBusy(true);
    setError("");
    try {
      const result = await bridge.invoke("readFile", {
        ...target,
        path,
      });
      if(token!==fileRequest.current)return;
      const saved = sessionStorage.getItem(
        `zq.code.draft.${resource.id}.${path}`,
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
      if(token===fileRequest.current)fail(err);
    } finally {
      if(token===fileRequest.current)setBusy(false);
    }
  }
  useEffect(() => {
    if (!file) return;
    const key = `zq.code.draft.${resource.id}.${file.path}`;
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
  }, [file, text, dirty, resource.id]);
  async function save() {
    if (!file || !dirty) return true;
    setBusy(true);
    setError("");
    try {
      const result = await bridge.invoke("writeFile", {
        ...target,
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
        ...target,
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
      { label: "Download…", disabled:transferActive, run:activation=>download(change.path,activation) },
      { label: "Copy relative path", run: () => copy(change.path) },
    ];
  }
  async function openPreview() {
    setBusy(true);
    setError("");
    try {
      if (!project) return;
      const result = await bridge.invoke("openPreview", {
        projectId:project.id,
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
    <aside className="code-inspector" aria-label="File workspace">
      <div className="code-inspector-tabs">
        {(project ? ["files", "changes", "repository", "preview"] as const : ["files", "changes"] as const).map((value) => (
          <ItemMenu
            key={value}
            actions={[
              { label: "Refresh", run: () => void refresh() },
              { label: "Close workspace panel", run: () => guard(onClose) },
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
        <TooltipButton aria-label="Close workspace panel" onClick={() => guard(onClose)}>
          <X size={15} />
        </TooltipButton>
      </div>
      {error && (
        <p className="code-workspace-error" role="alert">
          {error}
        </p>
      )}
      {!!transfers.length && <div className="code-transfers" aria-label="File transfers" aria-live="polite">
        {transfers.slice(-3).map(item=><ItemMenu key={item.id} actions={[{label:'Copy file name',run:()=>copy(item.name)}]}>
          <div className={`code-transfer ${item.state}`}>
            <span title={item.name}>{item.direction==='upload'?'Upload':'Download'} · {item.name}</span>
            <small className="code-transfer-status"><TransferCompletion done={item.state==='done'} enter={completion===item.id} consume={consume}/>{item.state==='running'?`${item.total?Math.floor(item.bytes/item.total*100):0}%`:item.state==='done'?'Complete':item.state==='skipped'?'Skipped':'Failed'}</small>
            {item.state==='running'&&<progress aria-label={`Transferring ${item.name}`} value={item.bytes} max={item.total||1}/>}
            {item.error&&<p>{codeError(item.error)}</p>}
          </div>
        </ItemMenu>)}
      </div>}
      {tab === "repository" && project && <CodeRepository key={`${resource.id}-${reload}`} project={project} />}
      {tab === "files" && (
        <>
          <div className="code-file-path" title={resource.cwd}><span>{resource.cwd}</span>
            <TooltipButton aria-label="Upload files" disabled={transferActive} onClick={event=>upload('',event.detail>0?'pointer':'keyboard')}><UploadSimple size={16}/></TooltipButton>
            <MoreMenu label="Folder actions" actions={[{label:'Upload files…',disabled:transferActive,run:activation=>upload('',activation)},{label:'Copy folder path',run:()=>copy(resource.cwd)},{label:'Refresh files',run:()=>void refresh()}]}/>
          </div>
          <div className={`code-file-list ${file ? "with-editor" : ""}`}>
            <CodeFileTree target={target} rootPath={resource.cwd} local={resource.hostId==='local'} reload={reload} selected={file?.path} onOpen={path=>guard(()=>void openFile(path))} onUpload={upload} onDownload={download} transferring={transferActive}/>
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
                    { label: "Download…", disabled:transferActive, run:activation=>download(file.path,activation) },
                    { label: "Copy contents", run: () => copy(text) },
                    {
                      label: "Reload from disk",
                      run: () =>
                        guard(() => {
                          sessionStorage.removeItem(
                            `zq.code.draft.${resource.id}.${file.path}`,
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
            {resource.hostId !== "local"
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
