/**
 * Per-node agent tokens.
 *
 * Under Tauri these live in the OS keychain (macOS Keychain, Windows
 * Credential Manager, libsecret) via a Rust command, and only a key reference
 * ever reaches persisted state. In the browser build there is no keychain, so
 * they fall back to `localStorage` — which is plaintext and readable by any
 * script in the page. That's an accepted limitation of the web target, not a
 * default we'd choose.
 */

import { isTauri } from './tauri';

const STORAGE_PREFIX = 'cosmos-token:';

/** In-memory cache so the hot path never awaits the keychain. */
const cache = new Map<string, string>();

async function invoke<T>(cmd: string, args: Record<string, unknown>): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<T>(cmd, args);
}

export async function getToken(nodeId: string): Promise<string | null> {
  const cached = cache.get(nodeId);
  if (cached !== undefined) return cached;

  let token: string | null = null;
  if (isTauri()) {
    try {
      token = await invoke<string | null>('get_node_token', { nodeId });
    } catch {
      // A keychain miss is normal for a node that never had a token.
      token = null;
    }
  } else {
    try {
      token = localStorage.getItem(STORAGE_PREFIX + nodeId);
    } catch {
      // Private browsing, or site data blocked.
      token = null;
    }
  }

  if (token) cache.set(nodeId, token);
  return token;
}

export async function setToken(nodeId: string, token: string): Promise<void> {
  cache.set(nodeId, token);

  if (isTauri()) {
    await invoke('set_node_token', { nodeId, token });
    return;
  }
  try {
    localStorage.setItem(STORAGE_PREFIX + nodeId, token);
  } catch {
    // Non-fatal: the token still works for this session from the cache.
  }
}

export async function deleteToken(nodeId: string): Promise<void> {
  cache.delete(nodeId);

  if (isTauri()) {
    try {
      await invoke('delete_node_token', { nodeId });
    } catch {
      // Already absent.
    }
    return;
  }
  try {
    localStorage.removeItem(STORAGE_PREFIX + nodeId);
  } catch {
    /* ignore */
  }
}

/** Seeds the cache so the first connection doesn't await the keychain. */
export function primeToken(nodeId: string, token: string | null): void {
  if (token) cache.set(nodeId, token);
  else cache.delete(nodeId);
}
