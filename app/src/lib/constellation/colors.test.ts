import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { cssToRgba, ensureLightness, parseCssColor, rgbaToHex, rgbToOklab } from './colors';

// Every stylesheet, wherever the theme blocks live. Read from disk: vitest
// runs with `css: false`, which empties `?raw` CSS imports.
const SRC = path.resolve(__dirname, '../..');
const appCss = readdirSync(SRC, { recursive: true, encoding: 'utf8' })
  .filter((f) => f.endsWith('.css'))
  .map((f) => readFileSync(path.join(SRC, f), 'utf8'))
  .join('\n');

const close = (a: number, b: number, eps = 0.01) => Math.abs(a - b) <= eps;

describe('parseCssColor', () => {
  it('reads hex in every length', () => {
    expect(parseCssColor('#fff')).toEqual({ r: 1, g: 1, b: 1, a: 1 });
    expect(parseCssColor('#000000')).toEqual({ r: 0, g: 0, b: 0, a: 1 });
    expect(parseCssColor('#0b0b0fa2')!.a).toBeCloseTo(0xa2 / 255);
    expect(parseCssColor('#ff000080')!.r).toBe(1);
    expect(parseCssColor('#xyz')).toBeNull();
  });

  it('reads rgb() with commas, spaces and alpha', () => {
    expect(parseCssColor('rgb(255, 0, 0)')).toEqual({ r: 1, g: 0, b: 0, a: 1 });
    expect(parseCssColor('rgba(0, 0, 255, 0.5)')).toEqual({ r: 0, g: 0, b: 1, a: 0.5 });
    expect(parseCssColor('rgb(0 255 0 / 25%)')).toEqual({ r: 0, g: 1, b: 0, a: 0.25 });
  });

  it('converts oklch to sRGB', () => {
    const white = parseCssColor('oklch(1 0 0)')!;
    expect([white.r, white.g, white.b].every((c) => close(c, 1))).toBe(true);
    const black = parseCssColor('oklch(0 0 0)')!;
    expect([black.r, black.g, black.b].every((c) => close(c, 0))).toBe(true);
    // The OKLCH coordinates of sRGB red.
    const red = parseCssColor('oklch(0.62796 0.25768 29.2339)')!;
    expect(close(red.r, 1) && close(red.g, 0) && close(red.b, 0)).toBe(true);
    // Percent lightness, degrees and alpha, as the themes write them.
    const orbit = parseCssColor('oklch(87% 0.06 272 / 0.1)')!;
    expect(orbit.a).toBeCloseTo(0.1);
    expect(orbit.b).toBeGreaterThan(orbit.r);
    expect(parseCssColor('oklch(96.32% 0.00353 248.568deg)')!.r).toBeGreaterThan(0.9);
  });

  it('converts oklab', () => {
    const grey = parseCssColor('oklab(0.5 0 0)')!;
    expect(close(grey.r, grey.g) && close(grey.g, grey.b)).toBe(true);
  });

  it('gives up on forms it does not know', () => {
    expect(parseCssColor('color-mix(in srgb, red, blue)')).toBeNull();
    expect(parseCssColor('rebeccapurple')).toBeNull();
    expect(parseCssColor('oklch(nope 0 0)')).toBeNull();
  });

  it('parses every hologram and status token in the themes', () => {
    const names = ['holo-space', 'holo-primary', 'holo-secondary', 'holo-text', 'holo-dim', 'success', 'warning', 'error'];
    for (const name of names) {
      const values = [...appCss.matchAll(new RegExp(`--${name}:\\s*([^;]+);`, 'g'))].map((m) => m[1]);
      expect(values.length, name).toBeGreaterThanOrEqual(2);
      for (const v of values) expect(parseCssColor(v), `${name}: ${v}`).not.toBeNull();
    }
  });

  it('keeps the hologram viewport dark in every theme', () => {
    for (const [, v] of appCss.matchAll(/--holo-space:\s*([^;]+);/g)) {
      expect(rgbToOklab(parseCssColor(v)!)[0], v).toBeLessThan(0.3);
    }
  });
});

describe('cssToRgba', () => {
  it('falls back when nothing resolves', () => {
    const fallback = { r: 0.1, g: 0.2, b: 0.3, a: 1 };
    expect(cssToRgba('', fallback)).toBe(fallback);
  });
});

describe('ensureLightness', () => {
  it('lifts dark colours and leaves light ones', () => {
    const dark = parseCssColor('#b91c1c')!;
    const lifted = ensureLightness(dark, 0.72);
    expect(rgbToOklab(lifted)[0]).toBeGreaterThan(rgbToOklab(dark)[0]);
    // Still red.
    expect(lifted.r).toBeGreaterThan(lifted.g);
    const light = parseCssColor('#efd215')!;
    expect(ensureLightness(light, 0.5)).toBe(light);
  });
});

describe('rgbaToHex', () => {
  it('round-trips hex', () => {
    expect(rgbaToHex(parseCssColor('#2dba5f')!)).toBe('#2dba5f');
  });
});
