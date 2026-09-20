import { useEffect } from 'react';
import { isTauri } from '@/lib/tauri';

/**
 * Per-platform window chrome.
 *
 * Size, title and the macOS overlay title bar now come from
 * `tauri.conf.json`, so the window opens correct instead of flashing the
 * default 800x600 decorated frame before JS runs. What's left is the one
 * thing config can't express: Windows and Linux want decorations off so the
 * custom title bar can draw its own controls, while macOS keeps them for the
 * traffic lights.
 *
 * Imports are dynamic so the browser build never pulls in Tauri modules.
 */
export function useTauriWindow() {
  useEffect(() => {
    if (!isTauri()) return;

    void (async () => {
      try {
        const [{ getCurrentWindow }, { platform }] = await Promise.all([
          import('@tauri-apps/api/window'),
          import('@tauri-apps/plugin-os'),
        ]);

        if (platform() !== 'macos') {
          await getCurrentWindow().setDecorations(false);
        }
      } catch {
        // Window customisation is cosmetic; never break startup over it.
      }
    })();
  }, []);
}
