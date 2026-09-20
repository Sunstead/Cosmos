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
npx tsc --noEmit                   # typecheck alone
```

Agent container:
```bash
docker build -f cosmos-agent/Dockerfile -t cosmos-agent:0.2.0 .   # build from the REPO ROOT
```

There is no frontend lint config and no frontend test suite yet.

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

## Frontend data flow

The app talks directly to agents from the webview (no Tauri IPC for data):

- `stores/nodes.ts` (zustand, persisted) holds `NodeConfig[]`, an `AgentClient` per node, per-node status and latest `HostInfo`.
- `api/queries.ts` — host info via SSE (`useHostInfo`), containers/volumes via react-query polling, mirrored into `stores/containers.ts` / `stores/volumes.ts`.
- Adding an endpoint: type in `cosmos-common` → route + module in `cosmos-agent` → method on `AgentClient` → hook in `queries.ts` → store/page.

**Nodes bootstrap.** `router.tsx` root `beforeLoad` seeds nodes via `config.ts`: no defaults under Tauri; in a browser it fetches `/config.json`. Hash history under Tauri (`lib/tauri.ts`).

**UI.** Pages in `src/pages/`, routes in `src/router.tsx`, shell in `layouts/AppLayout.tsx`. `components/ui/` is shadcn-generated (`components.json`); prefer the shadcn CLI. Path alias `@/` → `app/src/`.

### Known state (mid-rework)

The agent is rewritten; the frontend has only had the mechanical unit migration applied so far. Still outstanding: one SSE connection per node (currently one per *call site*), ring-buffer metrics history, `React.memo` and keeping 1 Hz data out of React, the five stub pages (`network`, `monitoring`, `logs`, `backups`, `settings`), the hardcoded Overview stats, and the no-op action menus — the agent endpoints they need now exist.
