import { isTauri } from './tauri';

/**
 * Opens a link outside the app.
 *
 * Under Tauri a plain `target="_blank"` does nothing useful — the webview has
 * no tabs — so this routes through the opener plugin, which was already a
 * declared dependency but was never imported.
 */
export async function openExternal(url: string): Promise<void> {
  if (isTauri()) {
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
