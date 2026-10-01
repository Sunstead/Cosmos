import { useEffect, useRef } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useSidebar } from '@/components/ui/resizable-sidebar';
import { useUiStore } from '@/stores/ui';
import { PAGES } from '@/lib/navigation';
import { getPlatform } from '@/lib/platform';
import { menuToCommand } from '@/lib/commands';
import {
  isOverlayTarget,
  isSequence,
  isTypingTarget,
  matchesChord,
  SequenceTracker,
  sequenceShortcuts,
  SHORTCUTS,
  ShortcutId,
} from '@/lib/shortcuts';

/** Focuses the current page's search field, if it has one. */
function focusPageSearch(): boolean {
  const el = document.querySelector<HTMLInputElement>('[data-page-search]');
  if (!el) return false;
  el.focus();
  el.select();
  return true;
}

/**
 * Routes shortcuts and native menu events to actions. Mounted once inside
 * the shell. On macOS the native menu owns modifier shortcuts, so they are
 * not also handled here (they would fire twice). Bare keys (`/` and the
 * "G then a letter" sequences) are handled here everywhere: a menu can't show
 * a sequence.
 */
export function CommandHost() {
  const navigate = useNavigate();
  const { toggleSidebar } = useSidebar();
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
        case 'reload':
          window.location.reload();
          break;
      }
    };
  }, [navigate, toggleSidebar, setPaletteOpen]);

  useEffect(() => {
    const macApp = getPlatform() === 'macos';
    const sequences = new SequenceTracker(sequenceShortcuts());

    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.repeat) return;
      const bare = !e.metaKey && !e.ctrlKey && !e.altKey;
      if (bare && !isTypingTarget(e.target) && !isOverlayTarget(e.target)) {
        if (e.key === '/') {
          e.preventDefault();
          sequences.reset();
          if (!focusPageSearch()) setPaletteOpen(true);
          return;
        }
        if (!e.shiftKey && e.key.length === 1) {
          const { id, consumed } = sequences.press(e.key);
          if (consumed) e.preventDefault();
          if (id) run.current(id);
          if (consumed) return;
        }
      }
      if (macApp) return;
      for (const [id, chord] of Object.entries(SHORTCUTS) as [ShortcutId, string][]) {
        if (id === 'search' || isSequence(chord)) continue;
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
