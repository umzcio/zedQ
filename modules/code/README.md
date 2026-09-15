# Code

Reserved module. Not implemented or shipped. Future implementation supplies index.tsx and a signed manifest targeting the shell API. Native capabilities must be added to the shell before a module may request them.

The internal Claude profile-handoff foundation is implemented under the desktop's native services. It constructs exact-conversation launches and coordinates exclusive controller replacement. It is not connected to a renderer or live Claude adapter yet.

The local persistent-session service is also implemented. A private tmux server owns the service and terminals independently of clients. Native clients can reconnect, read terminal snapshots and lifecycle events, and claim exclusive input ownership. This has been verified with synthetic processes, including service crashes and whole-client exit. Full terminal streaming, live Claude integration, external tmux discovery, SSH, and the visible Code module remain unshipped.

- [First-release design](../../plans/code/first-release-design.md)
- [Handoff foundation plan](../../docs/superpowers/plans/2026-09-15-code-handoff-foundation.md)
- [Validation and remaining gates](../../plans/code/handoff-validation.md)
- [Persistent service plan](../../docs/superpowers/plans/2026-09-15-code-session-service.md)
- [Persistent service validation](../../plans/code/session-service-validation.md)
