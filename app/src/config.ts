import { isTauri } from './lib/tauri';

export interface DefaultNode {
  url: string;
  token?: string;
}

/**
 * Nodes to seed on first run.
 *
 * The desktop build starts empty — you add nodes through the UI, and their
 * tokens go to the OS keychain. The web build can be served alongside a
 * `config.json` so a browser tab knows which agents to talk to without
 * anyone typing them in.
 */
export async function getDefaultNodes(): Promise<DefaultNode[]> {
  if (isTauri()) return [];

  try {
    const res = await fetch('/config.json');
    if (!res.ok) return [];
    const parsed: unknown = await res.json();

    // Hand-written file: validate rather than trust the shape.
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((entry) => {
      if (typeof entry === 'string') return [{ url: entry }];
      if (entry && typeof entry === 'object' && typeof (entry as DefaultNode).url === 'string') {
        const { url, token } = entry as DefaultNode;
        return [{ url, token: typeof token === 'string' ? token : undefined }];
      }
      return [];
    });
  } catch {
    return [];
  }
}
