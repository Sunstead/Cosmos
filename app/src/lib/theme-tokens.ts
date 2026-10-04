/**
 * CSS tokens for canvas drawing. Canvas can't resolve `var(--x)`, so values
 * are read from the computed style and cached per theme id.
 */
import type { ThemeStyle } from '@sunstead/ui/themes';

export interface CanvasTokens {
  /** The theme id the values were read under. */
  theme: string;
  /** Rounded or tech; a theme's style never changes, so the id still keys the cache. */
  style: ThemeStyle;
  success: string;
  warning: string;
  error: string;
  muted: string;
  foreground: string;
  space: string;
  star: string;
  orbit: string;
  /** Planet lightness stops, as percentages. */
  planetLight: number;
  planetMid: number;
  planetShade: number;
  atmosphere: number;
  /** The constellation: a dark viewport in every theme, light themes too. */
  holoSpace: string;
  holoPrimary: string;
  holoSecondary: string;
  holoText: string;
  holoDim: string;
  /** Bloom and glow strength, 0..1. */
  holoGlow: number;
}

let cached: CanvasTokens | null = null;

function currentTheme(): string {
  return document.documentElement.dataset.theme ?? '';
}

export function canvasTokens(): CanvasTokens {
  const theme = currentTheme();
  if (cached?.theme === theme) return cached;

  const css = getComputedStyle(document.documentElement);
  const get = (name: string) => css.getPropertyValue(name).trim();
  const num = (name: string, fallback: number) => {
    const v = parseFloat(get(name));
    return Number.isFinite(v) ? v : fallback;
  };

  cached = {
    theme,
    style: document.documentElement.dataset.style === 'tech' ? 'tech' : 'rounded',
    success: get('--success'),
    warning: get('--warning'),
    error: get('--error'),
    muted: get('--muted-foreground'),
    foreground: get('--foreground'),
    space: get('--space'),
    star: get('--star'),
    orbit: get('--orbit'),
    planetLight: num('--planet-light', 72),
    planetMid: num('--planet-mid', 50),
    planetShade: num('--planet-shade', 12),
    atmosphere: num('--planet-atmosphere', 0.5),
    holoSpace: get('--holo-space'),
    holoPrimary: get('--holo-primary'),
    holoSecondary: get('--holo-secondary'),
    holoText: get('--holo-text'),
    holoDim: get('--holo-dim'),
    holoGlow: num('--holo-glow', 0.8),
  };
  return cached;
}

/** Calls `fn` when the theme on <html> (its id, style or scheme class) changes. */
export function onThemeChange(fn: () => void): () => void {
  let last = currentTheme();
  const observer = new MutationObserver(() => {
    const next = currentTheme();
    if (next === last) return;
    last = next;
    cached = null;
    fn();
  });
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'data-theme', 'data-style'] });
  return () => observer.disconnect();
}
