# Cosmos app

Tauri 2 + React 19 desktop client. Also runs as a plain web app.

```bash
npm run dev          # Vite on :1420 (browser build)
npm run tauri dev    # desktop app
npm run build        # tsc && vite build
npm run lint
npm test
```

**Generate the shared types first.** `src/generated/` is produced from
`cosmos-common` by ts-rs and is gitignored, so a fresh clone has none:

```bash
cargo test -p cosmos-common
```

## How data flows

One `NodeConnection` per node (`src/api/connection.ts`) owns that agent's host
stream, container stream and volume polling for as long as the node exists.
Connections live outside React, in the node store — not in components — so
navigating between pages never tears a stream down.

**1 Hz data deliberately does not flow through React state.** Live numbers are
`<LiveValue>` and charts are `<Sparkline>`; both subscribe to the stream and
write through refs inside a shared animation frame. A node card renders when
its *connection state* changes, not when a sample arrives.

Longer-range history is a normal request/response (`/v1/metrics`) and uses
react-query. Only the last 60 seconds is kept client-side, in preallocated
ring buffers (`src/lib/ring-buffer.ts`).

## Tokens

Under Tauri, agent tokens live in the OS keychain via a Rust command; only a
key reference reaches persisted state. The browser build has no keychain and
falls back to `localStorage`, which is plaintext — Settings says so plainly
rather than hiding it.
