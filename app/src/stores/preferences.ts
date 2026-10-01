import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface PreferencesStore {
  /** Scanlines over the constellation and on its bodies. */
  scanlines: boolean;
  setScanlines: (on: boolean) => void;
}

/** Small per-device display preferences, kept in `localStorage`. Themes have their own keys. */
export const usePreferencesStore = create<PreferencesStore>()(
  persist(
    (set) => ({
      scanlines: true,
      setScanlines: (scanlines) => set({ scanlines }),
    }),
    { name: 'cosmos-preferences', version: 1 },
  ),
);
