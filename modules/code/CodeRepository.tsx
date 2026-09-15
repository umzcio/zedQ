import { useEffect, useRef, useState } from "react";
import {
  useHost,
  type CodeProject,
  type CodeRepository as Repository,
  type CodeCommit,
} from "@zq/module-api";
import {
  Button,
  SelectField,
  TooltipButton,
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@zq/ui";
import {
  ArrowClockwise,
  GitBranch,
  ArrowSquareOut,
  Plus,
} from "@phosphor-icons/react";
import { ItemMenu, MoreMenu, type Action } from "./CodeManagement";
import { codeError } from "./errors";

export function CodeRepository({
  project,
  onNewSession,
}: {
  project: CodeProject;
  onNewSession?: () => void;
}) {
  const host = useHost(),
    bridge = host.services.code;
  const [repo, setRepo] = useState<Repository | null>(null),
    [error, setError] = useState("");
  const [busy, setBusy] = useState(false),
    [remote, setRemote] = useState("");
  const [detail, setDetail] = useState<{
    commit: CodeCommit;
    text: string;
  } | null>(null);
  const [notice, setNotice] = useState("");
  const generation = useRef(0);
  async function load(more = false) {
    const token = ++generation.current;
    setBusy(true);
    setError("");
    try {
      const next = await bridge.invoke("gitRepository", {
        projectId: project.id,
        skip: more ? repo?.commits?.length || 0 : 0,
      });
      if (token !== generation.current) return;
      setRepo((old) =>
        more
          ? {
              ...next,
              commits: [...(old?.commits || []), ...(next.commits || [])],
            }
          : next,
      );
      setRemote((current) =>
        next.remotes?.some((r) => r.name === current)
          ? current
          : next.remotes?.find((r) => r.name === "origin")?.name ||
            next.remotes?.[0]?.name ||
            "",
      );
    } catch (e) {
      if (token === generation.current) setError(codeError(e));
    } finally {
      if (token === generation.current) setBusy(false);
    }
  }
  useEffect(() => {
    setRepo(null);
    setDetail(null);
    setNotice("");
    void load();
    return () => {
      generation.current++;
    };
  }, [project.id]);
  async function fetchRemote() {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await bridge.invoke("gitFetch", { projectId: project.id, remote });
      setNotice(`Fetched ${remote}. Your working files and branch were kept.`);
      await load();
    } catch (e) {
      setError(codeError(e));
    } finally {
      setBusy(false);
    }
  }
  const copy = (text: string) => void host.services.clipboard.writeText(text);
  const selectedRemote = repo?.remotes?.find((r) => r.name === remote);
  const openRemote = () => {
    if (selectedRemote?.url)
      void bridge
        .invoke("openExternal", { url: selectedRemote.url })
        .catch((e) => setError(codeError(e)));
  };
  async function showCommit(commit: CodeCommit) {
    setDetail({ commit, text: "Loading commit…" });
    try {
      const result = await bridge.invoke("gitCommit", {
        projectId: project.id,
        hash: commit.hash,
      });
      setDetail((current) =>
        current?.commit.hash === commit.hash
          ? {
              commit,
              text:
                result.diff + (result.truncated ? "\n… Diff truncated." : ""),
            }
          : current,
      );
    } catch (e) {
      setDetail((current) =>
        current?.commit.hash === commit.hash
          ? { commit, text: codeError(e) }
          : current,
      );
    }
  }
  const commitActions = (commit: CodeCommit): Action[] => [
    { label: "View commit", run: () => void showCommit(commit) },
    { label: "Copy commit SHA", run: () => copy(commit.hash) },
    { label: "Copy commit message", run: () => copy(commit.subject) },
    ...(selectedRemote?.url &&
    new URL(selectedRemote.url).hostname === "github.com"
      ? [
          {
            label: "Open commit on GitHub",
            run: () =>
              void bridge
                .invoke("openExternal", {
                  url: `${selectedRemote.url}/commit/${commit.hash}`,
                })
                .catch((e) => setError(codeError(e))),
          },
        ]
      : []),
  ];
  return (
    <section className="code-repository" aria-label="Git repository">
      <div className="code-repository-heading">
        <div>
          <h2>{onNewSession ? project.name : "Repository"}</h2>
          <p className="code-muted">{project.cwd}</p>
        </div>
        <TooltipButton
          aria-label="Refresh repository"
          disabled={busy}
          onClick={() => void load()}
        >
          <ArrowClockwise size={17} />
        </TooltipButton>
        {onNewSession && (
          <Button onClick={onNewSession}>
            <Plus size={16} />
            New session
          </Button>
        )}
      </div>
      {error && (
        <p role="alert" className="code-form-error">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="code-muted">
          {notice}
        </p>
      )}
      {!repo && (
        <p className="code-muted">
          {busy ? "Reading repository…" : "Repository could not load."}
        </p>
      )}
      {repo && !repo.isRepository && (
        <p className="code-muted">
          This folder is not a Git repository. Files and coding sessions are
          still available.
        </p>
      )}
      {repo?.isRepository && (
        <>
          <div className="code-repository-summary">
            <ItemMenu
              actions={[
                {
                  label: "Copy branch name",
                  disabled: !repo.branch,
                  run: () => copy(repo.branch || ""),
                },
                {
                  label: "Copy commit SHA",
                  disabled: !repo.head,
                  run: () => copy(repo.head || ""),
                },
              ]}
            >
              <span className="code-repository-branch">
                <GitBranch size={18} />
                {repo.branch ||
                  `Detached HEAD · ${repo.head?.slice(0, 8) || "No commits"}`}
              </span>
            </ItemMenu>
            <span>
              {repo.changes?.length || 0}
              {repo.changesTruncated ? "+" : ""} changed {repo.changes?.length === 1 ? "file" : "files"}
            </span>
            {repo.upstream ? (
              <span>
                {repo.ahead} ahead · {repo.behind} behind {repo.upstream}
              </span>
            ) : (
              <span>No upstream branch</span>
            )}
          </div>
          {!!repo.remotes?.length ? (
            <div className="code-repository-remotes">
              <SelectField
                label="Git remote"
                value={remote}
                onValueChange={setRemote}
                options={repo.remotes.map((r) => ({
                  value: r.name,
                  label: r.name,
                }))}
              />
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => void fetchRemote()}
              >
                {busy ? "Working…" : "Fetch remote"}
              </Button>
              {selectedRemote?.url && (
                <Button variant="ghost" onClick={openRemote}>
                  <ArrowSquareOut size={16} />
                  Open repository
                </Button>
              )}
              <small>
                {repo.lastFetch
                  ? `Last fetched ${new Date(repo.lastFetch).toLocaleString()}`
                  : "Remote has not been fetched here."}
              </small>
            </div>
          ) : (
            <p className="code-muted">No remote configured.</p>
          )}
          <p className="code-repository-note">
            History below is from this checkout. Fetch updates remote branches
            without merging or changing your files.
          </p>
          {!!repo.changes?.length && (
            <details className="code-repository-changes">
              <summary>Working changes ({repo.changes.length})</summary>
              {repo.changes.map((change) => (
                <ItemMenu
                  key={change.path}
                  actions={[
                    {
                      label: "Copy relative path",
                      run: () => copy(change.path),
                    },
                  ]}
                >
                  <div>
                    <code>
                      {change.untracked ? "??" : change.index + change.worktree}
                    </code>{" "}
                    {change.path}
                  </div>
                </ItemMenu>
              ))}
            </details>
          )}
          <h3>Recent commits</h3>
          {!repo.commits?.length && (
            <p className="code-muted">No commits yet.</p>
          )}
          {repo.commits?.map((commit) => (
            <ItemMenu key={commit.hash} actions={commitActions(commit)}>
              <div className="code-commit-row">
                <button onClick={() => void showCommit(commit)}>
                  <strong>{commit.subject}</strong>
                  <small>
                    {commit.shortHash} · {commit.author} ·{" "}
                    {new Date(commit.date).toLocaleString()}
                  </small>
                </button>
                <MoreMenu
                  label={`Actions for commit ${commit.shortHash}`}
                  actions={commitActions(commit)}
                />
              </div>
            </ItemMenu>
          ))}
          {repo.hasMore && (
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => void load(true)}
            >
              Load older commits
            </Button>
          )}
        </>
      )}
      <Dialog
        open={!!detail}
        onOpenChange={(open) => {
          if (!open) setDetail(null);
        }}
      >
        <DialogContent className="code-commit-dialog">
          <DialogTitle>{detail?.commit.subject}</DialogTitle>
          <DialogDescription>{detail?.commit.hash}</DialogDescription>
          <pre>{detail?.text}</pre>
        </DialogContent>
      </Dialog>
    </section>
  );
}
