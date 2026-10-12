# Releasing

Cosmos has one version for everything it ships: the agent, the web UI it
serves (Settings shows the version) and the desktop app. One command cuts a
release, and two tags from it build the two outputs:

| Tag | Workflow | Output |
|---|---|---|
| `v<version>` | Agent image | `ghcr.io/sunstead/cosmos-agent:<version>` and `:<major.minor>`, web UI included |
| `app-v<version>` | App release | Draft GitHub Release with macOS and Windows installers |

Pushes to `main` also publish the agent as `:latest`, but nothing runs that:
Jupiter pins a version.

## Cutting a release

The version lives in `app/package.json` (`tauri.conf.json` reads it from
there), `app/src-tauri/Cargo.toml`, `cosmos-agent/Cargo.toml` and
`cosmos-common/Cargo.toml`. Don't edit these by hand: the release script keeps
them in step.

1. Merge your changes to `main` as usual.
2. From `app/` on an up-to-date, clean `main`:
   ```bash
   npm run release -- 0.6.0 --push
   ```
   This sets the version everywhere, commits `Release v0.6.0`, tags `v0.6.0`
   and `app-v0.6.0`, and pushes all three. Leave off `--push` to check the
   commit first. The script prints the push command, and how to undo it.
3. The **Agent image** workflow publishes the image. The **App release**
   workflow builds:
   - `Cosmos_<version>_universal.dmg` (Apple Silicon and Intel)
   - `Cosmos_<version>_x64-setup.exe` and `Cosmos_<version>_x64_en-US.msi`

   It attaches them, with the signed update bundles and `latest.json`, to
   a **draft** release. Review it on GitHub and press Publish, as a full
   release: that ships it to every installed copy (see [Updates](#updates)).
4. Once the agent image run has passed, bump Jupiter: `compose/cosmos.yml` to
   the new version (a hand-made PR; Renovate is gone), in
   the same PR as any `cosmos-agent.toml` change the release needs. An agent
   refuses config it doesn't understand, so the image must exist first.
   Merging deploys it.

Versions with a suffix (`0.3.0-beta.1`) are marked as pre-releases, which
installed copies never update to. The
script refuses a version that isn't newer, a tag that exists, a dirty tree, or
a branch other than `main`. The workflow refuses a tag that doesn't match
`package.json`.

If a build fails, fix it on `main` and release the next patch version. Don't
move a tag that's already pushed.

Pull requests that touch `app/src-tauri/` build both platforms without
releasing, and upload the installers as workflow artifacts for 7 days.

## Updates

Installed desktop apps check for updates at launch and every six hours
(Settings > About, or **Check for App Updates…**) and install one when the
user says so. They read `latest.json` from the newest published full release
(`plugins.updater` in `tauri.conf.json`), so **pressing Publish ships the
release to everyone**; a draft or a pre-release never reaches them. Copies
from before 0.13.0 have no updater and are updated by hand once.

Tag builds sign the update bundles (`tauri.updater.conf.json` turns them on)
with the repository secrets `TAURI_SIGNING_PRIVATE_KEY` and
`TAURI_SIGNING_PRIVATE_KEY_PASSWORD`; the public half is the `pubkey` in
`tauri.conf.json`. Keep the private key and its password backed up outside
GitHub: without them no installed copy can ever be updated again, and a new
key means everyone reinstalls by hand. The key is Cosmos's own, not
Solstice's. To make one (from `app/`):

```bash
npm run tauri -- signer generate -w ~/.tauri/cosmos-updater.key
```

`releases/latest` is whichever full GitHub Release is newest, so the agent's
`v*` tags must never get a GitHub Release of their own (they're image-only),
or the app would look for `latest.json` there.

The web UI updates with its agent. A browser tab left open while its agent is
deployed offers a reload once the agent reports the newer version.

## Signing the desktop app

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
