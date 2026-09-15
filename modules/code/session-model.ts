import type { CodeEvent, CodeSession } from "@zq/module-api";

export function mergeEvents(
  previous: CodeEvent[],
  incoming: CodeEvent[],
  truncated = false,
): CodeEvent[] {
  const events = new Map(
    (truncated ? [] : previous).map((event) => [event.seq, event]),
  );
  for (const event of incoming) events.set(event.seq, event);
  const resolved = new Set(
    [...events.values()]
      .filter((event) => event.resolved && event.requestId)
      .map((event) => event.requestId),
  );
  return [...events.values()]
    .map((event) =>
      event.requestId && resolved.has(event.requestId)
        ? { ...event, resolved: true }
        : event,
    )
    .sort((a, b) => a.seq - b.seq)
    .slice(-2000);
}
export function canWrite(session: CodeSession | undefined) {
  return !!session && ["ready", "busy", "approval"].includes(session.state);
}
export function canSwitch(session: CodeSession | undefined) {
  return (
    !!session &&
    session.ownership !== "external" &&
    session.adapter !== "terminal" &&
    session.nativeIdVerified &&
    ["ready", "stopped", "recoverable", "limited", "error"].includes(
      session.state,
    )
  );
}
export function stateLabel(session: CodeSession) {
  return {
    starting: "Starting",
    ready: "Ready",
    busy: "Working",
    approval: "Needs your input",
    stopped: "Stopped",
    switching: "Switching",
    recoverable: "Needs attention",
    disconnected: "Disconnected",
    error: "Needs attention",
    limited: "Usage limit reached",
  }[session.state];
}
