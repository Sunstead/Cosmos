import { isDesktop } from './platform';

/** Opens a link in the system browser (the opener plugin on desktop). */
export async function openExternal(url: string): Promise<void> {
  if (isDesktop()) {
    try {
      const { openUrl } = await import('@tauri-apps/plugin-opener');
      await openUrl(url);
      return;
    } catch {
      // Fall through to the browser behaviour below.
    }
  }
  window.open(url, '_blank', 'noopener,noreferrer');
}
