# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

Cosmos is a homelab dashboard. A Cargo workspace holds three crates, plus a React frontend inside the Tauri crate's parent directory:

- `cosmos-agent` — axum server that runs on each node (port 7700). Host metrics (sysinfo), Docker containers/volumes (bollard), metrics history (SQLite), restic backup status.
- `cosmos-common` — shared serde types, exported to TypeScript via `ts-rs`.
- `app/src-tauri` — Tauri 2 shell around the frontend; also targets Android (`gen/android`).
- `app/` — Vite + React 19 + TypeScript (Tailwind v4, shadcn/Radix, TanStack Router/Query/Table, zustand, recharts).

## Commands

Rust (from repo root):
```bash
cargo test -p cosmos-common                      # ALSO regenerates the TS bindings
cargo test --workspace
cargo clippy --workspace --all-targets           # expected to be warning-free
COSMOS_AGENT_ALLOW_ANONYMOUS=true COSMOS_AGENT_BIND=127.0.0.1:7700 cargo run -p cosmos-agent   # dev: no sign-in
cargo build --profile release-agent -p cosmos-agent
```

Frontend (from `app/`):
```bash
npm run dev                        # Vite on :1420 (browser build)
npm run tauri dev                  # desktop app
npm run build                      # tsc && vite build
npm run lint                       # 0 errors expected; ui/ is vendored and exempt
npm test                           # vitest + jsdom + Testing Library
npx vitest run src/lib/lib.test.ts # single file
npm run test:e2e                   # Playwright, see below
npm run release -- 0.6.0 [--push]  # agent, web UI and desktop app together; see RELEASING.md
```

`npm run test:e2e` builds and starts a real `cosmos-agent` (random port, temp
history DB, a fake `tailscaled` and a mock OIDC provider in `e2e/mock-oidc.ts`,
so every spec signs in for real) and Vite on :1431, then drives system Chrome
(`PW_CHANNEL` overrides). Docker-dependent specs skip when no daemon is up.
Screenshots of every page in both themes land in `app/e2e/.results/`.

Agent container (agent + bundled web UI):
```bash
docker build -f cosmos-agent/Dockerfile -t cosmos-agent .   # build from the REPO ROOT
```
`.github/workflows/agent-image.yml` publishes `ghcr.io/sunstead/cosmos-agent`
(linux/amd64): `:latest` from `main`, semver tags from `v*`. `ci.yml` runs the
agent/common tests, clippy (`-D warnings`) and the frontend lint/test/build;
the Tauri crate is skipped in CI because it needs WebKitGTK. `app-release.yml`
builds the desktop app (universal macOS dmg, Windows msi/exe) on `app-v*` tags
into a draft release. **One version covers the agent, web UI and desktop app**:
`app/package.json` (which `tauri.conf.json` references and Settings shows),
the Tauri, agent and common `Cargo.toml`s, all set by `app/scripts/release.mjs`,
which tags `v<version>` (agent image) and `app-v<version>` (desktop) together.

## Type sharing (Rust → TS)

Types live in `cosmos-common/src/types/` (`host`, `docker`, `history`, `backups`, `meta`, `error`), flat-re-exported from `types/mod.rs`. Each derives `ts_rs::TS` with `#[ts(export, export_to = "../../app/src/generated/")]`.

Two things to know:

- **`export_to` resolves against `cosmos-common/bindings/`, not the source file.** That's why every module uses the identical path string, and why the types can be reorganised freely.
- **64-bit integers carry `#[ts(type = "number")]`.** ts-rs maps `u64`/`i64` to `bigint`, but serde writes plain JSON numbers and `JSON.parse` yields `number` — without the annotation the generated type never matches the value at runtime. Every such field here is a byte count, timestamp or counter, all far below `Number.MAX_SAFE_INTEGER`.

`app/src/generated/` is gitignored, so **a fresh clone has no types until you run `cargo test -p cosmos-common`** — `npm run build` fails until you do.

**Units on the wire are raw: bytes and bytes/second.** Formatting belongs in `app/src/lib/node-metrics.ts`. The pre-0.2 format mixed MB/s for disk with megabits/s for network in one struct.

## Agent architecture

**The one rule: sample on a schedule, never on the request path.**

Background samplers publish to `tokio::sync::watch` channels; handlers hand out the latest value, already serialized. A request does no collection, no serde and takes no locks — `/v1/host` is ~0.3 ms.

- `sample/host.rs` — `HostProbe` owns persistent `System`/`Disks`/`Networks`, refreshed in place, on a dedicated OS thread (sysinfo does blocking `/proc` reads, and the loop owns `&mut System` for its lifetime). It exclusively owns `prev_net`/`prev_disk`, which is why rate deltas are correct with any number of clients. Absolute-deadline scheduling avoids drift and catch-up bursts. The one `MINIMUM_CPU_UPDATE_INTERVAL` sleep happens once at startup.
- `sample/docker.rs` — `DockerProbe` computes container CPU % by differencing absolute counters across *our own* ticks (`one_shot: true` zeroes `precpu_stats`, so differencing against those is meaningless). `started_at` is cached against state transitions, so steady state costs zero inspect calls. `stats` calls are bounded by `buffer_unordered`.
- `sample/mod.rs` — spawns everything. Host 1 s, containers 2 s, volumes 60 s, backups 30 s. The Docker event watcher and the action handlers poke each sampler's own `Notify` (volume events and container create/destroy wake volumes too, since `in_use_by` changes) so lists refresh immediately. Pokes use `notify_one`, which stores a permit: `notify_waiters` lost any poke that landed mid-sample. Containers and volumes both stream (`/v1/volumes/stream`, `volume_stream` capability); older agents' volumes are polled every 30 s.
- `watch` not `broadcast`: subscribers only want the newest sample, and `watch` coalesces by construction.
- Snapshots carry `json: Arc<str>` — serialization happens once per tick, not once per request per client.

**Routes.** `/healthz` and `/v1/info` are public; everything else needs a token; every mutating route sits behind `require_write`, which needs both the node's top-level `allow_actions` and an admin `Principal` (and logs one `action` line saying who). `docker.allow_actions` is a deprecated alias. `/v1/logs` and `/v1/logs/ws` (`all_logs` capability) merge every running container: the socket keeps each container's Docker stream in a `StreamMap`, adds containers that start later from the container snapshot's `running` IDs, and tags lines with `container`; the client orders the interleaved backlogs by timestamp (`compareLogTime`: Docker trims trailing fraction zeros, so the strings don't sort). Logs use a WebSocket (`/v1/containers/:id/logs/ws`) because Docker log frames contain embedded newlines, `EventSource` reconnects uncontrollably against crash-looping containers, and browsers cap ~6 HTTP/1.1 connections per origin.

`/v1/info` is unauthenticated so the add-node flow can distinguish "nothing here" from "needs a token", but `node_name` and `principal` stay `null` until authenticated. The app narrows capabilities by `principal.admin` in `effectiveCapabilities` (`api/client.ts`), so UI code only ever checks capabilities. A **404 there means a pre-0.2 agent** → assume `api_version: 0`.

**Auth** (`auth/`). Sign-in is OpenID Connect through Authentik; the shared token is gone (an old `auth.token`/`COSMOS_AGENT_TOKEN` config fails to start with an explanation). The app gets an access token (a JWT, ~10 min) and sends it as a bearer token, or as `?token=` for `EventSource`/`WebSocket`, which cannot set headers; the trace layer records `uri.path()` only so query tokens never reach the logs. `auth/oidc.rs` verifies offline against the provider's JWKS (asymmetric algorithms only, `iss`, `aud` = client ID, `exp` with 60 s leeway), caching keys by `kid` and refetching an unknown `kid` at most once a minute. An unreachable provider is **503, not 401**, so the app retries instead of re-prompting. `groups` ∩ `admin_groups` makes an admin; everyone else who can sign in is a viewer. Streams are checked when they open, not cut at expiry. `/v1/info` publishes the non-secret `auth` block (`issuer`, `client_id`, `scopes`) so the app can start sign-in before it has a token. **CORS must stay the outermost layer** — axum applies layers bottom-up, and an unauthenticated `OPTIONS` preflight that 401s without CORS headers surfaces as an opaque browser failure. The agent refuses to start with no provider unless `auth.allow_anonymous = true`.

**Sign-in, app side.** `stores/auth.ts` keeps one session per issuer (every node trusting it shares it), access tokens in memory, refreshed a minute before expiry with one refresh in flight per issuer. The browser build runs PKCE itself (`lib/oidc.ts`, `/auth/callback`) and keeps the refresh token in `localStorage`; Authentik only sends CORS headers to *strict* redirect URIs, which is why the web one is strict. The desktop app does the whole flow in Rust (`src-tauri/src/oidc.rs`, loopback redirect on a random port) so the refresh token goes from the provider to the keychain and never reaches the webview. `NodeConnection` takes a token provider, re-reads `/v1/info` with the token to learn the principal, refreshes once on a 401, and otherwise sits in `unauthorized` until a session for that issuer appears, when the node store retries it.

**Errors** (`error.rs`). Every handler returns `Result<T, AgentError>` rendering `ApiError { code, message, detail }`. The `not_enabled` (501, hide the feature) vs `unavailable`/`docker_unavailable` (503, retry) split is load-bearing for the UI. `/v1/containers` returns 503 when Docker is down — never an empty list.

**History** (`history/`). SQLite, WAL + `synchronous = NORMAL` + `temp_store = MEMORY` (the last is required for `read_only: true` containers). Tiers: `metrics_1s` (1 h), `metrics_1m` (7 d), `metrics_5m` (90 d), each rolled-up tier carrying avg *and* max. A writer thread batches one transaction per 60 rows or 10 s; the sampler's `push` is `try_send` and drops rather than stalling the live stream. **Rollups only touch fully-closed buckets**, which makes them idempotent and crash-safe via a cursor in `meta`; retention never deletes rows the rollup hasn't consumed. `/v1/metrics` returns columnar parallel arrays (~4× smaller than row objects at 10k points).

**Tailnet** (`sample/tailnet.rs`). Polls `tailscaled`'s LocalAPI (`/localapi/v0/status`) over its unix socket every 10 s: raw HTTP/1.0, so the body ends at EOF and no HTTP client is needed. `tailscaled` authorises by peer uid and gives non-root, non-operator callers read-only access, so no API key and no write path. The snapshot keeps the parsed `TailnetStatus` as well as the JSON because Wake-on-LAN reads `online` from it. A device is matched to a Cosmos node when that node's agent reports it as `is_self`, never by hostname (`lib/tailnet.ts` `mergeTailnets`). The UI polls rather than streams; it's on the Network page and as the constellation's outer belt.

**Wake-on-LAN** (`wol.rs`, `sample/wol.rs`, `store.rs`). Targets are edited in the UI and stored in `state.db` (`[state] path`), a separate SQLite file from the history database, with `PRAGMA user_version` migrations that are append-only. One task owns the target list and in-flight wakes; handlers read its snapshot, or send it a command (`reload`, `waking`) and wait for it to republish, so a GET right after a write reflects it. "Up" comes from the linked tailnet device's `online`, else a TCP probe where a refusal counts as up. The state machine (`step`) is pure and tested with a fake clock; each wake's outcome is persisted. Packets need `SO_BROADCAST`, no capabilities. `/v1/wol/neighbors` reads `/proc/net/arp` on request (admin only, rare), the one deliberate exception to "never on the request path".

**Event log** (`events/`). An append-only `events` table in `state.db`, plus the `problems` open now. Detectors only *report*: `Event` (happened once), `Open(problem)` (true now, repeat freely), `Resolve(key)` (seen clear). One task owns the open set and writes rows, so repeats are free and a problem opened before a restart stays open until its detector sees the good condition; that is also where hysteresis comes from (disks warn at 85%, clear below 80%). Detectors are pure and tested with plain timestamps: `containers.rs` (Docker event stream forwarded by `spawn_event_watcher`, plus a 15 s tick over the typed container list), `backups.rs`, `disks.rs`, `lifecycle.rs` (version, boot time and a clean-stop marker written after SIGTERM, which is how a power cut shows up). **A `die` with no `kill` in the previous 30 s is one nobody asked for**: every intentional stop (Compose recreating on deploy, `docker stop`, Cosmos actions) sends `kill` first, which is what keeps a deploy from reading as a wave of crashes. Admin actions are recorded in the write handlers via `api::record_action`, with who. `GET /v1/events` reads SQLite (`after=` polls forward, `before=` pages back); the app polls rather than streams, because each node already holds three of the browser's ~6 HTTP/1.1 connections. Several snapshots (`ContainerSnapshot`, `HostSnapshot`, `BackupSnapshot`) keep typed data alongside their JSON for these detectors.

**Notifications** (`notify/`). Every stored event is broadcast; the notifier offers it to each channel (ntfy, webhook), which takes it when `rules::wants` (enabled, category, `min_severity`, `recoveries`) and the `FloodGuard` agree: a problem opens at most once per 30 min per channel (a held-back opening is delivered late if the problem is still open, so a flap that sticks isn't left looking resolved), and the same one-off event (one container crashing) at most once. Delivery is a task per message, three tries, no 4xx retry, then dropped: the log has it. Channels are edited in the app and stored in `state.db`; **the channel secret is write-only** (`has_secret` in the API, hidden from `Debug`), the agent's one stored credential. The notifier must subscribe before anything reports, or it misses the lifecycle events at startup.

**Uptime** (`uptime/`). One task owns the checks, like Wake-on-LAN's: every `cosmos.service` with a url label gets an HTTP check (`svc:<service>`, `https://` added as `serviceHref` does), and custom HTTP or TCP checks live in `state.db`, as do per-service settings (off, path, any status counts). A service's check only runs while one of its containers is running, and failures in the first 2 minutes after a container starts don't count, so a deliberate stop or a deploy never pages. Probes run in their own tasks and report back, so a slow target doesn't hold up a reload; creating or editing a check waits for its first result. HTTP doesn't follow redirects (a forward-auth 302 is up) and is up below 400. `[uptime] local_domains` resolves those names to 127.0.0.1 through a custom reqwest resolver: on Jupiter `*.jupiter.sunstead.net` points at the Tailscale IP, which the host can't reach, so checks go through Caddy on the host. `detector.rs` is pure: down after 3 failures in a row, up after 2 passes, and certificates (read from `tls_info` by the small DER walker in `cert.rs`, keyed by serial so a wildcard is one problem) warn in their last quarter and are an error under 3 days. Results are tallied per hour into `uptime_hourly` every 5 minutes (additive, kept 90 days) for the 24h/30d/90d figures; the newest 90 per check live in memory for the heartbeat bar, and outages themselves are in the event log.

**Updates** (`updates/`). The agent never edits compose or pushes: git stays the record of what runs. Every `check_interval_hours` it lists each image repository's tags anonymously (`registry.rs`: one flow for every registry, the 401 challenge then a pull token from its realm, `Link` pagination up to 50 pages since Immich has ~30k tags, and **never a manifest request**, which Docker Hub counts against the pull limit deploys need). `rules.rs` groups services into units (one image repository, or a `cosmos.update.group`) and applies the `cosmos.update.*` labels (off, group, hold, major-step, major-digits, backup; the stricter wins); `tags.rs` only offers tags of the same shape (`16.15-alpine` → `16.x-alpine`, never an rc). First sighting of each tag is stored (`update_seen`) for `min_age_days`. Applying one dispatches the infrastructure repo's `update.yml` (`github.rs`, a fine-grained token from `COSMOS_AGENT_GITHUB_TOKEN` only, hidden from `Debug`), which re-checks everything itself, backs up where labelled, commits and deploys. A run is stored at each step (queued → dispatched → running → watching → done / failed / broken) so it resumes after the deploy restarts the agent; one runs at a time. During the watch (`decide.rs`, pure) an uptime check going down or a container restarting marks it broken: a problem, and automatic updates for the unit pause until a policy is chosen again. Nothing rolls back on its own; a rollback is the same flow to the previous tag. Automatic updates are queued when the backup status shows a successful *timer* run (the timer fired just before it), so the nightly is the pre-update backup. `cosmos-agent --check-config <file>` lets the workflow try a new agent against the live config first.

**Backups** (`backups.rs`). The agent **does not run restic**. It reads a status JSON that `scripts/cosmos-backup-status.sh` writes on the host, so the repo password never enters a network-facing process and nothing can contend for the repository lock. `BackupsStatus.stale` and `timer_last_fired` exist to catch the case a snapshot list can't: a timer that fired but whose job died before writing status. **Requests** (0.7): "Back up now" and "Run test now" (`POST /v1/backups/run`, `backup_actions`) write `{id, kind, requested_by}` as `<id>.tmp` then rename it to `<id>.json` in `[backups] requests_dir`, the host's inbox mounted writable; a host service (Jupiter's `request-dispatch.sh`, started by a systemd `.path` unit) starts the matching unit and writes a result per request into `request_results_dir`. The sampler lists queued files and results as `requests`, and polls every 2 s while one is queued or running. The state-only `backup_state` kind is for updates and refused on this route. The latest restore test comes from `restore_test_file` (path-free messages); a failed one opens `backup:restore_test`, and none for 15 days a warning. The restore guide in the app only generates commands for the host's `scripts/restore.sh` (`lib/restore.ts`), using the `databases` the status file lists; nothing restores from Cosmos.

## Deployment

Production is the Jupiter repo (`InventorPWB/Jupiter`, usually checked out
beside this one), where a push to `main` deploys. It pins the agent to a
semver tag, and Renovate opens the bump PR once a `v*` tag has published.
An agent refuses config it doesn't understand, so a release that changes
`agent.toml` needs its image published before the Jupiter PR that uses it
merges.

`cosmos-agent/compose.example.yaml` and `agent.example.toml`. Two things are easy to get wrong:

- **`network_mode: host` is required, not optional.** `/proc/net/dev` renders from the reading process's network namespace and sysinfo has no `HOST_PROC` escape hatch, so without it the agent reports the container's veth. Consequence: `ports:` does not apply, and `[host] net_exclude` becomes load-bearing.
- **`:ro` on `docker.sock` is not a security control** — it applies to the inode, not the protocol. Anyone who can `connect()` has the full Docker API, which is root-equivalent. The real controls are `allow_actions = false` and network isolation.

Disks (`sample/filters.rs`): in a container, the `[[host.disks]]` entry labelled `/` (or `[host] root`) says where the host root is mounted. The `/:/host/rootfs:ro,rslave` bind is recursive, so every other drive is discovered under it and reported by its host path; listing only the root used to hide them (a 2TB `/srv` never showed). Virtual filesystems, container storage and boot partitions are skipped, and mounts sharing a device are counted once (`pool_key`: the APFS container on macOS, the device path on Linux).

**Web UI from the agent.** The image sets `COSMOS_AGENT_WEB_DIR`, and
`api/web.rs` serves `app/dist` as a public fallback after the API routes:
SPA fallback to `index.html`, 404 for unknown `/v1/*` and missing `/assets/*`,
immutable caching for hashed assets. `/config.json` returns `[{"url":"/"}]`,
which the frontend resolves to its own origin; a seeded node that needs a token
opens Add node prefilled. Same origin, so no CORS entry is needed.

Workspace `[profile.release-agent]` adds `panic = "abort"`; it is deliberately *not* in `[profile.release]`, which would also apply to `app/src-tauri` where Tauri uses `catch_unwind`.

## Frontend architecture

The app talks directly to agents from the webview; no Tauri IPC for data.

**One connection per node, owned by the store.** `api/connection.ts`
`NodeConnection` owns an agent's host stream, container stream, volume polling,
capability negotiation, backoff reconnect and status (`connecting | online |
offline | unauthorized`). Connections live in a `Map` outside React state
(`stores/nodes.ts`), so navigation never tears a stream down. EventSource gives
up permanently on a non-2xx and never exposes the status, so `connect()` probes
with `getHost()` first and reconnects explicitly.

**The node store must not churn.** `NodeConfig` is `{ id, url, agentName,
alias }`; display name is `alias ?? agentName ?? url` (`nodeDisplayName`,
`useNodeName`). `attach()` compares against *current* state and writes only on
a real change. A per-sample write re-renders the sidebar and every page and
rebuilds the constellation (the old "flash" bug; there's a regression test).

**Keep 1 Hz data out of React.** `<LiveValue>` and `<Sparkline>` subscribe to
the stream and write through refs inside a shared animation frame
(`lib/frame-scheduler.ts`), fed by ring buffers (`lib/ring-buffer.ts`,
`stores/metrics-history.ts`). `useHostInfo` re-renders every second; use it
only where the whole view changes. Recharts is only on `/monitoring`, which is
lazy-loaded.

**Adding an endpoint:** type in `cosmos-common` → route + module in
`cosmos-agent` → method on `AgentClient` → subscription in `NodeConnection` or
hook in `queries.ts` → store/page. Gate the UI on the `capabilities` flag so
older agents degrade instead of erroring.

**Service model.** Services come from the `cosmos.service` Docker label,
grouped per node in `lib/services.ts`. `cosmos.service: system` marks
infrastructure (filtered by `userFacingServices()`). `cosmos.service.url` holds
bare hostnames; always route them through `serviceHref()`.

**Nodes bootstrap.** `router.tsx` root `beforeLoad` seeds from `config.ts`
(nothing under Tauri; `/config.json` in a browser). `onRehydrateStorage` runs
*during* `create()`, so it seeds through the draft and defers `attach()` to a
microtask.

## UI conventions

**Shell.** `layouts/AppLayout.tsx` mounts the title bar, sidebar, command
palette, add-node dialog and `CommandHost` (shortcuts + native menu events).
Routes are lazy (`lazyRouteComponent`) and pick a layout through
`staticData.layout`: `scroll` (default) or `fill` (logs). The body never
scrolls; `<main>` does. Content is a `@container`, so layouts use container
queries (`@xl`, `@3xl`, `@5xl`), not viewport breakpoints.

**Pages are built from shared primitives**, not bespoke markup:
`PageHeader` (always rendered, even when empty; the row is `h-8` and every
header control is `h-8` so titles align), `SegmentedControl`, `SearchInput`
(`/` focuses it), `NodeSelect`, `StatCard`/`StatRow`, `Section`, `DataTable`,
`EmptyState` (`page | card | inline`) with an optional `SetupHint` (`?`
popover holding the config snippet), and sonner toasts. Use shadcn components
(`components/ui/`, generated by the CLI and lint-exempt) before writing new
ones. An e2e spec checks header height and title position on every page.

**Copy.** Short, sentence case, no em dashes or curly quotes. An ESLint rule
rejects them in JSX text and string literals under `pages/` and
`components/`. Missing values render as `NO_VALUE` (`n/a`).

**Tokens.** Everything is themed through CSS variables in `App.css`, defined
for both themes: semantic colours, `--text-2xs`, `--titlebar-height`,
`--titlebar-inset`, and canvas tokens (`--space`, `--star`, `--orbit`,
`--planet-*`). Canvas code never uses literal colours; it reads them through
`lib/theme-tokens.ts`, which caches per theme and fires `onThemeChange`.
`.glass` is applied deliberately, `.label-hud` is the small-caps label, and
`.chrome` disables text selection on UI chrome (content stays selectable).
Container log colours go through `lib/ansi.ts` (`--ansi-0..15` tokens); other
escapes and control characters are stripped, and search/download use
`stripAnsi`. Never colour a log line by stream: lots of healthy software
writes everything to stderr. `logLevel` (`lib/log-line.ts`) reads the level
the line states; times render in the viewer's zone via `formatLogTime`
(Docker's nanosecond stamps are cut to ms first, since WebKit's `Date.parse`
has rejected longer fractions).

**Loading.** Until a node sends its first containers or volumes, a page shows
skeletons (`components/skeletons.tsx`, `DataTable loading`), never an empty
state that isn't true. `useAwaiting(byNode)` says when: some connecting or
online node has no entry yet, capped at `AWAIT_MS` so a node that never
answers falls back to the real empty state.

**Planets.** `lib/planet.ts` gives each node name a deterministic style
(presets for jupiter, saturn, mars, etc.; seeded otherwise).
`lib/planet-render.ts` draws it and caches sprites. `NodePlanet` and the
constellation share that renderer. The constellation keeps bodies in a ref
`Map` reconciled by node id, runs one render loop capped at 30fps, pauses
off-screen and draws a static frame under reduced motion.

**Platforms.** Tauri builds the window in Rust (`src-tauri/src/window.rs`),
not `tauri.conf.json`. An init script sets `window.__COSMOS_PLATFORM__`;
`main.tsx` copies it to `html[data-platform]` (`macos | windows | linux |
web`) before render. macOS: overlay title bar, traffic lights positioned by
`TRAFFIC_LIGHTS`, a native menu (must keep the Edit items or ⌘C/⌘V break in
inputs) that emits `menu` events, and `CommandHost` skips its own keydown
handling there to avoid double-firing. Windows/Linux: `decorations(false)` with
custom controls in `TitleBar`. The Rust side emits `window-state` (fullscreen,
maximized). Shortcuts live in `lib/shortcuts.ts` and feed the palette, key
hints and menu.

**Cosmos mark.** `app/scripts/build-mark.mjs` (`npm run build:mark`) turns the
two Inkscape sources (`icon_simple.svg` light ink, `icon_simple_dark.svg` dark
ink) into `public/favicon.svg`, which carries both palettes and switches on
`prefers-color-scheme` (browser chrome follows the OS, not the app theme), and
`src/assets/icon-mark.svg`, whose stops read `--mark-0`/`--mark-1` so the
inline copy follows the app theme. The inline one deliberately has no `<style>`
element: an inline SVG's stylesheet applies to the whole document.

**macOS icon.** `app/src/assets/app.icon` (Icon Composer) is the source.
`app/scripts/build-mac-icon.sh` compiles it to `src-tauri/icons/Assets.car`
(Liquid Glass, shipped via `bundle.macOS.files` and `CFBundleIconName` in
`src-tauri/Info.plist`) and a padded full-size `icon.icns` fallback. Both are
committed; re-run the script after editing the icon (needs Xcode 26+ and Icon
Composer). The glass icon only shows in a bundled build, not `tauri dev`.

## Gotchas worth knowing

- **SSE events must stay unnamed.** The agent emits `Event::default().data(..)`
  with no `.event(..)`. A named event is only delivered to a matching
  `addEventListener`, never to `EventSource.onmessage` — which looks like a
  perfectly healthy open stream that no handler ever sees.
- `npm run build` fails on a fresh clone until `cargo test -p cosmos-common`
  has generated `app/src/generated/`.
