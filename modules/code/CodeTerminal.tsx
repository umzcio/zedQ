import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  Input,
  TooltipButton,
} from "@zq/ui";
import { X, ArrowDown, ArrowUp, Plug } from "@phosphor-icons/react";
import { useHost, type CodeSession } from "@zq/module-api";
import "@xterm/xterm/css/xterm.css";
import { codeError } from "./errors";

export function CodeTerminal({
  session,
  focused = true,
}: {
  session: CodeSession;
  focused?: boolean;
}) {
  const host = useHost(),
    bridge = host.services.code,
    element = useRef<HTMLDivElement>(null),
    terminal = useRef<Terminal | null>(null),
    search = useRef<SearchAddon | null>(null),
    attachment = useRef<string | null>(null);
  const [query, setQuery] = useState(""),
    [error, setError] = useState(""),
    [finding, setFinding] = useState(false),
    [attached, setAttached] = useState(false),
    [generation, setGeneration] = useState(0);
  const focusRef = useRef(focused);
  focusRef.current = focused;
  useEffect(() => { if (focused) terminal.current?.focus(); }, [focused]);
  const active = !["switching", "stopped", "recoverable", "error", "disconnected"].includes(session.state);
  useEffect(() => {
    if (!element.current || !active) return;
    setError("");
    const attachmentId = crypto.randomUUID();
    attachment.current = attachmentId;
    let disposed = false,
      connected = false,
      exited = false,
      resizeTimer: ReturnType<typeof setTimeout> | undefined;
    const theme = () => {
      const style = getComputedStyle(element.current!);
      const dark = document.documentElement.dataset.theme === "dark";
      const background = style.getPropertyValue("--code-terminal-bg").trim() || (dark ? "#191919" : "#ffffff");
      const foreground = style.getPropertyValue("--code-terminal-fg").trim() || (dark ? "#e6e6e6" : "#303030");
      return {
        background,
        foreground,
        cursor: foreground,
        cursorAccent: background,
        selectionBackground: style.getPropertyValue("--selection").trim(),
      };
    };
    const term = new Terminal({
      fontFamily: '"SFMono-Regular", Menlo, Consolas, monospace',
      fontSize: 13,
      lineHeight: 1.25,
      scrollback: 5000,
      convertEol: false,
      cursorBlink: false,
      allowProposedApi: false,
      minimumContrastRatio: 4.5,
      theme: theme(),
    });
    const fit = new FitAddon(),
      finder = new SearchAddon();
    term.loadAddon(fit);
    term.loadAddon(finder);
    term.open(element.current);
    terminal.current = term;
    search.current = finder;
    fit.fit();
    const fail = (error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      if (disposed || message === "ATTACHMENT_SUPERSEDED") return;
      connected = false;
      setAttached(false);
      setError(codeError(error));
    };
    const stop = bridge.onTerminal((chunk) => {
      if (
        chunk.sessionId !== session.id ||
        chunk.attachmentId !== attachmentId ||
        disposed
      )
        return;
      if (chunk.reset) term.reset();
      term.write(chunk.data);
      if (chunk.exited) {
        exited = true;
        connected = false;
        setAttached(false);
        setError(chunk.exitCode ? "Terminal connection failed. Check the terminal output, then reconnect." : "Terminal connection closed.");
      }
    });
    const input = term.onData((data) => {
      if (connected)
        void bridge
          .invoke("writeTerminal", { id: session.id, data, attachmentId })
          .catch(fail);
    });
    term.attachCustomKeyEventHandler((event) => {
      if (
        (event.metaKey || event.ctrlKey) &&
        event.key === "f" &&
        event.type === "keydown"
      ) {
        setFinding(true);
        return false;
      }
      return true;
    });
    const observer = new ResizeObserver(() => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        if (disposed) return;
        fit.fit();
        if (connected)
          void bridge
            .invoke("resizeTerminal", {
              id: session.id,
              cols: term.cols,
              rows: term.rows,
              attachmentId,
            })
            .catch(fail);
      }, 60);
    });
    observer.observe(element.current);
    const appearance = new MutationObserver(() => {
      if (!disposed) term.options.theme = theme();
    });
    appearance.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "data-theme", "data-palette"],
    });
    void bridge
      .invoke("claimSession", { id: session.id })
      .then(() => {
        if (disposed) return;
        return bridge.invoke("attachTerminal", {
          id: session.id,
          cols: term.cols,
          rows: term.rows,
          attachmentId,
        });
      })
      .then(() => {
        if (disposed) {
          void bridge
            .invoke("detachTerminal", { id: session.id, attachmentId })
            .catch(() => {});
          return;
        }
        if (exited) return;
        connected = true;
        setAttached(true);
        if (focusRef.current) term.focus();
      })
      .catch(fail);
    return () => {
      disposed = true;
      connected = false;
      setAttached(false);
      clearTimeout(resizeTimer);
      stop();
      input.dispose();
      observer.disconnect();
      appearance.disconnect();
      term.dispose();
      terminal.current = null;
      void bridge
        .invoke("detachTerminal", { id: session.id, attachmentId })
        .catch(() => {});
    };
  }, [bridge, session.id, generation, active]);
  const copy = () => {
    const text = terminal.current?.getSelection();
    if (text) void host.services.clipboard.writeText(text);
  };
  const paste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      terminal.current?.paste(text);
    } catch {
      setError("Use ⌘V to paste into the terminal.");
    }
  };
  return (
    <div className="code-terminal-wrap">
      {finding && (
        <div className="code-terminal-find">
          <Input
            autoFocus
            aria-label="Find in terminal"
            placeholder="Find in terminal"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              search.current?.findNext(event.target.value);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") search.current?.findNext(query);
              if (event.key === "Escape") setFinding(false);
            }}
          />
          <TooltipButton
            aria-label="Previous match"
            onClick={() => search.current?.findPrevious(query)}
          >
            <ArrowUp size={16} />
          </TooltipButton>
          <TooltipButton
            aria-label="Next match"
            onClick={() => search.current?.findNext(query)}
          >
            <ArrowDown size={16} />
          </TooltipButton>
          <TooltipButton
            aria-label="Close terminal search"
            onClick={() => setFinding(false)}
          >
            <X size={16} />
          </TooltipButton>
        </div>
      )}
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div className="code-terminal" ref={element} />
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem onSelect={copy}>Copy selection</ContextMenuItem>
          <ContextMenuItem onSelect={() => void paste()}>Paste</ContextMenuItem>
          <ContextMenuItem onSelect={() => setFinding(true)}>
            Find
          </ContextMenuItem>
          <ContextMenuItem onSelect={() => terminal.current?.clear()}>
            Clear visible buffer
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem
            onSelect={() =>
              void bridge
                .invoke("detachTerminal", {
                  id: session.id,
                  attachmentId: attachment.current || undefined,
                })
                .then(() => setAttached(false))
                .catch((error) => setError(codeError(error)))
            }
          >
            Detach
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
      {!attached && active && (
        <div className="code-terminal-reconnect">
          <span role={error ? "alert" : undefined}>{error || "Terminal detached"}</span>
          <button onClick={() => setGeneration((n) => n + 1)}>
            <Plug size={14} />
            Reconnect
          </button>
        </div>
      )}
    </div>
  );
}
