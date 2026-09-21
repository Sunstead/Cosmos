import { create } from 'zustand';

interface UiStore {
  paletteOpen: boolean;
  setPaletteOpen: (open: boolean) => void;
  addNodeOpen: boolean;
  setAddNodeOpen: (open: boolean) => void;
}

/** Cross-cutting UI state that shortcuts, menus and the palette all drive. */
export const useUiStore = create<UiStore>((set) => ({
  paletteOpen: false,
  setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
  addNodeOpen: false,
  setAddNodeOpen: (addNodeOpen) => set({ addNodeOpen }),
}));
