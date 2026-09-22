import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, Server } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { WEB_PORT } from './helpers';
import { startMockOidc } from './mock-oidc';

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address() as { port: number };
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

async function waitFor(url: string, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`agent did not start at ${url}`);
}

/**
 * Answers the one LocalAPI request the agent makes, the way tailscaled does:
 * HTTP/1.0 over a unix socket, body then close.
 */
function fakeTailscaled(socket: string, fixture: string): Server {
  const body = readFileSync(fixture);
  const server = createServer((conn) => {
    conn.once('data', () => {
      conn.end(Buffer.concat([Buffer.from('HTTP/1.0 200 OK\r\nContent-Type: application/json\r\n\r\n'), body]));
    });
  });
  server.listen(socket);
  return server;
}

/** Builds and starts a real cosmos-agent with a temp history DB. */
export default async function globalSetup() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  execFileSync('cargo', ['build', '-q', '-p', 'cosmos-agent'], { cwd: root, stdio: 'inherit' });

  const port = await freePort();
  const oidc = await startMockOidc();
  const dir = mkdtempSync(path.join(tmpdir(), 'cosmos-e2e-'));
  const config = path.join(dir, 'agent.toml');
  const socket = path.join(dir, 'tailscaled.sock');
  const tailscaled = fakeTailscaled(socket, path.join(root, 'app/e2e/fixtures/tailscale-status.json'));
  writeFileSync(
    config,
    `[cors]\nextra_origins = ["http://localhost:${WEB_PORT}"]\n` +
      `[tailscale]\nenabled = true\nsocket = "${socket}"\ninterval_ms = 2000\n` +
      `[wol]\nenabled = true\n[state]\npath = "${path.join(dir, 'state.db')}"\n`,
  );

  const agent = spawn(path.join(root, 'target/debug/cosmos-agent'), [], {
    cwd: dir,
    env: {
      ...process.env,
      COSMOS_AGENT_CONFIG: config,
      COSMOS_AGENT_BIND: `127.0.0.1:${port}`,
      // Signs in against the mock provider, exactly as against Authentik.
      COSMOS_AGENT_OIDC_ISSUER: oidc.issuer,
      COSMOS_AGENT_HISTORY_PATH: path.join(dir, 'history.db'),
      // Wake-on-LAN specs need it. No spec starts or stops a container.
      COSMOS_AGENT_ALLOW_ACTIONS: '1',
      RUST_LOG: 'warn',
    },
    stdio: process.env.E2E_DEBUG ? 'inherit' : 'ignore',
  });

  const url = `http://127.0.0.1:${port}`;
  await waitFor(`${url}/v1/info`);
  process.env.E2E_AGENT_URL = url;
  process.env.E2E_OIDC_ISSUER = oidc.issuer;

  return async () => {
    agent.kill();
    tailscaled.close();
    oidc.server.close();
    rmSync(dir, { recursive: true, force: true });
  };
}
