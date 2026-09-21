import { CanvasTokens } from './theme-tokens';

type Ctx = CanvasRenderingContext2D;

interface Layer {
  canvas: HTMLCanvasElement | OffscreenCanvas;
  /** Drift in CSS px per second. */
  speed: number;
}

interface Twinkle {
  x: number;
  y: number;
  r: number;
  phase: number;
  period: number;
}

export interface Starfield {
  width: number;
  height: number;
  layers: Layer[];
  twinkles: Twinkle[];
  background: string;
  star: string;
}

function makeCanvas(w: number, h: number) {
  return typeof OffscreenCanvas !== 'undefined'
    ? new OffscreenCanvas(w, h)
    : Object.assign(document.createElement('canvas'), { width: w, height: h });
}

/** Seeded so a resize keeps the same sky. */
function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/**
 * Pre-renders three depth layers once per size and theme. Each frame only
 * blits them with an offset, so the sky costs a few drawImage calls.
 */
export function buildStarfield(width: number, height: number, dpr: number, t: CanvasTokens): Starfield {
  const rand = rng(42);
  const area = width * height;
  const specs = [
    { density: 1 / 2600, size: [0.4, 0.8], alpha: [0.25, 0.5], speed: 1.2 },
    { density: 1 / 7000, size: [0.6, 1.1], alpha: [0.4, 0.7], speed: 2.6 },
    { density: 1 / 22000, size: [0.9, 1.5], alpha: [0.6, 0.95], speed: 4.5 },
  ];

  const layers = specs.map((spec) => {
    const canvas = makeCanvas(Math.max(1, Math.ceil(width * dpr)), Math.max(1, Math.ceil(height * dpr)));
    const ctx = canvas.getContext('2d') as Ctx | null;
    if (ctx) {
      ctx.scale(dpr, dpr);
      ctx.fillStyle = t.star;
      const n = Math.round(area * spec.density);
      for (let i = 0; i < n; i += 1) {
        ctx.globalAlpha = spec.alpha[0] + rand() * (spec.alpha[1] - spec.alpha[0]);
        ctx.beginPath();
        ctx.arc(rand() * width, rand() * height, spec.size[0] + rand() * (spec.size[1] - spec.size[0]), 0, Math.PI * 2);
        ctx.fill();
      }
    }
    return { canvas, speed: spec.speed };
  });

  const twinkles = Array.from({ length: Math.round(area / 30000) + 4 }, () => ({
    x: rand() * width,
    y: rand() * height,
    r: 0.8 + rand() * 0.8,
    phase: rand() * Math.PI * 2,
    period: 2500 + rand() * 4000,
  }));

  return { width, height, layers, twinkles, background: t.space, star: t.star };
}

/** Blits the layers with slow horizontal parallax, wrapping at the edge. */
export function drawStarfield(ctx: Ctx, f: Starfield, now: number, still: boolean) {
  ctx.fillStyle = f.background;
  ctx.fillRect(0, 0, f.width, f.height);

  for (const layer of f.layers) {
    const offset = still ? 0 : ((now / 1000) * layer.speed) % f.width;
    ctx.drawImage(layer.canvas, -offset, 0, f.width, f.height);
    if (offset > 0) ctx.drawImage(layer.canvas, f.width - offset, 0, f.width, f.height);
  }

  ctx.fillStyle = f.star;
  for (const s of f.twinkles) {
    ctx.globalAlpha = still ? 0.6 : 0.25 + 0.75 * (0.5 + 0.5 * Math.sin(now / s.period * Math.PI * 2 + s.phase));
    ctx.beginPath();
    ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}
