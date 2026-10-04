import { useSyncExternalStore } from 'react';
import { onThemeChange } from '@/lib/theme-tokens';
import type { ThemeStyle } from '@sunstead/ui/themes';

const read = (): ThemeStyle => (document.documentElement.dataset.style === 'tech' ? 'tech' : 'rounded');

/**
 * The style of the theme on <html>, rounded or tech. Read from the document
 * rather than `useTheme`, so it also works where there's no ThemeProvider
 * (the constellation preview).
 */
export function useThemeStyle(): ThemeStyle {
  return useSyncExternalStore(onThemeChange, read, () => 'rounded');
}
