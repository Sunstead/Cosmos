import type { ThemeAliases } from '@sunstead/ui/themes';

/**
 * Stored theme values Cosmos still accepts: the bare scheme from before 0.10,
 * and its own base pair from before the themes moved to @sunstead/ui.
 * index.html mirrors this for the first paint (themes-sync.test.ts checks).
 */
export const THEME_ALIASES: ThemeAliases = {
  dark: 'sunstead-dark',
  light: 'sunstead-light',
  'cosmos-dark': 'sunstead-dark',
  'cosmos-light': 'sunstead-light',
};
