# Contributing to zQ

I started zQ to reduce the number of apps I needed. Contributions that make the workspace simpler, more reliable, and pleasant to use are welcome.

For a substantial feature or redesign, open an issue first so we can agree on how it fits. Small fixes can go straight to a pull request.

## Report a bug

Include your macOS version, app/module version, steps to reproduce, and what you expected to happen. Screenshots are useful for layout problems; include both light and dark mode when relevant. Remove API keys, private conversations, SSH addresses, and other personal information from logs and screenshots.

## Get set up

Follow the [README](README.md#run-the-desktop-app) for prerequisites, native dependencies, development signing keys, and build commands. The current packaged target is macOS on Apple Silicon.

Read [AGENTS.md](AGENTS.md) before changing code. It describes the product conventions and module boundaries that apply to all contributions, including AI-assisted ones.

Use a disposable workspace when testing changes that write data:

```sh
ZQ_DATA_DIR="$(mktemp -d /tmp/zq-contribution.XXXXXX)" npm run desktop
```

Quit the test app when finished. Launch normally afterward to return to your regular workspace. Never put test tasks, chats, files, or credentials into your everyday workspace.

## Keep changes focused

- Put feature UI and controllers in their module. The desktop shell owns native services and durable storage. Use `@zq/module-api` and `@zq/ui` rather than importing another module's implementation.
- Reuse the shared shadcn/Radix controls. Preserve keyboard navigation, focus restoration, Escape dismissal, context menus, and reduced-motion behavior.
- Inspect UI changes in the full app, in both themes and at different window sizes. For keyboard bugs, verify the actual keyboard path as well as automated events.
- Use standard skill, MCP, and supported plugin formats. See [interoperability](docs/interoperability.md).
- Keep credentials, signing keys, app data, generated bundles, screenshots from personal workspaces, and local experiments out of commits.

Native service or storage changes require a shell update. For independent module releases, follow the signing and compatibility checks in [the module guide](docs/modules.md).

## Verify your work

Run the relevant tests for your change, then the shared checks:

```sh
npm run typecheck
npm test
npm run test:ui
```

Use the feature-specific browser or packaged-app checks when changing user flows. Native document changes have additional checks documented in [the document helper guide](docs/document-helper.md). Tests that need optional runtimes or credentials may be skipped; report those limits rather than treating them as verified.

Add regression coverage for meaningful behavior changes. A small visual adjustment usually needs a visual check, not a test that repeats its CSS.

## Submit a pull request

Explain the problem, what changes for the user, and how you checked it. Link the related issue and include screenshots for visual changes. Call out storage migrations, compatibility requirements, and anything you could not verify.

Review AI-generated changes yourself. You are responsible for understanding and testing the code you submit. Keep unrelated refactors and generated files out of the PR.
