import { useEffect, useState } from 'react';
import { isDesktop } from '@/lib/platform';

export interface WindowState {
  fullscreen: boolean;
  maximized: boolean;
}

/** Fullscreen and maximized state, from the Rust `window-state` event. */
export function useWindowState(): WindowState {
  const [state, setState] = useState<WindowState>({ fullscreen: false, maximized: false });

  useEffect(() => {
    if (!isDesktop()) return;
    let unlisten: (() => void) | undefined;
    let cancelled = false;

    void (async () => {
      const [{ listen }, { getCurrentWindow }] = await Promise.all([
        import('@tauri-apps/api/event'),
        import('@tauri-apps/api/window'),
      ]);
      const win = getCurrentWindow();
      const [fullscreen, maximized] = await Promise.all([win.isFullscreen(), win.isMaximized()]);
      if (!cancelled) setState({ fullscreen, maximized });

      const un = await listen<WindowState>('window-state', (e) => setState(e.payload));
      if (cancelled) un();
      else unlisten = un;
    })().catch(() => {});

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  return state;
}

export async function windowAction(action: 'minimize' | 'toggleMaximize' | 'close') {
  const { getCurrentWindow } = await import('@tauri-apps/api/window');
  await getCurrentWindow()[action]();
}
