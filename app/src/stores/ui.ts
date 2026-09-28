import { create } from 'zustand';

interface UiStore {
  paletteOpen: boolean;
  setPaletteOpen: (open: boolean) => void;
  addNodeOpen: boolean;
  /** Address to prefill, e.g. a configured node that still needs a sign-in. */
  addNodeUrl: string;
  setAddNodeOpen: (open: boolean, url?: string) => void;
}

/** Cross-cutting UI state that shortcuts, menus and the palette all drive. */
export const useUiStore = create<UiStore>((set) => ({
  paletteOpen: false,
  setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
  addNodeOpen: false,
  addNodeUrl: '',
  setAddNodeOpen: (addNodeOpen, addNodeUrl = '') => set({ addNodeOpen, addNodeUrl }),
}));
