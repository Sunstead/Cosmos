# Releasing

Two things ship from this repo, independently:

| What | Trigger | Output |
|---|---|---|
| Desktop app | tag `app-v<version>` | Draft GitHub Release with macOS and Windows installers |
| Agent + web UI | push to `main`, or tag `v<version>` | `ghcr.io/sunstead/cosmos-agent` image |

## Desktop app

The version lives in `app/package.json` (`tauri.conf.json` reads it from
there) and `app/src-tauri/Cargo.toml`. Don't edit these by hand: the release
script keeps them in sync.

1. Merge your changes to `main` as usual.
2. From `app/` on an up-to-date, clean `main`:
   ```bash
   npm run release -- 0.2.0 --push
   ```
   This bumps the version, commits `Release app v0.2.0`, tags `app-v0.2.0` and
   pushes both. Leave off `--push` to check the commit first. The script prints
   the push command, and how to undo it.
3. The **App release** workflow builds:
   - `Cosmos_<version>_universal.dmg` (Apple Silicon and Intel)
   - `Cosmos_<version>_x64-setup.exe` and `Cosmos_<version>_x64_en-US.msi`

   It attaches them to a **draft** release. Review it on GitHub and press
   Publish.

Versions with a suffix (`0.3.0-beta.1`) are marked as pre-releases. The
script refuses a version that isn't newer, a tag that exists, a dirty tree, or
a branch other than `main`. The workflow refuses a tag that doesn't match
`package.json`.

If a build fails, fix it on `main` and release the next patch version. Don't
move a tag that's already pushed.

Pull requests that touch `app/src-tauri/` build both platforms without
releasing, and upload the installers as workflow artifacts for 7 days.

### Signing

Builds aren't notarised yet. The macOS app is ad-hoc signed, so first launch
needs right-click > Open (or System Settings > Privacy & Security > Open
Anyway). Windows SmartScreen shows "More info > Run anyway".

To remove those prompts later:
- **macOS:** an Apple Developer ID. Add `APPLE_CERTIFICATE`,
  `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY`, `APPLE_ID`,
  `APPLE_PASSWORD` and `APPLE_TEAM_ID` as repository secrets, and pass them to
  `tauri-action` as env.
- **Windows:** a code-signing certificate, configured under
  `bundle.windows` in `tauri.conf.json`.

## Agent

Every push to `main` that touches the agent, shared types or web UI publishes
`:latest` after the image smoke test passes. For a pinned version, tag
`v<version>` (e.g. `v0.3.0`), which also publishes `:0.3.0` and `:0.3`.
Watchtower on Jupiter pulls `:latest` at 04:00, or run
`docker compose pull cosmos-agent && docker compose up -d cosmos-agent`.
