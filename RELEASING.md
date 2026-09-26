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
`:latest` after the image smoke test passes. Nothing runs `:latest`, though:
Jupiter pins a version in `compose/cosmos.yml`, and an agent refuses a config
it doesn't understand, so each release is a tag plus a Jupiter PR.

1. On an up-to-date `main`, set `version` in `cosmos-agent/Cargo.toml`, run
   `cargo check -p cosmos-agent` so `Cargo.lock` follows, and commit
   `Release agent v<version>`.
2. Tag it and push both:
   ```bash
   git tag v0.5.0 && git push origin main v0.5.0
   ```
   The **Agent image** workflow publishes `:0.5.0` and `:0.5`.
3. Wait for that run to pass and the image to exist before touching Jupiter:
   ```bash
   docker manifest inspect ghcr.io/sunstead/cosmos-agent:0.5.0
   ```
4. In the Jupiter repo, bump the image in `compose/cosmos.yml` (Renovate opens
   this PR on its own, or do it by hand), in the same PR as any
   `cosmos-agent.toml` change the release needs. Merging deploys it.

The web UI is inside the agent image, so it ships with the agent. Only the
desktop app has its own tag and release, above.
