import { useEffect, useRef } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useTailnet } from '@/api/queries';
import { getConnection, nodeDisplayName, useNodeStore } from '@/stores/nodes';
import { useContainersStore } from '@/stores/containers';
import { userFacingServices } from '@/lib/services';
import { planetSprite } from '@/lib/planet-render';
import { cn } from '@/lib/utils';
import { canvasTokens, onThemeChange, CanvasTokens } from '@/lib/theme-tokens';
import { buildStarfield, drawStarfield, Starfield } from '@/lib/starfield';

const TAU = Math.PI * 2;
const FRAME_MS = 1000 / 30;
/** Vertical squash of orbits, for a tilted-plane look. */
const TILT = 0.42;

interface Satellite {
  id: string;
  angle: number;
  speed: number;
  ok: boolean;
}

export interface Body {
  nodeId: string;
  name: string;
  angle: number;
  speed: number;
  /** Body radius in CSS px, from memory capacity. */
  radius: number;
  load: number;
  online: boolean;
  satellites: Satellite[];
  x: number;
  y: number;
  unsubscribe: () => void;
}

/**
 * A tailnet device that isn't a Cosmos node: a phone, a laptop, the desktop.
 * Drifts on a slow outer belt, small and unlabelled until hovered.
 */
export interface Drifter {
  id: string;
  name: string;
  online: boolean;
  angle: number;
  speed: number;
  x: number;
  y: number;
}

/** Radius from total memory, compressed so large hosts don't dwarf small ones. */
export function bodyRadius(memBytes: number): number {
  const gb = memBytes / 1024 ** 3;
  return Math.round(14 + Math.min(Math.sqrt(gb) * 2.4, 22));
}

/** Orbit radius as a fraction of the available span, innermost first. */
export function orbitFraction(index: number, count: number): number {
  if (count === 1) return 0;
  return 0.38 + (index / Math.max(count - 1, 1)) * 0.52;
}

/**
 * The cluster as an orrery over a starfield. Canvas, driven by direct
 * stream subscriptions; React only mounts it. Bodies persist across node
 * list changes so nothing snaps back to its start position.
 */
export function Constellation({ className }: { className?: string }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const bodies = useRef(new Map<string, Body>());
  const drifters = useRef(new Map<string, Drifter>());
  const hover = useRef<string | null>(null);
  const { devices } = useTailnet();
  const navigate = useNavigate();
  const navigateRef = useRef(navigate);
  useEffect(() => {
    navigateRef.current = navigate;
  }, [navigate]);

  // A string, so it only changes when the set of nodes does.
  const ids = useNodeStore((s) => s.nodes.map((n) => n.id).join('|'));

  // Reconcile bodies with the node list.
  useEffect(() => {
    const current = bodies.current;
    const wanted = ids ? ids.split('|') : [];

    for (const [id, body] of current) {
      if (!wanted.includes(id)) {
        body.unsubscribe();
        current.delete(id);
      }
    }

    wanted.forEach((id, i) => {
      if (current.has(id)) return;
      const body: Body = {
        nodeId: id,
        name: '',
        angle: (i / Math.max(wanted.length, 1)) * TAU + 0.6,
        speed: 0.000045 / (0.5 + i * 0.3),
        radius: 18,
        load: 0,
        online: false,
        satellites: [],
        x: 0,
        y: 0,
        unsubscribe: () => {},
      };
      const conn = getConnection(id);
      body.unsubscribe =
        conn?.onHost((host) => {
          body.load = Math.min(host.cpu_pct / 100, 1);
          body.radius = bodyRadius(host.mem_total_bytes);
        }) ?? (() => {});
      current.set(id, body);
    });
  }, [ids]);

  // Names, status and services come from stores; no React renders involved.
  useEffect(() => {
    const syncNodes = () => {
      const { nodes, meta } = useNodeStore.getState();
      for (const n of nodes) {
        const body = bodies.current.get(n.id);
        if (!body) continue;
        body.name = nodeDisplayName(n);
        body.online = meta[n.id]?.status === 'online';
      }
    };
    const syncServices = () => {
      const services = userFacingServices(useContainersStore.getState().services);
      for (const body of bodies.current.values()) {
        const mine = services.filter((s) => s.nodeId === body.nodeId).slice(0, 10);
        const prev = new Map(body.satellites.map((s) => [s.id, s]));
        body.satellites = mine.map((s, j) => {
          const existing = prev.get(s.key);
          return {
            id: s.key,
            angle: existing?.angle ?? (j / Math.max(mine.length, 1)) * TAU,
            speed: 0.0007 + (j % 4) * 0.00012,
            ok: s.status === 'running',
          };
        });
      }
    };
    syncNodes();
    syncServices();
    const a = useNodeStore.subscribe(syncNodes);
    const b = useContainersStore.subscribe(syncServices);
    return () => {
      a();
      b();
    };
  }, [ids]);

  // Reconcile the belt with the tailnet. Positions survive polls.
  useEffect(() => {
    const current = drifters.current;
    const wanted = devices.filter((d) => d.nodeId === null);
    const ids = new Set(wanted.map((d) => d.id));
    for (const id of current.keys()) if (!ids.has(id)) current.delete(id);
    wanted.forEach((d, i) => {
      const existing = current.get(d.id);
      if (existing) {
        existing.name = d.name;
        existing.online = d.online;
        return;
      }
      current.set(d.id, {
        id: d.id,
        name: d.name,
        online: d.online,
        // Golden-angle spacing, so late arrivals don't bunch up.
        angle: i * 2.39996 + 1.1,
        speed: 0.000012 + (i % 3) * 0.000004,
        x: 0,
        y: 0,
      });
    });
  }, [devices]);

  // Render loop: set up once.
  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!wrap || !canvas || !ctx) return;

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let tokens: CanvasTokens = canvasTokens();
    let width = 0;
    let height = 0;
    let stars: Starfield | null = null;
    let frame = 0;
    let visible = true;
    let last = performance.now();
    let lastDraw = 0;

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      const rect = wrap.getBoundingClientRect();
      if (rect.width === width && rect.height === height) return;
      width = rect.width;
      height = rect.height;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      stars = buildStarfield(width, height, dpr, tokens);
      if (reduceMotion) draw(performance.now());
    };

    const draw = (now: number) => {
      const dt = reduceMotion ? 0 : Math.min(now - last, 100);
      last = now;
      if (!width || !height) return;

      ctx.clearRect(0, 0, width, height);
      if (stars) drawStarfield(ctx, stars, now, reduceMotion);

      const list = [...bodies.current.values()];
      const cx = width / 2;
      const cy = height / 2;
      const span = Math.min(width / 2, height / 2 / TILT) - 48;

      if (list.length > 1) {
        // A faint core the planets orbit.
        const core = ctx.createRadialGradient(cx, cy, 0, cx, cy, 36);
        core.addColorStop(0, tokens.star);
        core.addColorStop(1, 'transparent');
        ctx.globalAlpha = 0.35;
        ctx.fillStyle = core;
        ctx.beginPath();
        ctx.arc(cx, cy, 36, 0, TAU);
        ctx.fill();
        ctx.globalAlpha = 1;

        ctx.strokeStyle = tokens.orbit;
        ctx.lineWidth = 1;
        list.forEach((_, i) => {
          const o = orbitFraction(i, list.length) * span;
          ctx.beginPath();
          ctx.ellipse(cx, cy, o, o * TILT, 0, 0, TAU);
          ctx.stroke();
        });
      }

      // The device belt sits just outside the outermost orbit.
      const beltR = span * (list.length > 1 ? 1.02 : 0.62);
      const drift = [...drifters.current.values()];
      for (const d of drift) {
        d.angle += d.speed * dt;
        d.x = cx + Math.cos(d.angle) * beltR;
        d.y = cy + Math.sin(d.angle) * beltR * TILT;
      }
      if (drift.length > 0) {
        ctx.save();
        ctx.setLineDash([2, 6]);
        ctx.strokeStyle = tokens.orbit;
        ctx.globalAlpha = 0.7;
        ctx.beginPath();
        ctx.ellipse(cx, cy, beltR, beltR * TILT, 0, 0, TAU);
        ctx.stroke();
        ctx.restore();
      }
      const drawDrifters = (front: boolean) => {
        for (const d of drift) {
          if (front !== d.y >= cy) continue;
          const hovered = hover.current === `device:${d.id}`;
          if (d.online) {
            const glow = ctx.createRadialGradient(d.x, d.y, 0, d.x, d.y, 9);
            glow.addColorStop(0, tokens.star);
            glow.addColorStop(1, 'transparent');
            ctx.globalAlpha = 0.35;
            ctx.fillStyle = glow;
            ctx.beginPath();
            ctx.arc(d.x, d.y, 9, 0, TAU);
            ctx.fill();
          }
          // A ringed point, so a device doesn't read as one more star.
          const r = hovered ? 4.5 : 3.5;
          ctx.globalAlpha = d.online ? 0.9 : 0.35;
          ctx.strokeStyle = d.online ? tokens.star : tokens.muted;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.arc(d.x, d.y, r, 0, TAU);
          ctx.stroke();
          ctx.fillStyle = d.online ? tokens.star : tokens.muted;
          ctx.beginPath();
          ctx.arc(d.x, d.y, 1.5, 0, TAU);
          ctx.fill();
          if (hovered) {
            ctx.globalAlpha = 1;
            ctx.fillStyle = d.online ? tokens.foreground : tokens.muted;
            ctx.fillText(d.online ? d.name : `${d.name} (offline)`, d.x, d.y - 10);
          }
        }
        ctx.globalAlpha = 1;
      };
      ctx.font = '500 11px "Inter Variable", system-ui, sans-serif';
      ctx.textAlign = 'center';
      drawDrifters(false);

      // Draw back to front so nearer planets overlap farther ones.
      const placed = list.map((body, i) => {
        body.angle += body.speed * dt;
        const o = orbitFraction(i, list.length) * span;
        body.x = cx + Math.cos(body.angle) * o;
        body.y = cy + Math.sin(body.angle) * o * TILT;
        return body;
      });
      placed.sort((a, b) => a.y - b.y);

      for (const body of placed) {
        const r = body.radius;
        const hovered = hover.current === body.nodeId;

        // Load halo, brighter when busy.
        const haloR = r * (2 + body.load * 0.8);
        const halo = ctx.createRadialGradient(body.x, body.y, r * 0.9, body.x, body.y, haloR);
        halo.addColorStop(0, body.online ? tokens.orbit : 'transparent');
        halo.addColorStop(1, 'transparent');
        ctx.globalAlpha = body.online ? 0.6 + body.load * 1.4 : 0.2;
        ctx.fillStyle = halo;
        ctx.beginPath();
        ctx.arc(body.x, body.y, haloR, 0, TAU);
        ctx.fill();

        // Satellites behind the planet.
        const drawSats = (front: boolean) => {
          for (const s of body.satellites) {
            if (front === Math.sin(s.angle) < 0) continue;
            const sx = body.x + Math.cos(s.angle) * r * 1.9;
            const sy = body.y + Math.sin(s.angle) * r * 0.7;
            ctx.globalAlpha = body.online ? 0.95 : 0.3;
            ctx.fillStyle = s.ok ? tokens.success : tokens.warning;
            ctx.beginPath();
            ctx.arc(sx, sy, 2, 0, TAU);
            ctx.fill();
          }
        };
        for (const s of body.satellites) s.angle += s.speed * dt;
        drawSats(false);

        const sprite = planetSprite(body.name || body.nodeId, r);
        ctx.globalAlpha = body.online ? 1 : 0.4;
        ctx.drawImage(sprite.canvas, body.x - sprite.size / 2, body.y - sprite.size / 2, sprite.size, sprite.size);
        drawSats(true);

        if (hovered) {
          ctx.globalAlpha = 0.8;
          ctx.strokeStyle = tokens.foreground;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.arc(body.x, body.y, r + 5, 0, TAU);
          ctx.stroke();
        }

        ctx.globalAlpha = hovered ? 1 : body.online ? 0.8 : 0.5;
        ctx.fillStyle = body.online ? tokens.foreground : tokens.muted;
        ctx.fillText(body.name, body.x, body.y + r + 18);
        if (hovered && body.online) {
          ctx.fillStyle = tokens.muted;
          ctx.fillText(`${Math.round(body.load * 100)}% CPU`, body.x, body.y + r + 32);
        }
        ctx.globalAlpha = 1;
      }

      drawDrifters(true);
    };

    const loop = (now: number) => {
      frame = requestAnimationFrame(loop);
      if (!visible || now - lastDraw < FRAME_MS) return;
      lastDraw = now;
      draw(now);
    };

    const ro = new ResizeObserver(resize);
    ro.observe(wrap);
    resize();

    const io = new IntersectionObserver(([e]) => {
      visible = e.isIntersecting;
    });
    io.observe(wrap);

    const stopTheme = onThemeChange(() => {
      tokens = canvasTokens();
      stars = buildStarfield(width, height, window.devicePixelRatio || 1, tokens);
      if (reduceMotion) draw(performance.now());
    });

    if (reduceMotion) {
      draw(performance.now());
      // Still reflect hover and data changes, just without motion.
      frame = window.setInterval(() => draw(performance.now()), 1000) as unknown as number;
    } else {
      frame = requestAnimationFrame(loop);
    }

    const hit = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      for (const body of bodies.current.values()) {
        if ((mx - body.x) ** 2 + (my - body.y) ** 2 <= (body.radius + 8) ** 2) return body;
      }
      return null;
    };
    const hitDrifter = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      for (const d of drifters.current.values()) {
        if ((mx - d.x) ** 2 + (my - d.y) ** 2 <= 10 ** 2) return d;
      }
      return null;
    };
    const onMove = (e: MouseEvent) => {
      const body = hit(e);
      const drifter = body ? null : hitDrifter(e);
      hover.current = body?.nodeId ?? (drifter ? `device:${drifter.id}` : null);
      canvas.style.cursor = body || drifter ? 'pointer' : 'default';
    };
    const onLeave = () => {
      hover.current = null;
    };
    const onClick = (e: MouseEvent) => {
      const body = hit(e);
      if (body) void navigateRef.current({ to: '/nodes/$nodeId', params: { nodeId: body.nodeId } });
      else if (hitDrifter(e)) void navigateRef.current({ to: '/network' });
    };
    canvas.addEventListener('mousemove', onMove);
    canvas.addEventListener('mouseleave', onLeave);
    canvas.addEventListener('click', onClick);

    return () => {
      cancelAnimationFrame(frame);
      clearInterval(frame);
      ro.disconnect();
      io.disconnect();
      stopTheme();
      canvas.removeEventListener('mousemove', onMove);
      canvas.removeEventListener('mouseleave', onLeave);
      canvas.removeEventListener('click', onClick);
    };
  }, []);

  // Release stream subscriptions on unmount.
  useEffect(() => {
    const map = bodies.current;
    return () => {
      for (const body of map.values()) body.unsubscribe();
      map.clear();
    };
  }, []);

  return (
    <div ref={wrapRef} className={cn('relative', className)} data-constellation>
      {/* Absolute: an in-flow canvas feeds its pixel size back into layout in WebKit. */}
      <canvas ref={canvasRef} className='absolute inset-0 size-full' aria-label='Node map' role='img' />
    </div>
  );
}
