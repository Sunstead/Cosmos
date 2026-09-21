import { useCallback, useState } from 'react';

/**
 * `useState` that survives a reload.
 *
 * For small UI preferences. Storage access is guarded because it can throw.
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
