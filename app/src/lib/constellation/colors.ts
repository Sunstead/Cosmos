/**
 * CSS colours to numbers for WebGL. three.js parses hex and rgb() but not
 * oklch(), which every theme token uses, so the conversion is done here:
 * a small parser for the forms the themes use, and a 1x1 canvas probe for
 * anything else (named colours, color-mix()).
 */

/** sRGB, every channel 0..1. */
export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/** A number, a percentage of `percentOf`, or `none` (0). */
function num(token: string, percentOf = 1): number {
  if (token === 'none') return 0;
  if (token.endsWith('%')) return (parseFloat(token) / 100) * percentOf;
  return parseFloat(token);
}

/** Hue in degrees, from `250`, `250deg`, `1.2rad` or `0.5turn`. */
function hue(token: string): number {
  if (token === 'none') return 0;
  if (token.endsWith('rad')) return (parseFloat(token) * 180) / Math.PI;
  if (token.endsWith('turn')) return parseFloat(token) * 360;
  return parseFloat(token);
}

/** Splits `fn(a b c / d)` or `fn(a, b, c, d)` into its channels and alpha. */
function args(body: string): { channels: string[]; alpha: string | null } | null {
  const [main, alpha] = body.split('/').map((s) => s.trim());
  const channels = main.split(/[\s,]+/).filter(Boolean);
  if (channels.length === 4 && alpha === undefined) return { channels: channels.slice(0, 3), alpha: channels[3] };
  if (channels.length !== 3) return null;
  return { channels, alpha: alpha ?? null };
}

const linearToSrgb = (x: number) => (x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055);
const srgbToLinear = (x: number) => (x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4));

/** OKLab to gamma-encoded sRGB, clipped to the gamut. */
export function oklabToRgb(L: number, a: number, b: number, alpha = 1): Rgba {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return {
    r: clamp01(linearToSrgb(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s)),
    g: clamp01(linearToSrgb(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s)),
    b: clamp01(linearToSrgb(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s)),
    a: clamp01(alpha),
  };
}

/** Gamma-encoded sRGB to OKLab. */
export function rgbToOklab({ r, g, b }: Rgba): [number, number, number] {
  const lr = srgbToLinear(r);
  const lg = srgbToLinear(g);
  const lb = srgbToLinear(b);
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function parseHex(hex: string): Rgba | null {
  const h = hex.slice(1);
  if (!/^[0-9a-f]+$/i.test(h) || ![3, 4, 6, 8].includes(h.length)) return null;
  const full = h.length <= 4 ? [...h].map((c) => c + c).join('') : h;
  const byte = (i: number) => parseInt(full.slice(i * 2, i * 2 + 2), 16) / 255;
  return { r: byte(0), g: byte(1), b: byte(2), a: full.length === 8 ? byte(3) : 1 };
}

/**
 * Parses the colour forms the themes use: hex, rgb()/rgba(), oklch() and
 * oklab(). Returns null for anything else.
 */
export function parseCssColor(input: string): Rgba | null {
  const css = input.trim().toLowerCase();
  if (css.startsWith('#')) return parseHex(css);

  const fn = /^([a-z]+)\((.*)\)$/.exec(css);
  if (!fn) return null;
  const parsed = args(fn[2]);
  if (!parsed) return null;
  const [c0, c1, c2] = parsed.channels;
  const alpha = parsed.alpha === null ? 1 : num(parsed.alpha);
  if ([c0, c1, c2].some((c) => c !== 'none' && Number.isNaN(parseFloat(c))) || Number.isNaN(alpha)) return null;

  switch (fn[1]) {
    case 'rgb':
    case 'rgba':
      return {
        r: clamp01(num(c0, 255) / 255),
        g: clamp01(num(c1, 255) / 255),
        b: clamp01(num(c2, 255) / 255),
        a: clamp01(alpha),
      };
    case 'oklch': {
      const h = (hue(c2) * Math.PI) / 180;
      const C = num(c1, 0.4);
      return oklabToRgb(num(c0), C * Math.cos(h), C * Math.sin(h), alpha);
    }
    case 'oklab':
      return oklabToRgb(num(c0), num(c1, 0.4), num(c2, 0.4), alpha);
    default:
      return null;
  }
}

let probe: CanvasRenderingContext2D | null | undefined;

/** Lets the browser resolve a colour we don't parse, by painting one pixel. */
function probeWithCanvas(css: string): Rgba | null {
  if (probe === undefined) {
    try {
      probe = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
    } catch {
      probe = null;
    }
  }
  if (!probe) return null;
  probe.clearRect(0, 0, 1, 1);
  probe.fillStyle = '#000';
  probe.fillStyle = css;
  probe.fillRect(0, 0, 1, 1);
  const [r, g, b, a] = probe.getImageData(0, 0, 1, 1).data;
  return { r: r / 255, g: g / 255, b: b / 255, a: a / 255 };
}

/** Any CSS colour to sRGB, or `fallback` when it can't be resolved. */
export function cssToRgba(css: string, fallback: Rgba = { r: 0, g: 0, b: 0, a: 1 }): Rgba {
  if (!css) return fallback;
  return parseCssColor(css) ?? probeWithCanvas(css) ?? fallback;
}

/**
 * Raises a colour's OKLab lightness to at least `min`, keeping its hue and
 * chroma. Status colours from a light theme are tuned for white surfaces;
 * the hologram is always dark, so they are lifted until they read on it.
 */
export function ensureLightness(c: Rgba, min: number): Rgba {
  const [L, a, b] = rgbToOklab(c);
  if (L >= min) return c;
  return oklabToRgb(min, a, b, c.a);
}

/** `#rrggbb`, for CSS custom properties derived from tokens. */
export function rgbaToHex({ r, g, b }: Rgba): string {
  const h = (n: number) => Math.round(clamp01(n) * 255).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}
