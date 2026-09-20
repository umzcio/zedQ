# Desktop app updates

The zQ menu → **Check for Updates…** and Settings → **Updates** share the native updater. Checks and downloads survive navigating away from Settings. Updates are checked manually, downloaded on request, and installed after the user confirms a restart. Module-only packages remain under Settings → Modules.

## Current distribution

The local `npm run pack` build is unsigned and intentionally has no update feed. It displays **Local build**, not “up to date.” Actual installation needs a signed release and a newer published version; this cannot be verified with only one unsigned local build.

The release configuration targets the private `umzcio/zedQ` GitHub repository. Each Mac uses its existing `gh auth login --hostname github.com` login with read access to that repository. No shared GitHub token is embedded in the bundle. Authentication is read in the native process only when checking; it is never sent to the renderer or logged. Do not use this private setup for public distribution.

## Build a release

1. Set a new desktop version in `apps/desktop/package.json` and update the npm lockfile. Release tags use `v<desktop-version>`.
2. Use the existing module signing identity (`ZQ_MODULE_SIGNING_KEY`), so independent module updates remain compatible. Keep it outside the repository.
3. Install a Developer ID Application certificate in the build Mac's Keychain. Set `CSC_NAME` to that identity. For a CI import, use electron-builder's `CSC_LINK` and `CSC_KEY_PASSWORD` secrets as well.
4. Configure electron-builder notarization credentials through `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, and `APPLE_TEAM_ID` (or its supported App Store Connect API-key credentials). Never put credentials in tracked configuration.
5. Run `npm ci`, the checks in CONTRIBUTING.md, and `npm run pack:release -w @zq/desktop`. This signs the native helpers with the same identity, preserving the document helper’s sandbox entitlements and caller requirement during outer app signing. It builds signed ARM64 DMG/ZIP artifacts in `apps/desktop/release-signed/`. `forceCodeSigning` makes missing signing fail the release build. This command does **not** publish.
6. Verify the outer app's signature with `codesign --verify --deep --strict` and Gatekeeper with `spctl --assess --type execute`; inspect signing identity and notarization. Ensure the packaged `app-update.yml` has the expected private repo and contains no token. Inspect `latest-mac.yml` and confirm ZIP/DMG names and hashes correspond to the built artifacts.
7. Create a GitHub release with the matching version tag, then upload `latest-mac.yml`, DMG, ZIP, and generated blockmaps. Keep it a draft until validation is complete. The updater only sees published stable releases. Publishing is a separate action from building.

## Validate before distribution

Use an isolated macOS user/workspace and two signed versions from the same identity. Install the older signed build, publish the newer release, then check → download → restart and install. Verify the version changed, drafts survived, modules still load, and app launch/Gatekeeper checks pass. Also test an inaccessible repository, failed download, offline check, signature mismatch, and cancelled restart/save failure.

The automated tests cover updater state transitions, deduplicated requests, manual download/install, error sanitization, local-build gating, and cancellation. UI checks use an isolated profile and simulated release responses; they do not constitute signed end-to-end installation validation.

On restart the existing close handshake flushes renderer drafts, stops voice, interrupts Chat/research work, and suspends connectors before invoking the installer. A cancelled close leaves the downloaded update ready. Code terminals retain their existing detach-on-close behavior. Automatic downloads and automatic install-on-quit are disabled.

References: [electron-builder v26 updater](https://www.electron.build/v26/docs/features/auto-update/) and [macOS signing](https://www.electron.build/v26/docs/mac/).
