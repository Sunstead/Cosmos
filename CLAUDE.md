# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

Cosmos is a homelab/server management dashboard. A Cargo workspace holds three crates, plus a React frontend that lives inside the Tauri crate's parent directory:

- `cosmos-agent` — axum HTTP server that runs on each node (port 7700). Reports host metrics (sysinfo), Docker containers (bollard) and volumes.
- `cosmos-common` — shared serde types used by the agent's JSON responses. Derives `ts-rs::TS`.
- `app/src-tauri` — thin Tauri 2 shell (`lib.rs`/`main.rs`) around the frontend; also targets Android (`gen/android`).
- `app/` — Vite + React 19 + TypeScript frontend (Tailwind v4, shadcn/Radix UI, TanStack Router/Query/Table, zustand, recharts).

## Commands

Rust (from repo root):
```bash
cargo run -p cosmos-agent          # agent on 0.0.0.0:7700; COSMOS_NODE_NAME overrides hostname
cargo test -p cosmos-common        # regenerates TS bindings (see below)
```

Frontend (from `app/`):
```bash
npm run dev                        # Vite dev server on :1420 (browser only)
npm run tauri dev                  # desktop app (runs `npm run dev` via beforeDevCommand)
npm run build                      # tsc && vite build
```

There is no lint config and no test suite beyond ts-rs export tests.

## Architecture

**Type sharing (Rust → TS).** Types in `cosmos-common/src/types.rs` carry `#[ts(export, export_to = "../../app/src/generated/")]`. Running `cargo test -p cosmos-common` writes `.ts` files into `app/src/generated/`, which is gitignored (except `.gitignore`/`.gitkeep`). Frontend imports them as `@/generated/HostInfo` etc. After changing a shared type, regenerate before running `tsc`/`npm run build`; a fresh clone has no generated types.

**Agent API.** Routes in `cosmos-agent/src/main.rs`: `GET /v1/host`, `GET /v1/host/stream` (SSE, 1s interval), `GET /v1/containers`, `GET /v1/volumes`. Handlers delegate to `metrics.rs`, `docker.rs`, `volumes.rs`. `AppState` keeps previous net/disk snapshots so rates (Mbps, MB/s) are computed as deltas between calls. CORS is fully permissive.

**Frontend data flow.** The app talks directly to agents from the webview (no Tauri IPC for data):
- `stores/nodes.ts` (zustand, persisted) holds `NodeConfig[]`, an `AgentClient` per node (`api/client.ts`), per-node status and latest `HostInfo`.
- `api/queries.ts` wraps clients in hooks: host info via SSE (`useHostInfo`), containers/volumes via react-query polling (5s), mirrored into `stores/containers.ts` / `stores/volumes.ts` for cross-page aggregation. `stores/metrics-history.ts` and `node-metrics-collector.tsx` accumulate history for sparklines.
- Adding a new agent endpoint means: type in `cosmos-common` → route + module in `cosmos-agent` → method on `AgentClient` → hook in `queries.ts` → store/page.

**Nodes bootstrap.** `router.tsx` root `beforeLoad` seeds nodes when the store is empty via `config.ts`: on Tauri, no defaults (user adds manually); in a browser, it fetches `/config.json` for a default node list. Router uses hash history under Tauri (`lib/tauri.ts` `isTauri`).

**UI.** Pages in `src/pages/`, route table in `src/router.tsx`, layout with sidebar/custom title bar in `layouts/AppLayout.tsx` and `components/`. `components/ui/` is shadcn-generated (`components.json`); prefer adding via the shadcn CLI. Path alias `@/` → `app/src/`. Service icons/metadata live in `lib/service-icons.tsx`, `lib/services.ts`.
