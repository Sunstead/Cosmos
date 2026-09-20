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
COSMOS_AGENT_TOKEN=dev cargo run -p cosmos-agent
cargo build --profile release-agent -p cosmos-agent
```

Frontend (from `app/`):
```bash
npm run dev                        # Vite on :1420 (browser build)
npm run tauri dev                  # desktop app
npm run build                      # tsc && vite build
npm run lint                       # expected clean; ui/ is vendored and exempt
npm test                           # vitest, pure logic only
```

Agent container:
```bash
docker build -f cosmos-agent/Dockerfile -t cosmos-agent:0.2.0 .   # build from the REPO ROOT
```

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
- `sample/mod.rs` — spawns everything. Host 1 s, containers 2 s, volumes 60 s, backups 30 s. A Docker event watcher pokes a `Notify` so the container list refreshes immediately after an action.
- `watch` not `broadcast`: subscribers only want the newest sample, and `watch` coalesces by construction.
- Snapshots carry `json: Arc<str>` — serialization happens once per tick, not once per request per client.

**Routes.** `/healthz` and `/v1/info` are public; everything else needs a token; `POST/DELETE /v1/containers/*` additionally needs `docker.allow_actions`. Logs use a WebSocket (`/v1/containers/:id/logs/ws`) because Docker log frames contain embedded newlines, `EventSource` reconnects uncontrollably against crash-looping containers, and browsers cap ~6 HTTP/1.1 connections per origin.

`/v1/info` is unauthenticated so the add-node flow can distinguish "nothing here" from "needs a token", but `node_name` stays `null` until authenticated. A **404 there means a pre-0.2 agent** → assume `api_version: 0`.

**Auth** (`auth.rs`). Constant-time bearer compare; accepts the `Authorization` header or `?token=` (browser `EventSource`/`WebSocket` cannot set headers, and the web build is supported). The trace layer records `uri.path()` only so query tokens never reach the logs. **CORS must stay the outermost layer** — axum applies layers bottom-up, and an unauthenticated `OPTIONS` preflight that 401s without CORS headers surfaces as an opaque browser failure. The agent refuses to start with no token unless `auth.allow_anonymous = true`.

**Errors** (`error.rs`). Every handler returns `Result<T, AgentError>` rendering `ApiError { code, message, detail }`. The `not_enabled` (501, hide the feature) vs `unavailable`/`docker_unavailable` (503, retry) split is load-bearing for the UI. `/v1/containers` returns 503 when Docker is down — never an empty list.

**History** (`history/`). SQLite, WAL + `synchronous = NORMAL` + `temp_store = MEMORY` (the last is required for `read_only: true` containers). Tiers: `metrics_1s` (1 h), `metrics_1m` (7 d), `metrics_5m` (90 d), each rolled-up tier carrying avg *and* max. A writer thread batches one transaction per 60 rows or 10 s; the sampler's `push` is `try_send` and drops rather than stalling the live stream. **Rollups only touch fully-closed buckets**, which makes them idempotent and crash-safe via a cursor in `meta`; retention never deletes rows the rollup hasn't consumed. `/v1/metrics` returns columnar parallel arrays (~4× smaller than row objects at 10k points).

**Backups** (`backups.rs`). The agent **does not run restic**. It reads a status JSON that `scripts/cosmos-backup-status.sh` writes on the host, so the repo password never enters a network-facing process and nothing can contend for the repository lock. `BackupsStatus.stale` and `timer_last_fired` exist to catch the case a snapshot list can't: a timer that fired but whose job died before writing status.

## Deployment

`cosmos-agent/compose.example.yaml` and `agent.example.toml`. Two things are easy to get wrong:

- **`network_mode: host` is required, not optional.** `/proc/net/dev` renders from the reading process's network namespace and sysinfo has no `HOST_PROC` escape hatch, so without it the agent reports the container's veth. Consequence: `ports:` does not apply, and `[host] net_exclude` becomes load-bearing.
- **`:ro` on `docker.sock` is not a security control** — it applies to the inode, not the protocol. Anyone who can `connect()` has the full Docker API, which is root-equivalent. The real controls are `allow_actions = false` and network isolation.

Disk mounts need `[[host.disks]]` entries to filter overlayfs noise and remap `/host/rootfs` → `/`.

Workspace `[profile.release-agent]` adds `panic = "abort"`; it is deliberately *not* in `[profile.release]`, which would also apply to `app/src-tauri` where Tauri uses `catch_unwind`.

## Frontend architecture

The app talks directly to agents from the webview; no Tauri IPC for data.

**One connection per node, owned by the store.** `api/connection.ts` —
`NodeConnection` owns that agent's host stream, container stream and volume
polling for the node's whole lifetime, plus capability negotiation, an explicit
backoff reconnect and the status machine (`connecting | online | offline |
unauthorized`). Connections live in a `Map` outside React state
(`stores/nodes.ts`), so navigation never tears a stream down. `useHostInfo`
previously opened an `EventSource` per *call site*: 2 per node on `/nodes`, 4
under StrictMode, each causing the agent to run an independent sampler.

The browser's built-in EventSource retry only covers a dropped connection — on
a non-2xx it closes permanently, which is why the reconnect is explicit. And
because EventSource never exposes a status code, `connect()` probes with a
real `getHost()` first; without that, a 401 and a dead host are
indistinguishable and a wrong token retries forever.

**Keep 1 Hz data out of React.** `<LiveValue>` and `<Sparkline>` subscribe to
the stream and write through refs inside a shared animation frame
(`lib/frame-scheduler.ts`), coalescing to one frame per node per sample. Node
cards re-render on *connection state* changes only. `<Sparkline>` uses a fixed
`0 0 100 100` viewBox with `preserveAspectRatio="none"`, so it never measures
itself — replacing a recharts `ResponsiveContainer` + `AreaChart` per metric
(four per card, each with a ResizeObserver, plus an inline `<style>` element
re-injected on every render).

Recharts is still used on `/monitoring`, where the data is a request/response
at human timescales and that's the right tool.

**Ring buffers.** `lib/ring-buffer.ts` — preallocated `Float32Array` + write
cursor, O(1) push, zero allocation. Replaces ~720 element copies and 19
allocations per node per second.

**Adding an endpoint:** type in `cosmos-common` → route + module in
`cosmos-agent` → method on `AgentClient` → subscription in `NodeConnection` or
hook in `queries.ts` → store/page. Gate the UI on the `capabilities` flag so
older agents degrade instead of erroring.

**Units.** Raw bytes and bytes/sec on the wire; all formatting lives in
`lib/node-metrics.ts`.

**Service model.** Services are declared by the `cosmos.service` Docker label,
grouped per node in `lib/services.ts`. `cosmos.service: system` marks
infrastructure and is filtered by `userFacingServices()`. `cosmos.service.url`
labels hold **bare hostnames**, which are relative paths in an `href` — always
route them through `serviceHref()` in `lib/agent-url.ts`.

**Nodes bootstrap.** `router.tsx` root `beforeLoad` seeds from `config.ts`: no
defaults under Tauri; in a browser it fetches `/config.json`. Hash history
under Tauri. Note `onRehydrateStorage` runs *during* `create()`, so it seeds
through the rehydrating draft and defers `attach()` to a microtask — touching
`useNodeStore` there hits its temporal dead zone.

**UI.** Pages in `src/pages/`, routes in `src/router.tsx` (defined one by one —
a helper function erases TanStack Router's literal path inference), shell in
`layouts/AppLayout.tsx`. `components/ui/` is shadcn-generated; prefer the
shadcn CLI, and note it's exempt from the React Compiler lint rules because
`shadcn add` would overwrite any fixes. Path alias `@/` → `app/src/`.

**Design tokens.** `App.css`. Semantic and metric tokens are defined for both
themes; they used to exist only under `.dark`, which is why light mode was
broken and the theme toggle was never wired up. `.glass` is applied
deliberately to cards and popovers rather than as a blanket utility override —
the previous global `backdrop-blur-lg!` forced a backdrop filter composite on
every surface on every paint. `.label-hud` is the small-caps label style.

## Gotchas worth knowing

- **SSE events must stay unnamed.** The agent emits `Event::default().data(..)`
  with no `.event(..)`. A named event is only delivered to a matching
  `addEventListener`, never to `EventSource.onmessage` — which looks like a
  perfectly healthy open stream that no handler ever sees.
- `npm run build` fails on a fresh clone until `cargo test -p cosmos-common`
  has generated `app/src/generated/`.
