import { useEffect, useRef } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useSidebar } from '@/components/ui/resizable-sidebar';
import { useTheme } from '@/components/theme-provider';
import { useUiStore } from '@/stores/ui';
import { PAGES } from '@/lib/navigation';
import { getPlatform } from '@/lib/platform';
import { isTypingTarget, matchesChord, SHORTCUTS, ShortcutId } from '@/lib/shortcuts';

/** Focuses the current page's search field, if it has one. */
export function focusPageSearch(): boolean {
  const el = document.querySelector<HTMLInputElement>('[data-page-search]');
  if (!el) return false;
  el.focus();
  el.select();
  return true;
}

/**
 * Routes shortcuts and native menu events to actions. Mounted once inside
 * the shell. On macOS the native menu owns modifier shortcuts, so they are
 * not also handled here (they would fire twice).
 */
export function CommandHost() {
  const navigate = useNavigate();
  const { toggleSidebar } = useSidebar();
  const { toggleTheme } = useTheme();
  const setPaletteOpen = useUiStore((s) => s.setPaletteOpen);

  // Latest actions in a ref so the listeners subscribe once.
  const run = useRef<(id: string) => void>(() => {});
  useEffect(() => {
    run.current = (id: string) => {
      const page = PAGES.find((p) => p.shortcut === id);
      if (page) {
        void navigate({ to: page.path });
        return;
      }
      switch (id) {
        case 'palette':
          setPaletteOpen(!useUiStore.getState().paletteOpen);
          break;
        case 'sidebar':
          toggleSidebar();
          break;
        case 'theme':
          toggleTheme();
          break;
        case 'reload':
          window.location.reload();
          break;
      }
    };
  }, [navigate, toggleSidebar, toggleTheme, setPaletteOpen]);

  useEffect(() => {
    const macApp = getPlatform() === 'macos';

    const onKey = (e: KeyboardEvent) => {
      if (e.key === '/' && !e.metaKey && !e.ctrlKey && !isTypingTarget(e.target)) {
        e.preventDefault();
        if (!focusPageSearch()) setPaletteOpen(true);
        return;
      }
      if (macApp) return;
      for (const [id, chord] of Object.entries(SHORTCUTS) as [ShortcutId, string][]) {
        if (id === 'search') continue;
        if (matchesChord(e, chord)) {
          e.preventDefault();
          run.current(id);
          return;
        }
      }
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setPaletteOpen]);

  useEffect(() => {
    if (getPlatform() !== 'macos') return;
    let unlisten: (() => void) | undefined;
    let cancelled = false;

    void import('@tauri-apps/api/event').then(({ listen }) =>
      listen<{ id: string }>('menu', ({ payload }) => run.current(menuToCommand(payload.id))).then(
        (un) => {
          if (cancelled) un();
          else unlisten = un;
        },
      ),
    );
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  return null;
}

/** Native menu ids (src-tauri/src/menu.rs) to command ids. */
export function menuToCommand(menuId: string): string {
  switch (menuId) {
    case 'app.settings':
      return 'settings';
    case 'view.command-palette':
      return 'palette';
    case 'view.toggle-sidebar':
      return 'sidebar';
    case 'view.toggle-theme':
      return 'theme';
    case 'view.reload':
      return 'reload';
    default:
      return menuId; // go.* ids match shortcut ids
  }
}
