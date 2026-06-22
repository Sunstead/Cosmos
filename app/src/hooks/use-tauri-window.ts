import { useEffect } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { platform } from '@tauri-apps/plugin-os';

export function useTauriWindow() {
  useEffect(() => {
    async function configureWindow() {
      try {
        const appWindow = getCurrentWindow();
        const os = await platform();

        if (os === 'macos') {
          await appWindow.setDecorations(true);
          await appWindow.setTitleBarStyle('overlay');
        } else {
          await appWindow.setDecorations(false);
        }
      } catch {
        // Not in Tauri
      }
    }

    configureWindow();
  }, []); // Run once on mount
}
