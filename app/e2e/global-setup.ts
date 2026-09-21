import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
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

/** Builds and starts a real cosmos-agent with a temp history DB. */
export default async function globalSetup() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  execFileSync('cargo', ['build', '-q', '-p', 'cosmos-agent'], { cwd: root, stdio: 'inherit' });

  const port = await freePort();
  const dir = mkdtempSync(path.join(tmpdir(), 'cosmos-e2e-'));
  const config = path.join(dir, 'agent.toml');
  writeFileSync(config, `[cors]\nextra_origins = ["http://localhost:${WEB_PORT}"]\n`);

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
    rmSync(dir, { recursive: true, force: true });
  };
}
