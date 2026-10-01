/**
 * The theme registry. Each theme is one `[data-theme='<id>']` block in
 * `src/themes/*.css` (the source of truth for colours, so the first paint is
 * right before any script runs) plus one entry here. `index.html` keeps its
 * own copy of the ids and schemes for that first paint; a test keeps them in
 * step.
 */

export type Scheme = 'dark' | 'light';

/**
 * How a theme dresses the app beyond its colours. `rounded` is shadcn as it
 * comes, with a calm constellation; `tech` is square, mono and bracketed,
 * with the full hologram (see `[data-style='tech']` in App.css).
 */
export type ThemeStyle = 'rounded' | 'tech';

export interface ThemeDef {
  id: string;
  name: string;
  scheme: Scheme;
  style: ThemeStyle;
  /** One line of character, for the picker. */
  description: string;
}

export const THEMES: readonly ThemeDef[] = [
  {
    id: 'cosmos-dark',
    name: 'Cosmos Dark',
    scheme: 'dark',
    style: 'rounded',
    description: 'Near-black space, crisp white',
  },
  {
    id: 'nebula',
    name: 'Nebula',
    scheme: 'dark',
    style: 'rounded',
    description: 'Deep violet with a magenta glow',
  },
  {
    id: 'aurora',
    name: 'Aurora',
    scheme: 'dark',
    style: 'rounded',
    description: 'Polar night, mint and violet',
  },
  { id: 'mars', name: 'Mars', scheme: 'dark', style: 'rounded', description: 'Rust dust and ochre dusk' },
  {
    id: 'event-horizon',
    name: 'Event Horizon',
    scheme: 'dark',
    style: 'rounded',
    description: 'True black, hot orange',
  },
  {
    id: 'eclipse',
    name: 'Eclipse',
    scheme: 'dark',
    style: 'rounded',
    description: 'Graphite with a gold corona',
  },
  {
    id: 'deep-field',
    name: 'Deep Field',
    scheme: 'dark',
    style: 'rounded',
    description: 'Navy dark, ice-blue light',
  },
  {
    id: 'cosmos-light',
    name: 'Cosmos Light',
    scheme: 'light',
    style: 'rounded',
    description: 'Clean white, ink black',
  },
  { id: 'solar', name: 'Solar', scheme: 'light', style: 'rounded', description: 'Warm cream and amber' },
  {
    id: 'lunar',
    name: 'Lunar',
    scheme: 'light',
    style: 'rounded',
    description: 'Cool grey with slate blue',
  },
  {
    id: 'comet',
    name: 'Comet',
    scheme: 'light',
    style: 'rounded',
    description: 'Bright ice-white, teal tail',
  },
  {
    id: 'hologram',
    name: 'Hologram',
    scheme: 'dark',
    style: 'tech',
    description: 'Deep navy, projected cyan',
  },
  {
    id: 'terminal',
    name: 'Terminal',
    scheme: 'dark',
    style: 'tech',
    description: 'Phosphor green on black',
  },
  {
    id: 'red-alert',
    name: 'Red Alert',
    scheme: 'dark',
    style: 'tech',
    description: 'Bridge black, crimson alarm',
  },
  {
    id: 'blueprint',
    name: 'Blueprint',
    scheme: 'light',
    style: 'tech',
    description: 'Drafting paper, blue ink',
  },
];

export const DEFAULT_THEME = 'cosmos-dark';

/** Follow system's themes for each OS scheme. */
export type ThemePair = Record<Scheme, string>;

export const DEFAULT_PAIR: ThemePair = { light: 'cosmos-light', dark: 'cosmos-dark' };

/** What `cosmos-theme` holds: a theme id, or `system` to follow the OS. */
export type ThemeChoice = string;
export const SYSTEM = 'system';

/** localStorage keys, read by index.html too. */
export const STORAGE_KEYS = {
  theme: 'cosmos-theme',
  light: 'cosmos-theme-light',
  dark: 'cosmos-theme-dark',
} as const;

const BY_ID = new Map(THEMES.map((t) => [t.id, t]));

export function themeById(id: string | null | undefined): ThemeDef | undefined {
  return id ? BY_ID.get(id) : undefined;
}

/** Rounded themes of a scheme: the Dark and Light groups, and what Follow system can pair. */
export function themesOf(scheme: Scheme): ThemeDef[] {
  return THEMES.filter((t) => t.scheme === scheme && t.style === 'rounded');
}

/** The Tech group. Picked directly; Follow system doesn't pair them. */
export function techThemes(): ThemeDef[] {
  return THEMES.filter((t) => t.style === 'tech');
}

/**
 * A stored choice, made valid: the pre-0.10 `dark` and `light` become the
 * Cosmos themes, `system` stays, anything unknown is the default.
 */
export function normalizeChoice(value: string | null | undefined): ThemeChoice {
  if (value === SYSTEM) return SYSTEM;
  if (value === 'dark' || value === 'light') return `cosmos-${value}`;
  return themeById(value) ? value! : DEFAULT_THEME;
}

/** A stored pair slot, made valid: it must name a rounded theme of that scheme. */
export function normalizeSlot(scheme: Scheme, value: string | null | undefined): string {
  const theme = themeById(value);
  return theme?.scheme === scheme && theme.style === 'rounded' ? value! : DEFAULT_PAIR[scheme];
}

export function resolveTheme(choice: ThemeChoice, pair: ThemePair, systemScheme: Scheme): ThemeDef {
  const id = choice === SYSTEM ? pair[systemScheme] : choice;
  return themeById(id) ?? themeById(choice === SYSTEM ? DEFAULT_PAIR[systemScheme] : DEFAULT_THEME)!;
}

/** Puts a theme on <html>: its id, its style, its scheme's class and `color-scheme`. */
export function applyTheme(theme: ThemeDef, root: HTMLElement = document.documentElement) {
  root.dataset.theme = theme.id;
  root.dataset.style = theme.style;
  root.classList.remove('light', 'dark');
  root.classList.add(theme.scheme);
  root.style.colorScheme = theme.scheme;
}
