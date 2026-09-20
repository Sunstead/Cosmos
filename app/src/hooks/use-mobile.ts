import { useCallback, useSyncExternalStore } from 'react';

const MOBILE_BREAKPOINT = 768;

/**
 * Tracks whether the viewport is below the mobile breakpoint.
 *
 * Reads `matches` from the media query itself rather than re-measuring
 * `window.innerWidth`, and subscribes through `useSyncExternalStore` so there
 * is no state written from inside an effect.
 */
export function useIsMobile(): boolean {
  const subscribe = useCallback((onChange: () => void) => {
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);

  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`).matches,
    // Server/prerender snapshot: assume desktop.
    () => false,
  );
}
