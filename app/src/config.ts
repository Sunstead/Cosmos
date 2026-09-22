import { isDesktop } from './lib/platform';

export interface DefaultNode {
  url: string;
}

/**
 * Nodes to seed on first run. The browser build can ship a `config.json`;
 * the desktop app starts empty.
 */
export async function getDefaultNodes(): Promise<DefaultNode[]> {
  if (isDesktop()) return [];

  try {
    const res = await fetch('/config.json');
    if (!res.ok) return [];
    const parsed: unknown = await res.json();

    // Hand-written file: validate rather than trust the shape.
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((entry) => {
      if (typeof entry === 'string') return [{ url: resolveUrl(entry) }];
      if (entry && typeof entry === 'object' && typeof (entry as DefaultNode).url === 'string') {
        // A `token` field from before 0.3 is ignored: nodes sign in now.
        return [{ url: resolveUrl((entry as DefaultNode).url) }];
      }
      return [];
    });
  } catch {
    return [];
  }
}

/** `/` means the origin serving this page, as the agent's bundled UI writes it. */
function resolveUrl(url: string): string {
  return url.startsWith('/') ? new URL(url, window.location.origin).origin : url;
}
