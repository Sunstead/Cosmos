/**
 * Deterministic planet appearance derived from a node's name.
 *
 * Every node gets a distinct, stable look with no art assets. Previously the
 * card did `src={'/' + host.name + '.png'}`, so the one node with a bundled
 * image rendered and every other one showed a broken-image icon.
 */

/** FNV-1a. Small, fast, and good enough to spread short names across hues. */
function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export interface PlanetStyle {
  /** Base hue in degrees. */
  hue: number;
  /** Complementary hue for banding. */
  accentHue: number;
  saturation: number;
  bands: { y: number; height: number; opacity: number }[];
  /** True for the handful of nodes that get a ring. */
  ring: boolean;
  ringTilt: number;
}

export function planetStyle(name: string): PlanetStyle {
  const h = hash(name);

  // Pull each property from a different slice of the hash so similar names
  // don't produce similar planets.
  const hue = h % 360;
  const accentHue = (hue + 25 + ((h >> 9) % 40)) % 360;
  const saturation = 45 + ((h >> 5) % 30);
  const bandCount = 3 + ((h >> 13) % 4);

  const bands = Array.from({ length: bandCount }, (_, i) => {
    const seed = (h >> (i * 3 + 2)) & 0xff;
    return {
      // Keep bands inside the sphere rather than clipping at the poles.
      y: 14 + ((seed % 72) / 100) * 72,
      height: 3 + (seed % 7),
      opacity: 0.08 + ((seed >> 4) % 10) / 55,
    };
  }).sort((a, b) => a.y - b.y);

  return {
    hue,
    accentHue,
    saturation,
    bands,
    ring: (h >> 21) % 5 === 0,
    ringTilt: -35 + ((h >> 17) % 40),
  };
}
