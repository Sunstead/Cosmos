import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { contrast, distance, over, parseColor, Rgba } from '@/test/color';
import { DEFAULT_PAIR, DEFAULT_THEME, THEMES, themeById } from '@/lib/themes';

// Read from disk: vitest stubs CSS imports, `?raw` included.
const files = readdirSync(__dirname)
  .filter((f) => f.endsWith('.css'))
  .map((f) => readFileSync(path.join(__dirname, f), 'utf8'));

/** Every `[data-theme='id'] { ... }` block, as token maps. */
function parseBlocks(): Map<string, Map<string, string>> {
  const blocks = new Map<string, Map<string, string>>();
  for (const css of files) {
    for (const m of css.matchAll(/\[data-theme='([\w-]+)'\]\s*\{([^}]*)\}/g)) {
      const tokens = new Map<string, string>();
      for (const t of m[2].matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) tokens.set(t[1], t[2].trim());
      expect(blocks.has(m[1]), `${m[1]} defined twice`).toBe(false);
      blocks.set(m[1], tokens);
    }
  }
  return blocks;
}

const blocks = parseBlocks();
const reference = blocks.get('cosmos-dark')!;

const HOLO = ['--holo-space', '--holo-primary', '--holo-secondary', '--holo-text', '--holo-dim', '--holo-glow'];
const CORE = [
  '--background',
  '--foreground',
  '--card',
  '--primary',
  '--sidebar',
  '--sidebar-accent',
  '--success',
  '--warning',
  '--error',
  '--cpu',
  '--ram',
  '--network',
  '--disk',
  '--mark-0',
  '--mark-1',
  '--ansi-0',
  '--ansi-15',
  '--glass-tint',
  '--space',
  '--planet-atmosphere',
  '--chart-5',
];

/** Text over a surface; translucent layers are composited down to the page. */
const PAIRS: [text: string, surface: string[]][] = [
  ['--foreground', ['--background']],
  ['--card-foreground', ['--card', '--background']],
  ['--muted-foreground', ['--background']],
  ['--muted-foreground', ['--card', '--background']],
  ['--popover-foreground', ['--popover', '--background']],
  ['--primary-foreground', ['--primary', '--background']],
  ['--sidebar-foreground', ['--sidebar']],
  ['--muted-foreground', ['--sidebar']],
  ['--sidebar-accent-foreground', ['--sidebar-accent', '--sidebar']],
];

/** Kept exactly as they were before themes; see the per-theme checks. */
const ORIGINALS = new Set(['cosmos-dark', 'cosmos-light']);

function flatten(tokens: Map<string, string>, layers: string[]): Rgba {
  const colours = layers.map((l) => parseColor(tokens.get(l)!));
  return colours.reduceRight((below, layer) => over(layer, below));
}

describe('themes', () => {
  it('registry and CSS agree', () => {
    expect([...blocks.keys()].sort()).toEqual(THEMES.map((t) => t.id).sort());
    expect(new Set(THEMES.map((t) => t.id)).size).toBe(THEMES.length);
    expect(themeById(DEFAULT_THEME)?.scheme).toBe('dark');
    expect(themeById(DEFAULT_PAIR.dark)?.scheme).toBe('dark');
    expect(themeById(DEFAULT_PAIR.light)?.scheme).toBe('light');
  });

  it('Cosmos Dark carries the core and hologram tokens', () => {
    for (const token of [...CORE, ...HOLO]) expect(reference.has(token), token).toBe(true);
  });

  it('index.html paints the same themes before any script', () => {
    const html = readFileSync(path.resolve(__dirname, '../../index.html'), 'utf8');
    const map = /var themes = \{([^}]*)\}/.exec(html)?.[1] ?? '';
    const entries = [...map.matchAll(/'?([\w-]+)'?:\s*'(dark|light)'/g)].map((m) => [m[1], m[2]]);
    expect(Object.fromEntries(entries)).toEqual(Object.fromEntries(THEMES.map((t) => [t.id, t.scheme])));
    expect(html).toContain(`data-theme="${DEFAULT_THEME}"`);
  });

  describe.each(THEMES.map((t) => [t.name, t] as const))('%s', (_, theme) => {
    const tokens = blocks.get(theme.id)!;
    const colour = (name: string) => parseColor(tokens.get(name)!);

    it('defines every token, and nothing else', () => {
      expect([...tokens.keys()].sort()).toEqual([...reference.keys()].sort());
    });

    it.each(PAIRS)('%s on %s meets WCAG AA', (text, surface) => {
      const bg = flatten(tokens, surface);
      const ratio = contrast(over(colour(text), bg), bg);
      expect(ratio, `${theme.id}: ${ratio.toFixed(2)}`).toBeGreaterThanOrEqual(4.5);
    });

    it('keeps the hologram dark', () => {
      const space = colour('--holo-space');
      expect(contrast(space, parseColor('#000000'))).toBeLessThan(1.25);
      expect(contrast(colour('--holo-text'), space)).toBeGreaterThanOrEqual(7);
      const glow = Number(tokens.get('--holo-glow'));
      expect(glow).toBeGreaterThanOrEqual(0);
      expect(glow).toBeLessThanOrEqual(1);
    });

    it.skipIf(ORIGINALS.has(theme.id))('tells metrics apart, from each other and from status', () => {
      const metrics = ['--cpu', '--ram', '--network', '--disk'];
      const status = ['--success', '--warning', '--error'];
      for (const [i, a] of metrics.entries()) {
        for (const b of metrics.slice(i + 1)) {
          expect(distance(colour(a), colour(b)), `${a} vs ${b}`).toBeGreaterThan(0.12);
        }
        for (const s of status) {
          expect(distance(colour(a), colour(s)), `${a} vs ${s}`).toBeGreaterThan(0.08);
        }
      }
    });

    it('shows the active sidebar item clearly, apart from a 60% hover', () => {
      // Steps between near-blacks read smaller than the same step in light.
      const min = theme.id === 'cosmos-light' ? 0 : theme.scheme === 'dark' ? 0.1 : 0.05;
      const sidebar = colour('--sidebar');
      const active = flatten(tokens, ['--sidebar-accent', '--sidebar']);
      expect(distance(active, sidebar)).toBeGreaterThanOrEqual(min);
    });
  });
});
