import { useCallback, useState } from 'react';

/**
 * `useState` that survives a reload.
 *
 * For small per-viewer preferences — a chosen view mode, a collapsed panel.
 * Every access is guarded: `localStorage` throws in a private window and can
 * be blocked entirely, and a UI preference is never worth an exception.
 */
export function usePersistentState<T>(
  key: string,
  fallback: T,
): [T, (value: T) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? fallback : (JSON.parse(raw) as T);
    } catch {
      return fallback;
    }
  });

  const set = useCallback(
    (next: T) => {
      setValue(next);
      try {
        localStorage.setItem(key, JSON.stringify(next));
      } catch {
        // Non-fatal: the choice still applies for this session.
      }
    },
    [key],
  );

  return [value, set];
}
