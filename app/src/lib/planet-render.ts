import { planetExtent, PlanetStyle, planetStyle } from './planet';
import { canvasTokens, CanvasTokens } from './theme-tokens';

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

const hsl = (h: number, s: number, l: number, a = 1) =>
  `hsl(${h} ${s}% ${Math.max(0, Math.min(100, l))}% / ${a})`;

function drawRing(ctx: Ctx, style: PlanetStyle, r: number, front: boolean, t: CanvasTokens) {
  const ring = style.ring!;
  ctx.save();
  ctx.rotate(ring.tilt);
  // The half nearer the viewer is drawn over the body, the far half under it.
  ctx.beginPath();
  ctx.rect(-r * 3, front ? 0 : -r * 3, r * 6, r * 3);
  ctx.clip();
  for (let i = 0; i < 3; i += 1) {
    const k = ring.inner + ((ring.outer - ring.inner) * (i + 0.5)) / 3;
    ctx.beginPath();
    ctx.ellipse(0, 0, r * k, r * k * 0.28, 0, 0, Math.PI * 2);
    ctx.lineWidth = (r * (ring.outer - ring.inner)) / 3.4;
    ctx.strokeStyle = hsl(style.accentHue, style.saturation * 0.6, t.planetLight - i * 6, ring.alpha * (1 - i * 0.2));
    ctx.stroke();
  }
  ctx.restore();
}

/** Draws a planet centred at the origin with body radius `r`. */
export function drawPlanet(ctx: Ctx, style: PlanetStyle, r: number, t = canvasTokens()) {
  const { hue, accentHue, saturation: s } = style;

  if (style.ring) drawRing(ctx, style, r, false, t);

  // Atmosphere glow outside the body.
  const glow = ctx.createRadialGradient(0, 0, r * 0.95, 0, 0, r * 1.2);
  glow.addColorStop(0, hsl(style.atmosphereHue, 70, t.planetLight, t.atmosphere * 0.6));
  glow.addColorStop(1, hsl(style.atmosphereHue, 70, t.planetLight, 0));
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(0, 0, r * 1.2, 0, Math.PI * 2);
  ctx.fill();

  ctx.save();
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.clip();

  // Base colour.
  ctx.fillStyle = hsl(hue, s, t.planetMid);
  ctx.fillRect(-r, -r, r * 2, r * 2);

  // Surface detail.
  for (const b of style.bands) {
    ctx.fillStyle = hsl(accentHue, s, t.planetMid + b.light, b.alpha);
    ctx.beginPath();
    ctx.ellipse(0, b.y * r, r * 1.1, b.h * r, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  for (const c of style.craters) {
    ctx.fillStyle = hsl(hue, s * 0.8, t.planetMid - 12, 0.55);
    ctx.beginPath();
    ctx.arc(c.x * r, c.y * r, c.r * r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = hsl(hue, s * 0.6, t.planetMid + 14, 0.35);
    ctx.lineWidth = Math.max(0.5, c.r * r * 0.25);
    ctx.beginPath();
    ctx.arc(c.x * r - c.r * r * 0.15, c.y * r - c.r * r * 0.15, c.r * r, Math.PI, Math.PI * 1.6);
    ctx.stroke();
  }
  if (style.kind === 'rocky' && accentHue !== hue && s > 20) {
    // Landmasses: a few soft patches in the accent hue.
    ctx.fillStyle = hsl(accentHue, s * 0.8, t.planetMid - 4, 0.5);
    for (const c of style.craters.slice(0, 3)) {
      ctx.beginPath();
      ctx.ellipse(c.x * r, c.y * r, c.r * r * 2.2, c.r * r * 1.4, c.x, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Terminator: lit from the upper left, falling into shadow.
  const light = ctx.createRadialGradient(-r * 0.4, -r * 0.45, r * 0.05, -r * 0.1, -r * 0.1, r * 1.45);
  light.addColorStop(0, hsl(hue, s * 0.5, t.planetLight + 18, 0.5));
  light.addColorStop(0.35, hsl(hue, s, t.planetLight, 0));
  light.addColorStop(0.75, hsl(hue, s, t.planetShade, 0.55));
  light.addColorStop(1, hsl(hue, s, t.planetShade * 0.5, 0.95));
  ctx.fillStyle = light;
  ctx.fillRect(-r, -r, r * 2, r * 2);
  ctx.restore();

  // Rim light on the lit edge.
  ctx.beginPath();
  ctx.arc(0, 0, r - 0.5, Math.PI * 0.95, Math.PI * 1.75);
  ctx.strokeStyle = hsl(style.atmosphereHue, 80, t.planetLight + 15, t.atmosphere);
  ctx.lineWidth = Math.max(1, r * 0.06);
  ctx.stroke();

  if (style.ring) drawRing(ctx, style, r, true, t);
}

export interface Sprite {
  canvas: HTMLCanvasElement | OffscreenCanvas;
  /** Sprite side length in CSS pixels; the body radius is `r`. */
  size: number;
}

const sprites = new Map<string, Sprite>();
const MAX_SPRITES = 64;

/** A cached rendering of a planet with body radius `r` CSS pixels. */
export function planetSprite(name: string, r: number, dpr = window.devicePixelRatio || 1): Sprite {
  const t = canvasTokens();
  const key = `${name}|${Math.round(r * 2) / 2}|${dpr}|${t.theme}`;
  const hit = sprites.get(key);
  if (hit) return hit;

  const style = planetStyle(name);
  const size = Math.ceil(r * planetExtent(style) * 2);
  const px = Math.ceil(size * dpr);
  const canvas =
    typeof OffscreenCanvas !== 'undefined'
      ? new OffscreenCanvas(px, px)
      : Object.assign(document.createElement('canvas'), { width: px, height: px });
  const ctx = canvas.getContext('2d') as Ctx | null;
  if (ctx) {
    ctx.scale(dpr, dpr);
    ctx.translate(size / 2, size / 2);
    drawPlanet(ctx, style, r, t);
  }

  if (sprites.size >= MAX_SPRITES) sprites.delete(sprites.keys().next().value!);
  const sprite = { canvas, size };
  sprites.set(key, sprite);
  return sprite;
}
