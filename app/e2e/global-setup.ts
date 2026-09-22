import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, Server } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { TOKEN, WEB_PORT } from './helpers';

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
  const dir = mkdtempSync(path.join(tmpdir(), 'cosmos-e2e-'));
  const config = path.join(dir, 'agent.toml');
  const socket = path.join(dir, 'tailscaled.sock');
  const tailscaled = fakeTailscaled(socket, path.join(root, 'app/e2e/fixtures/tailscale-status.json'));
  writeFileSync(
    config,
    `[cors]\nextra_origins = ["http://localhost:${WEB_PORT}"]\n` +
      `[tailscale]\nenabled = true\nsocket = "${socket}"\ninterval_ms = 2000\n`,
  );

  const agent = spawn(path.join(root, 'target/debug/cosmos-agent'), [], {
    cwd: dir,
    env: {
      ...process.env,
      COSMOS_AGENT_CONFIG: config,
      COSMOS_AGENT_BIND: `127.0.0.1:${port}`,
      COSMOS_AGENT_TOKEN: TOKEN,
      COSMOS_AGENT_HISTORY_PATH: path.join(dir, 'history.db'),
      COSMOS_AGENT_ALLOW_ACTIONS: '0',
      RUST_LOG: 'warn',
    },
    stdio: process.env.E2E_DEBUG ? 'inherit' : 'ignore',
  });

  const url = `http://127.0.0.1:${port}`;
  await waitFor(`${url}/v1/info`);
  process.env.E2E_AGENT_URL = url;

  return async () => {
    agent.kill();
    tailscaled.close();
    rmSync(dir, { recursive: true, force: true });
  };
}
