import { isDesktop } from './lib/platform';

export interface DefaultNode {
  url: string;
  token?: string;
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
