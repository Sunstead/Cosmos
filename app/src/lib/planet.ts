/**
 * Deterministic planet appearance for a node. Classic planet names get a
 * recognisable preset; anything else is seeded from a hash of the name.
 */

export type PlanetKind = 'gas' | 'rocky' | 'ice';

export interface Band {
  /** Centre, -1 (top) to 1 (bottom). */
  y: number;
  /** Half height, in radii. */
  h: number;
  /** Lightness offset from the base, in percent. */
  light: number;
  alpha: number;
}

export interface Crater {
  x: number;
  y: number;
  r: number;
}

export interface PlanetStyle {
  kind: PlanetKind;
  hue: number;
  accentHue: number;
  saturation: number;
  atmosphereHue: number;
  bands: Band[];
  craters: Crater[];
  ring: { tilt: number; inner: number; outer: number; alpha: number } | null;
}

/** FNV-1a: small, fast, spreads short names well. */
export function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Seeded PRNG so a name always produces the same bands and craters. */
function rng(seed: number) {
  let s = seed || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 10_000) / 10_000;
  };
}

function gasBands(rand: () => number, count: number, spread = 12): Band[] {
  return Array.from({ length: count }, (_, i) => ({
    y: -0.85 + (i + rand() * 0.6) * (1.7 / count),
    h: 0.04 + rand() * 0.09,
    light: (rand() - 0.5) * spread * 2,
    alpha: 0.35 + rand() * 0.45,
  }));
}

function craters(rand: () => number, count: number): Crater[] {
  return Array.from({ length: count }, () => {
    const a = rand() * Math.PI * 2;
    const d = Math.sqrt(rand()) * 0.75;
    return { x: Math.cos(a) * d, y: Math.sin(a) * d, r: 0.05 + rand() * 0.13 };
  });
}

type Preset = Omit<PlanetStyle, 'bands' | 'craters'> & { bands?: number; craters?: number };

const PRESETS: Record<string, Preset> = {
  jupiter: { kind: 'gas', hue: 28, accentHue: 18, saturation: 52, atmosphereHue: 32, bands: 9, ring: null },
  saturn: {
    kind: 'gas', hue: 42, accentHue: 34, saturation: 42, atmosphereHue: 44, bands: 7,
    ring: { tilt: -0.35, inner: 1.3, outer: 2.05, alpha: 0.55 },
  },
  venus: { kind: 'gas', hue: 44, accentHue: 38, saturation: 48, atmosphereHue: 48, bands: 4, ring: null },
  mars: { kind: 'rocky', hue: 14, accentHue: 8, saturation: 58, atmosphereHue: 20, craters: 7, ring: null },
  earth: { kind: 'rocky', hue: 212, accentHue: 140, saturation: 58, atmosphereHue: 205, craters: 5, ring: null },
  mercury: { kind: 'rocky', hue: 30, accentHue: 25, saturation: 10, atmosphereHue: 30, craters: 11, ring: null },
  moon: { kind: 'rocky', hue: 220, accentHue: 220, saturation: 6, atmosphereHue: 220, craters: 12, ring: null },
  luna: { kind: 'rocky', hue: 220, accentHue: 220, saturation: 6, atmosphereHue: 220, craters: 12, ring: null },
  pluto: { kind: 'rocky', hue: 26, accentHue: 18, saturation: 24, atmosphereHue: 30, craters: 6, ring: null },
  neptune: { kind: 'ice', hue: 222, accentHue: 230, saturation: 62, atmosphereHue: 215, bands: 4, ring: null },
  uranus: {
    kind: 'ice', hue: 186, accentHue: 180, saturation: 44, atmosphereHue: 185, bands: 3,
    ring: { tilt: -1.35, inner: 1.35, outer: 1.6, alpha: 0.35 },
  },
};

export function planetStyle(name: string): PlanetStyle {
  const key = name.trim().toLowerCase();
  const seed = hash(key);
  const rand = rng(seed);

  const preset = PRESETS[key];
  if (preset) {
    const { bands = 0, craters: c = 0, ...rest } = preset;
    return {
      ...rest,
      bands: preset.kind === 'rocky' ? [] : gasBands(rand, bands, preset.kind === 'ice' ? 6 : 12),
      craters: craters(rand, c),
    };
  }

  const kinds: PlanetKind[] = ['gas', 'gas', 'rocky', 'ice'];
  const kind = kinds[seed % kinds.length];
  const hue = (seed >>> 3) % 360;

  return {
    kind,
    hue,
    accentHue: (hue + 20 + ((seed >>> 9) % 40)) % 360,
    saturation: kind === 'rocky' ? 30 + ((seed >>> 5) % 30) : 40 + ((seed >>> 5) % 30),
    atmosphereHue: (hue + 10) % 360,
    bands: kind === 'rocky' ? [] : gasBands(rand, 4 + ((seed >>> 13) % 5), kind === 'ice' ? 6 : 12),
    craters: kind === 'rocky' ? craters(rand, 5 + ((seed >>> 11) % 6)) : [],
    ring:
      (seed >>> 21) % 4 === 0
        ? { tilt: -0.2 - ((seed >>> 17) % 50) / 100, inner: 1.3, outer: 1.85, alpha: 0.45 }
        : null,
  };
}

/** How far the drawing extends beyond the body, in radii. */
export function planetExtent(style: PlanetStyle): number {
  return style.ring ? style.ring.outer + 0.05 : 1.2;
}
