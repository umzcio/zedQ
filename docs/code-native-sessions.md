# Native agent sessions

Code 1.6.0 provides **Code → Sessions**, a shared browser for local Claude,
Codex and Kimi conversations, plus zQ’s saved local and SSH terminals. Search by
conversation or folder and filter by agent and host. Saved sessions appear
immediately; each native source loads independently. Shared native IDs appear
once, even when more than one account profile can see them.

Right-click a conversation to open Chat or Terminal, continue with an account
profile, or copy its native resume command, folder or ID. **New agent session**
chooses an agent, account, interface and folder. Plain terminals still use the
quick terminal action and ⌘T. Saved SSH sessions open through their existing host
connection; the browser does not scan remote native histories.

## Native adapters

- **Claude:** the published Agent SDK reads session metadata and reconstructs
  the native message chain. The installed CLI continues the original ID with
  its existing structured Chat protocol or native Terminal. Discovery currently
  reads the default Claude configuration directory, including profiles that
  share its history. Separate, unshared Claude history roots are not enumerated.
- **Codex:** the installed CLI’s app-server supplies thread listing, paginated
  history, resume, turns and native interaction requests. Each configured Codex
  account launcher discovers its own history. Terminal runs the same launcher
  with `resume <id>`. A target account’s access to the original thread is checked
  before stopping the current controller.
- **Kimi:** the installed CLI lists sessions and its ACP implementation loads
  history, continues turns and supplies permission/question requests. Terminal
  resumes the same native session ID. Custom Kimi account functions are not yet
  supported.

Native engines retain authentication, configuration, tools, skills and history.
Rendered history is never submitted as a new prompt. zQ’s saved events are a
bounded display cache, not a replacement transcript. Model selection comes
from the engine’s native configuration; Codex and Kimi models can be changed in
Terminal. Account profiles and models remain separate choices.

Changing Chat/Terminal stops the current controller gracefully, confirms its
owned process group has exited, and resumes the same native ID. A busy Chat turn
must finish or be interrupted first. Closing a tab or app detaches and leaves
the agent running. Stop the session before continuing it in another application.
No credentials are copied into zQ’s provider store.

## Boundaries

- Exit the same conversation in another desktop/CLI before opening it in zQ.
  Process checks catch detected native CLIs in the same folder but are not a
  universal cross-application lock. zQ never terminates outside processes.
- Native compaction may replace older turns with summaries. Chat shows retained
  context or recent activity and identifies display truncation. Native storage
  is never truncated or rewritten by the browser.
- Text, reasoning, tool activity and supported native approvals/questions render
  in Chat. Advanced native forms/media and provider-specific interactions are
  not all supported. Unsupported Codex requests explicitly direct the user to
  Terminal instead of silently approving them.
- Names and archive state in zQ are navigation metadata; they do not rename or
  delete original native conversations.
- A failed source leaves other histories and saved terminals available, with a
  source-specific diagnostic. Discovery is limited to 200 recent conversations
  per source; older sessions remain accessible through native tools.

## Validation

Installed native binaries run against loopback test models and disposable
configuration directories/workspaces. No normal workspace data or paid model
calls are used:

```sh
ZQ_TEST_CLAUDE_NATIVE=1 ZQ_TEST_CODEX_NATIVE=1 node --test apps/desktop/tests/code-claude-native.test.cjs apps/desktop/tests/code-codex-native.test.cjs
ZQ_TEST_KIMI_NATIVE=1 ZQ_TEST_KIMI_APP=1 ZQ_TEST_KIMI_PERF=1 node --test apps/desktop/tests/code-kimi-native.test.cjs
node --test apps/desktop/tests/code-codex-protocol.test.cjs apps/desktop/tests/code-kimi-performance.test.cjs
```

Round trips verify native CLI → Chat → native CLI history and identity; Codex
also switches account launchers and interfaces. Kimi covers a Terminal turn,
packaged picker/context menus, Chat input, themes, app reopen and long-history
rendering. Synthetic replay checks cover 1,600 messages: journal writes are
batched before readiness, while live permission/turn events remain durable.

Protocols: [Codex app-server](https://developers.openai.com/codex/app-server),
[Claude session SDK](https://code.claude.com/docs/en/agent-sdk/sessions),
[Kimi ACP](https://www.kimi.com/code/docs/en/kimi-code-cli/reference/kimi-acp).
