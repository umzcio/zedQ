import { memo, useCallback, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Button, Textarea, TooltipButton, Input } from "@zq/ui";
import { ArrowUp, Stop, Check, CaretDown } from "@phosphor-icons/react";
import { useHost, type CodeSession, type CodeEvent } from "@zq/module-api";
import { mergeEvents, canWrite, stateLabel } from "./session-model";

function Permission({
  event,
  session,
  onError,
}: {
  event: CodeEvent;
  session: CodeSession;
  onError: (message: string) => void;
}) {
  const bridge = useHost().services.code,
    [busy, setBusy] = useState(false),
    [answers, setAnswers] = useState<Record<string, string>>({});
  const questions = Array.isArray(event.input?.questions)
    ? (event.input.questions as {
        id?: string;
        isSecret?: boolean;
        question?: string;
        header?: string;
        options?: { label: string; description?: string }[];
        multiSelect?: boolean;
      }[])
    : [];
  async function respond(allow: boolean, optionId?: string) {
    if (!event.requestId) return;
    setBusy(true);
    try {
      await bridge.invoke("respondPermission", {
        id: session.id,
        requestId: event.requestId,
        allow,
        ...(optionId ? {answers: {optionId}} : questions.length ? { answers } : {}),
      });
    } catch (error) {
      onError(String(error instanceof Error ? error.message : error));
    } finally {
      setBusy(false);
    }
  }
  if (event.resolved)
    return (
      <details className="code-resolved">
        <summary>
          <Check size={14} />
          Answered <CaretDown size={12} />
        </summary>
        <p>{event.text}</p>
      </details>
    );
  return (
    <section
      className="code-permission"
      aria-label={
        questions.length ? "Agent needs your input" : "Tool permission"
      }
    >
      <strong>
        {questions.length
          ? "Agent needs your input"
          : event.toolName || "Permission requested"}
      </strong>
      <p>{event.text}</p>
      {questions.length
        ? questions.map((question, index) => {
            const key = question.id || question.question || question.header || String(index);
            return (
              <fieldset key={key}>
                <legend>{question.question}</legend>
                {question.options?.map((option) => (
                  <label key={option.label}>
                    <input
                      type={question.multiSelect ? "checkbox" : "radio"}
                      name={key}
                      checked={(answers[key] || "")
                        .split(", ")
                        .includes(option.label)}
                      onChange={(e) =>
                        setAnswers((old) => ({
                          ...old,
                          [key]: question.multiSelect
                            ? (e.target.checked
                                ? [
                                    ...(old[key] || "")
                                      .split(", ")
                                      .filter(Boolean),
                                    option.label,
                                  ]
                                : (old[key] || "")
                                    .split(", ")
                                    .filter((value) => value !== option.label)
                              ).join(", ")
                            : option.label,
                        }))
                      }
                    />
                    <span>
                      {option.label}
                      {option.description && (
                        <small>{option.description}</small>
                      )}
                    </span>
                  </label>
                ))}
                <Input
                  aria-label={`Answer: ${key}`}
                  type={question.isSecret ? "password" : "text"}
                  placeholder="Or enter an answer"
                  value={answers[key] || ""}
                  onChange={(e) =>
                    setAnswers((old) => ({ ...old, [key]: e.target.value }))
                  }
                />
              </fieldset>
            );
          })
        : event.input && (
            <details>
              <summary>Review action</summary>
              <pre>{JSON.stringify(event.input, null, 2)}</pre>
            </details>
          )}
      {session.adapter === 'kimi' && Array.isArray(event.input?.options) ? <div className="code-actions">
        {(event.input.options as {optionId:string;name:string;kind:string}[]).map(option => <Button key={option.optionId} variant={option.kind.startsWith('reject') ? 'ghost' : 'default'} disabled={busy || !canWrite(session)} onClick={() => void respond(option.kind.startsWith('allow'), option.optionId)}>{option.name}</Button>)}
      </div> : <div className="code-actions">
        <Button
          variant="ghost"
          disabled={busy || !canWrite(session)}
          onClick={() => void respond(false)}
        >
          Decline
        </Button>
        <Button
          disabled={
            busy ||
            !canWrite(session) ||
            (questions.length > 0 &&
              questions.some((q) => !answers[q.id || q.question || q.header || ""]))
          }
          onClick={() => void respond(true)}
        >
          {questions.length ? "Submit answer" : "Allow once"}
        </Button>
      </div>}
    </section>
  );
}
// Completed Markdown is parsed once, independent of polling, typing, and
// session status updates. Only the event receiving streamed text re-renders.
const TranscriptEvent = memo(function TranscriptEvent({event, session, onError}: {
  event: CodeEvent; session: CodeSession; onError: (message: string) => void;
}) {
  const bridge = useHost().services.code;
  return (<div
            className={`code-event code-event-${event.kind}`}
            key={event.eventId || event.seq}
          >
            {event.kind === "permission" || event.kind === "question" ? (
              <Permission event={event} session={session} onError={onError} />
            ) : event.kind === "thinking" ? (
              <details><summary>Thinking</summary><p>{event.text}</p></details>
            ) : event.kind === "tool" ? (
              <details>
                <summary>{event.toolName || "Tool activity"}</summary>
                <p>{event.text}</p>
                {event.input && (
                  <pre>{JSON.stringify(event.input, null, 2)}</pre>
                )}
              </details>
            ) : event.kind === "assistant" ? (
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  img: ({ alt }) => <span>{alt || "Image"}</span>,
                  a: ({ href, children }) => (
                    <a
                      href={href}
                      onClick={(e) => {
                        e.preventDefault();
                        if (href)
                          void bridge
                            .invoke("openExternal", { url: href })
                            .catch((error) => onError(error.message));
                      }}
                    >
                      {children}
                    </a>
                  ),
                }}
              >
                {event.text}
              </ReactMarkdown>
            ) : (
              <p>{event.text}</p>
            )}
          </div>);
}, (previous, next) => previous.event === next.event
  && previous.session.id === next.session.id
  && previous.session.adapter === next.session.adapter
  && canWrite(previous.session) === canWrite(next.session)
  && previous.onError === next.onError);

export function CodeChat({
  session,
  onError,
}: {
  session: CodeSession;
  onError: (message: string) => void;
}) {
  const agent = session.adapter === "kimi" ? "Kimi" : session.adapter === "codex" ? "Codex" : "Claude";
  const host = useHost(),
    bridge = host.services.code,
    [events, setEvents] = useState<CodeEvent[]>([]),
    [draft, setDraft] = useState(
      () => localStorage.getItem(`zq.code.draft.${session.id}`) || "",
    ),
    [sending, setSending] = useState(false),
    [truncated, setTruncated] = useState(false),
    bottom = useRef<HTMLDivElement>(null),
    scroller = useRef<HTMLDivElement>(null),
    follow = useRef(true);
  const errors = useRef(onError);
  errors.current = onError;
  const reportError = useCallback((message: string) => errors.current(message), []);
  useEffect(() => {
    let disposed = false,
      after = 0,
      timer: ReturnType<typeof setTimeout>;
    setEvents([]);
    setTruncated(false);
    follow.current = true;
    const poll = async () => {
      try {
        const page = await bridge.invoke("events", { id: session.id, after });
        if (disposed) return;
        after = page.seq;
        if (page.events.length || page.truncated)
          setEvents((old) => mergeEvents(old, page.events, page.truncated));
        if (page.truncated) setTruncated(true);
      } catch (error) {
        if (!disposed)
          errors.current(
            error instanceof Error ? error.message : String(error),
          );
      } finally {
        if (!disposed) timer = setTimeout(poll, 600);
      }
    };
    void poll();
    return () => {
      disposed = true;
      clearTimeout(timer);
    };
  }, [bridge, session.id, session.revision]);
  useEffect(() => {
    if (follow.current) bottom.current?.scrollIntoView({ block: "end" });
  }, [events, session.state]);
  useEffect(() => {
    if (draft.trim())
      localStorage.setItem(`zq.code.draft.${session.id}`, draft);
    else localStorage.removeItem(`zq.code.draft.${session.id}`);
  }, [session.id, draft]);
  async function send() {
    if (!draft.trim() || sending || session.state !== "ready") return;
    const text = draft;
    setSending(true);
    try {
      await bridge.invoke("sendMessage", { id: session.id, text });
      setDraft("");
      localStorage.removeItem(`zq.code.draft.${session.id}`);
      follow.current = true;
    } catch (error) {
      onError(error instanceof Error ? error.message : String(error));
    } finally {
      setSending(false);
    }
  }
  return (
    <div className="code-chat">
      <div
        className="code-transcript"
        ref={scroller}
        onScroll={() => {
          const el = scroller.current;
          if (el)
            follow.current =
              el.scrollHeight - el.scrollTop - el.clientHeight < 100;
        }}
      >
        {truncated && (
          <p className="code-muted">
            Earlier activity is outside the display history. The native
            conversation is retained by the agent.
          </p>
        )}
        {!events.length && (
          <div className="code-chat-empty">
            <h2>What are we building?</h2>
            <p>{agent} works in this folder using its native configuration.</p>
          </div>
        )}
        {events.map((event) => (
          <TranscriptEvent key={event.eventId || event.seq} event={event} session={session} onError={reportError} />
        ))}
        {["starting", "busy", "switching"].includes(session.state) && (
          <div className="code-working" role="status">
            <span />
            {stateLabel(session)}…
          </div>
        )}
        <div ref={bottom} />
      </div>
      <form
        className="code-composer"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <Textarea
          aria-label={`Message ${agent}`}
          placeholder={
            session.state === "approval"
              ? `Answer ${agent}’s question above…`
              : `Ask ${agent} to work in this project…`
          }
          value={draft}
          disabled={!canWrite(session)}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (
              e.key === "Enter" &&
              !e.shiftKey &&
              !e.nativeEvent.isComposing
            ) {
              e.preventDefault();
              void send();
            }
          }}
        />
        <div>
          <span>Enter to send · Shift Enter for a new line</span>
          {["busy", "approval"].includes(session.state) ? (
            <TooltipButton
              type="button"
              aria-label={`Interrupt ${agent}`}
              onClick={() =>
                void bridge
                  .invoke("interruptSession", { id: session.id })
                  .catch((error) => onError(error.message))
              }
            >
              <Stop size={18} />
            </TooltipButton>
          ) : (
            <TooltipButton
              type="submit"
              aria-label="Send message"
              disabled={sending || !draft.trim() || session.state !== "ready"}
            >
              <ArrowUp size={19} />
            </TooltipButton>
          )}
        </div>
      </form>
    </div>
  );
}
