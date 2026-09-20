import { useEffect, useRef } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useNodeStore, getConnection } from '@/stores/nodes';
import { useContainersStore } from '@/stores/containers';
import { planetStyle } from '@/lib/planet';
import { userFacingServices } from '@/lib/services';

interface Body {
  nodeId: string;
  name: string;
  /** Orbit radius as a fraction of the available space. */
  orbit: number;
  angle: number;
  speed: number;
  radius: number;
  hue: number;
  accentHue: number;
  saturation: number;
  /** 0–1, drives the halo. */
  load: number;
  online: boolean;
  satellites: { angle: number; speed: number; ok: boolean }[];
  /** Filled during draw, used for hit testing. */
  x: number;
  y: number;
}

const TAU = Math.PI * 2;

/**
 * The cluster, drawn as an orrery.
 *
 * Canvas rather than DOM: this animates continuously, and a few hundred
 * shapes a frame is nothing for a canvas while being a lot of layout for the
 * DOM. Nothing here touches React state — node data arrives through direct
 * stream subscriptions and is written into a mutable array the render loop
 * reads.
 *
 * The loop stops when the page is hidden (`requestAnimationFrame` simply
 * stops firing) and never starts if the viewer prefers reduced motion, in
 * which case a single static frame is drawn instead.
 */
export function Constellation({ className }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const nodes = useNodeStore((s) => s.nodes);
  const navigate = useNavigate();

  // Read once per effect run rather than subscribing: service counts change
  // rarely and a stale count for a few seconds is harmless.
  const servicesRef = useRef(useContainersStore.getState().services);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = canvas?.parentElement;
    if (!canvas || !container) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    // Canvas cannot resolve `var(--x)`, so read the theme tokens once here
    // rather than hardcoding hexes that would drift from the stylesheet.
    const theme = getComputedStyle(document.documentElement);
    const token = (name: string, fallback: string) =>
      theme.getPropertyValue(name).trim() || fallback;

    const colors = {
      success: token('--success', '#2dba5f'),
      muted: token('--muted-foreground', '#8b8f9a'),
      foreground: token('--foreground', '#fafafa'),
      orbit: 'oklch(87% 0.06 272 / 0.08)',
    };

    const bodies: Body[] = nodes.map((node, i) => {
      const style = planetStyle(node.name);
      const services = userFacingServices(
        servicesRef.current.filter((s) => s.nodeId === node.id),
      );

      return {
        nodeId: node.id,
        name: node.name,
        // Spread orbits evenly, innermost first.
        orbit: nodes.length === 1 ? 0 : 0.35 + (i / Math.max(nodes.length - 1, 1)) * 0.5,
        angle: (i / Math.max(nodes.length, 1)) * TAU,
        // Inner orbits move faster, as they should.
        speed: 0.00006 / (0.4 + i * 0.25),
        radius: 0,
        hue: style.hue,
        accentHue: style.accentHue,
        saturation: style.saturation,
        load: 0,
        online: false,
        satellites: services.slice(0, 8).map((s, j) => ({
          angle: (j / Math.max(services.length, 1)) * TAU,
          speed: 0.0009 + j * 0.00012,
          ok: s.status === 'running',
        })),
        x: 0,
        y: 0,
      };
    });

    // Live load, straight off each node's stream. No React in this path.
    const unsubscribes = bodies.map((body) => {
      const conn = getConnection(body.nodeId);
      if (!conn) return () => {};
      return conn.onHost((host) => {
        body.load = Math.min(host.cpu_pct / 100, 1);
        body.online = true;
        const gb = host.mem_total_bytes / 1024 ** 3;
        // Size by capacity, compressed so a 256GB box doesn't dwarf a Pi.
        body.radius = 14 + Math.min(Math.sqrt(gb) * 2.6, 26);
      });
    });

    const unsubscribeMeta = useNodeStore.subscribe((state) => {
      for (const body of bodies) {
        body.online = state.meta[body.nodeId]?.status === 'online';
      }
    });

    let width = 0;
    let height = 0;

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      const rect = container.getBoundingClientRect();
      width = rect.width;
      height = rect.height;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const observer = new ResizeObserver(resize);
    observer.observe(container);
    resize();

    let last = performance.now();
    let frame = 0;

    const draw = (now: number) => {
      const dt = Math.min(now - last, 100); // clamp after a background pause
      last = now;

      const cx = width / 2;
      const cy = height / 2;
      const span = Math.min(width, height) / 2 - 40;

      ctx.clearRect(0, 0, width, height);

      // Orbit guides.
      ctx.strokeStyle = colors.orbit;
      ctx.lineWidth = 1;
      for (const body of bodies) {
        if (body.orbit === 0) continue;
        ctx.beginPath();
        ctx.ellipse(cx, cy, span * body.orbit, span * body.orbit * 0.42, 0, 0, TAU);
        ctx.stroke();
      }

      for (const body of bodies) {
        if (!reduceMotion) body.angle += body.speed * dt;

        const x = cx + Math.cos(body.angle) * span * body.orbit;
        const y = cy + Math.sin(body.angle) * span * body.orbit * 0.42;
        body.x = x;
        body.y = y;

        const r = body.radius || 20;
        const sat = body.online ? body.saturation : 6;
        const light = body.online ? 52 : 28;

        // Load halo. Idle nodes get a faint ring; busy ones glow.
        const haloAlpha = body.online ? 0.1 + body.load * 0.45 : 0.05;
        const halo = ctx.createRadialGradient(x, y, r, x, y, r * 2.4);
        halo.addColorStop(0, `hsl(${body.accentHue} ${sat}% 60% / ${haloAlpha})`);
        halo.addColorStop(1, 'transparent');
        ctx.fillStyle = halo;
        ctx.beginPath();
        ctx.arc(x, y, r * 2.4, 0, TAU);
        ctx.fill();

        // Satellites: one per service, colour by health.
        for (const sat2 of body.satellites) {
          if (!reduceMotion) sat2.angle += sat2.speed * dt;
          const sr = r * 1.9;
          const sx = x + Math.cos(sat2.angle) * sr;
          const sy = y + Math.sin(sat2.angle) * sr * 0.6;
          ctx.fillStyle = sat2.ok ? colors.success : colors.muted;
          ctx.globalAlpha = body.online ? 0.9 : 0.3;
          ctx.beginPath();
          ctx.arc(sx, sy, 2, 0, TAU);
          ctx.fill();
          ctx.globalAlpha = 1;
        }

        // The planet itself, lit from the upper left.
        const body3d = ctx.createRadialGradient(
          x - r * 0.35,
          y - r * 0.4,
          r * 0.1,
          x,
          y,
          r,
        );
        body3d.addColorStop(0, `hsl(${body.hue} ${sat}% ${light + 14}%)`);
        body3d.addColorStop(0.6, `hsl(${body.hue} ${sat}% ${light}%)`);
        body3d.addColorStop(1, `hsl(${body.hue} ${sat}% ${Math.max(light - 34, 8)}%)`);
        ctx.fillStyle = body3d;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, TAU);
        ctx.fill();

        ctx.strokeStyle = `hsl(${body.accentHue} ${sat}% 70% / 0.35)`;
        ctx.lineWidth = 1;
        ctx.stroke();

        // Label.
        ctx.fillStyle = body.online ? colors.foreground : colors.muted;
        ctx.globalAlpha = body.online ? 0.85 : 0.6;
        ctx.font =
          '500 11px ui-sans-serif, system-ui, -apple-system, "Inter Variable", sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(body.name, x, y + r + 16);
        ctx.globalAlpha = 1;
      }

      frame = requestAnimationFrame(draw);
    };

    frame = requestAnimationFrame(draw);

    // Click a planet to open its detail page.
    const onClick = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      for (const body of bodies) {
        const r = body.radius || 20;
        if ((mx - body.x) ** 2 + (my - body.y) ** 2 <= (r + 6) ** 2) {
          void navigate({ to: '/nodes/$nodeId', params: { nodeId: body.nodeId } });
          return;
        }
      }
    };

    const onMove = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const over = bodies.some((body) => {
        const r = body.radius || 20;
        return (mx - body.x) ** 2 + (my - body.y) ** 2 <= (r + 6) ** 2;
      });
      canvas.style.cursor = over ? 'pointer' : 'default';
    };

    canvas.addEventListener('click', onClick);
    canvas.addEventListener('mousemove', onMove);

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      canvas.removeEventListener('click', onClick);
      canvas.removeEventListener('mousemove', onMove);
      unsubscribeMeta();
      for (const un of unsubscribes) un();
    };
  }, [nodes, navigate]);

  return (
    <div className={className}>
      <canvas ref={canvasRef} className='block size-full' />
    </div>
  );
}
