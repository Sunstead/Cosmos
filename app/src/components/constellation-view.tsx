import { memo, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Crosshair, Maximize2, Minus, Plus } from 'lucide-react';
import type { HostInfo } from '@/generated/HostInfo';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { cancelDraw, requestDraw } from '@/lib/frame-scheduler';
import { displayHost } from '@/lib/agent-url';
import { formatBytes, getMemUsagePct, getNetRxMbps, getNetTxMbps } from '@/lib/node-metrics';
import { ConstellationScene, FocusInfo, Variant } from '@/lib/constellation/scene';
import type { ConstellationSource } from '@/lib/constellation/source';
import {
  Body,
  Layout,
  MOON_STATE_LABEL,
  NODE_STATE_LABEL,
  nodeKey,
  probeStateLabel,
  reconcile,
} from '@/lib/constellation/model';
import { toneOf } from '@/lib/constellation/hud';
import type { ThemeStyle } from '@/lib/themes';
import { useThemeStyle } from '@/hooks/use-theme-style';

/** Ghost buttons in hologram colours, since the viewport is dark in every theme. */
const HOLO_BUTTON =
  'text-[var(--holo-text)] hover:bg-[color-mix(in_oklab,var(--holo-primary)_16%,transparent)] hover:text-[var(--holo-text)] ' +
  'dark:hover:bg-[color-mix(in_oklab,var(--holo-primary)_16%,transparent)] focus-visible:border-[var(--holo-primary)] ' +
  'focus-visible:ring-[color-mix(in_oklab,var(--holo-primary)_40%,transparent)]';

const TONE_TEXT = {
  ok: 'text-[var(--holo-ok)]',
  warn: 'text-[var(--holo-warn)]',
  err: 'text-[var(--holo-err)]',
  dim: 'text-[var(--holo-dim)]',
} as const;

const TONE_BG = {
  ok: 'bg-[var(--holo-ok)]',
  warn: 'bg-[var(--holo-warn)]',
  err: 'bg-[var(--holo-err)]',
  dim: 'bg-[var(--holo-dim)]',
} as const;

const NO_FOCUS: FocusInfo = { selected: null, hovered: null, focused: null };

/**
 * HUD and legend panels: a context menu in rounded themes (`.sky-panel`
 * points the hologram variables at the app's tokens), a bracketed hologram
 * panel in tech ones.
 */
const PANEL: Record<ThemeStyle, string> = {
  rounded: 'sky-panel glass rounded-lg bg-popover shadow-md ring-1 ring-foreground/10',
  tech: 'holo-panel rounded-sm',
};

interface Props {
  source: ConstellationSource;
  variant: Variant;
  className?: string;
  /** A node id to start focused on. */
  initialNode?: string | null;
  onOpen: (body: Body) => void;
  /** Shows an expand button; gets the focused node's id. */
  onExpand?: (nodeId: string | null) => void;
  /** WebGL went away or never came. */
  onUnsupported: () => void;
}

/**
 * The 3D constellation. The scene lives in a ref and is fed straight from
 * the source; React renders only the overlay (HUD panel, controls), and
 * only when focus or the set of bodies changes.
 */
export function ConstellationView({
  source,
  variant,
  className,
  initialNode,
  onOpen,
  onExpand,
  onUnsupported,
}: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const labelsRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<ConstellationScene | null>(null);
  const [focus, setFocus] = useState<FocusInfo>(NO_FOCUS);
  const snapshot = useSyncExternalStore(
    (fn) => source.subscribe(fn),
    () => source.snapshot(),
  );
  const layout = useMemo(() => reconcile(null, snapshot).layout, [snapshot]);
  const style = useThemeStyle();
  const styleRef = useRef(style);

  // Callbacks change identity with their owner; the scene is built once.
  const handlers = useRef({ onOpen, onUnsupported });
  useEffect(() => {
    handlers.current = { onOpen, onUnsupported };
  }, [onOpen, onUnsupported]);
  const initialRef = useRef(initialNode);

  useEffect(() => {
    const wrap = wrapRef.current;
    const labels = labelsRef.current;
    if (!wrap || !labels) return;
    let scene: ConstellationScene;
    try {
      scene = new ConstellationScene(wrap, labels, source, {
        variant,
        style: styleRef.current,
        reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
        onFocusChange: setFocus,
        onOpen: (body) => handlers.current.onOpen(body),
      });
    } catch {
      handlers.current.onUnsupported();
      return;
    }
    sceneRef.current = scene;
    scene.setSnapshot(source.snapshot());
    if (initialRef.current) scene.select(nodeKey(initialRef.current), true);
    const unsubscribe = source.subscribe(() => scene.setSnapshot(source.snapshot()));
    if (import.meta.env.DEV) (window as unknown as { __constellation?: ConstellationScene }).__constellation = scene;
    return () => {
      unsubscribe();
      scene.dispose();
      sceneRef.current = null;
      setFocus(NO_FOCUS);
    };
  }, [source, variant]);

  useEffect(() => {
    styleRef.current = style;
    sceneRef.current?.setStyle(style);
  }, [style]);

  const counts = useMemo(
    () => ({ nodes: layout.nodes.length, moons: layout.moons.length, probes: layout.probes.length }),
    [layout],
  );

  return (
    <div
      ref={wrapRef}
      data-constellation
      data-variant={variant}
      data-sky-style={style}
      className={cn('@container relative isolate overflow-hidden bg-[var(--holo-space)] text-[var(--holo-text)]', className)}
    >
      {/* The scene puts its canvas first, under everything here. */}
      {style === 'tech' && <div aria-hidden className='holo-scanlines pointer-events-none absolute inset-0' />}
      <div aria-hidden className='holo-vignette pointer-events-none absolute inset-0' />
      {/* isolate: labels order themselves with z-index; this keeps that inside
          the layer, under the HUD, legend and controls. */}
      <div
        ref={labelsRef}
        role='group'
        aria-label='Node map'
        aria-roledescription='3D map'
        className='pointer-events-none absolute inset-0 isolate overflow-hidden'
      />

      <HudPanel
        layout={layout}
        focus={focus}
        source={source}
        variant={variant}
        panel={PANEL[style]}
        onActivate={(key) => sceneRef.current?.activate(key)}
      />

      {/* The HUD panel takes the legend's corner whenever it shows a body. */}
      {variant === 'full' && !(focus.selected || focus.hovered || focus.focused) && (
        <div
          data-legend
          className={cn(PANEL[style], 'pointer-events-none absolute top-3 left-3 z-10 hidden px-3 py-2 text-2xs @lg:block')}
        >
          <Legend counts={counts} />
        </div>
      )}

      <div className='absolute right-2 bottom-2 z-10 flex flex-col gap-1'>
        <Button variant='ghost' size='icon' className={HOLO_BUTTON} aria-label='Zoom in' title='Zoom in' onClick={() => sceneRef.current?.zoom(1)}>
          <Plus />
        </Button>
        <Button variant='ghost' size='icon' className={HOLO_BUTTON} aria-label='Zoom out' title='Zoom out' onClick={() => sceneRef.current?.zoom(-1)}>
          <Minus />
        </Button>
        <Button variant='ghost' size='icon' className={HOLO_BUTTON} aria-label='Reset view' title='Reset view' onClick={() => sceneRef.current?.resetView()}>
          <Crosshair />
        </Button>
        {onExpand && (
          <Button
            variant='ghost'
            size='icon'
            className={HOLO_BUTTON}
            aria-label='Open full view'
            title='Open full view'
            onClick={() => {
              const selected = focus.selected ? layout.byKey.get(focus.selected) : undefined;
              onExpand(selected?.kind === 'node' ? selected.id : null);
            }}
          >
            <Maximize2 />
          </Button>
        )}
      </div>

      {variant === 'full' && (
        <p className='pointer-events-none absolute bottom-3 left-1/2 z-10 hidden -translate-x-1/2 text-2xs text-[var(--holo-dim)] @3xl:block'>
          Drag to orbit, scroll to zoom, click a planet or device to focus it. Tab and arrow keys move between bodies.
        </p>
      )}
    </div>
  );
}

function Legend({ counts }: { counts: { nodes: number; moons: number; probes: number } }) {
  const row = (shape: string, label: string, n: number) => (
    <div className='flex items-center gap-2'>
      <span aria-hidden className={cn('inline-block size-2.5 shrink-0 border border-[var(--holo-primary)]', shape)} />
      <span className='label-hud tracking-[0.12em]'>{label}</span>
      <span className='ml-auto pl-4 tabular-nums text-[var(--holo-dim)]'>{n}</span>
    </div>
  );
  return (
    <div className='grid min-w-36 gap-1'>
      {row('rounded-full', 'Nodes', counts.nodes)}
      {row('size-1.5 rounded-full border-[var(--holo-secondary)]', 'Services', counts.moons)}
      {row('rotate-45 border-[var(--holo-secondary)]', 'Devices', counts.probes)}
    </div>
  );
}

function StatusChip({ tone, children }: { tone: keyof typeof TONE_TEXT; children: string }) {
  return (
    <span className={cn('flex shrink-0 items-center gap-1.5 text-2xs', TONE_TEXT[tone])}>
      <span aria-hidden className={cn('size-1.5 rounded-full', TONE_BG[tone])} />
      {children}
    </span>
  );
}

/** What the HUD shows for a focused body. */
function HudPanel({
  layout,
  focus,
  source,
  variant,
  panel,
  onActivate,
}: {
  layout: Layout;
  focus: FocusInfo;
  source: ConstellationSource;
  variant: Variant;
  /** The panel's look, from the theme's style. */
  panel: string;
  onActivate: (key: string) => void;
}) {
  // While focus is inside the panel (on its button), keep showing what it was showing.
  const [held, setHeld] = useState<string | null>(null);
  const key = held ?? focus.focused ?? focus.hovered ?? focus.selected;
  const body = key ? layout.byKey.get(key) : undefined;
  if (!body) return null;
  // Actions only where they can be reached: the selected node, or a label in keyboard focus.
  const actionable = key === focus.selected || key === focus.focused || key === held;
  const tone = toneOf(body);

  let title = body.name;
  let status = '';
  let detail: React.ReactNode = null;
  let action: { label: string } | null = null;
  switch (body.kind) {
    case 'node': {
      status = NODE_STATE_LABEL[body.state];
      const moons = body.moonKeys.map((k) => layout.byKey.get(k)).filter((m) => m?.kind === 'moon');
      const running = moons.filter((m) => m.state !== 'stopped').length;
      detail = (
        <>
          {body.state === 'online' && <NodeStats source={source} nodeId={body.id} />}
          {moons.length > 0 && (
            <p className='text-2xs text-[var(--holo-dim)]'>
              {running} of {moons.length} services running
            </p>
          )}
        </>
      );
      action = { label: key === focus.selected ? 'Open node' : 'Focus' };
      break;
    }
    case 'moon': {
      status = MOON_STATE_LABEL[body.state];
      const node = layout.byKey.get(body.nodeKey);
      detail = (
        <p className='truncate text-2xs text-[var(--holo-dim)]'>
          {[node?.name, body.url ? displayHost(body.url) : null].filter(Boolean).join(', ')}
        </p>
      );
      action = { label: body.url ? 'Open service' : 'Show services' };
      break;
    }
    case 'probe':
      title = body.name;
      status = probeStateLabel(body);
      detail = <p className='text-2xs text-[var(--holo-dim)]'>{body.os || 'Device'} on the tailnet</p>;
      action = { label: key === focus.selected ? 'Show network' : 'Focus' };
      break;
  }

  return (
    <div
      data-hud
      data-hud-key={body.key}
      onFocus={() => setHeld(body.key)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setHeld(null);
      }}
      className={cn(
        panel,
        'absolute z-10 grid gap-2 p-3',
        variant === 'full' ? 'top-3 left-3 w-64' : 'bottom-2 left-2 w-56',
        // Room for the controls on a narrow card.
        'max-w-[calc(100%-4rem)]',
      )}
    >
      <div className='flex min-w-0 items-center justify-between gap-3'>
        <h3 className='label-hud truncate text-xs tracking-[0.16em]'>{title}</h3>
        <StatusChip tone={tone}>{status}</StatusChip>
      </div>
      {detail}
      {actionable && action && (
        <Button
          size='sm'
          variant='ghost'
          className={cn('justify-self-start border border-[color-mix(in_oklab,var(--holo-primary)_35%,transparent)]', HOLO_BUTTON)}
          onClick={() => onActivate(body.key)}
        >
          {action.label}
        </Button>
      )}
      {!actionable && body.kind !== 'moon' && (
        <p className='text-2xs text-[var(--holo-dim)]'>Click to focus</p>
      )}
    </div>
  );
}

const pct = (n: number) => `${Math.round(n)}%`;

function diskFraction(host: HostInfo): number {
  const total = host.disk.reduce((s, d) => s + d.total_bytes, 0);
  return total > 0 ? host.disk.reduce((s, d) => s + d.used_bytes, 0) / total : 0;
}

/** Live CPU, memory, disk and network, written through refs: no re-render per sample. */
const NodeStats = memo(function NodeStats({ source, nodeId }: { source: ConstellationSource; nodeId: string }) {
  return (
    <div className='grid gap-1.5'>
      <LiveStat source={source} nodeId={nodeId} label='CPU' read={(h) => [pct(h.cpu_pct), h.cpu_pct / 100]} />
      <LiveStat
        source={source}
        nodeId={nodeId}
        label='Memory'
        read={(h) => [`${getMemUsagePct(h)}% of ${formatBytes(h.mem_total_bytes)}`, getMemUsagePct(h) / 100]}
      />
      <LiveStat source={source} nodeId={nodeId} label='Disk' read={(h) => [pct(diskFraction(h) * 100), diskFraction(h)]} />
      <LiveStat
        source={source}
        nodeId={nodeId}
        label='Network'
        read={(h) => [`${getNetRxMbps(h)} in, ${getNetTxMbps(h)} out Mb/s`, null]}
      />
    </div>
  );
});

function LiveStat({
  source,
  nodeId,
  label,
  read,
}: {
  source: ConstellationSource;
  nodeId: string;
  label: string;
  /** Text and an optional 0..1 bar. Pure and cheap. */
  read: (host: HostInfo) => [string, number | null];
}) {
  const textRef = useRef<HTMLSpanElement>(null);
  const barRef = useRef<HTMLSpanElement>(null);
  const readRef = useRef(read);
  useEffect(() => {
    readRef.current = read;
  });

  useEffect(() => {
    let next: [string, number | null] | null = null;
    const paint = () => {
      if (!next) return;
      if (textRef.current) textRef.current.textContent = next[0];
      if (barRef.current && next[1] !== null) barRef.current.style.transform = `scaleX(${Math.min(Math.max(next[1], 0), 1)})`;
    };
    const unsubscribe = source.onHost(nodeId, (host) => {
      next = readRef.current(host);
      requestDraw(paint);
    });
    return () => {
      unsubscribe();
      cancelDraw(paint);
    };
  }, [source, nodeId]);

  return (
    <div className='grid gap-0.5'>
      <div className='flex items-baseline justify-between gap-2 text-2xs'>
        <span className='label-hud tracking-[0.12em] text-[var(--holo-dim)]'>{label}</span>
        <span ref={textRef} className='truncate tabular-nums'>
          n/a
        </span>
      </div>
      {label !== 'Network' && (
        <span className='block h-0.5 overflow-hidden bg-[color-mix(in_oklab,var(--holo-primary)_14%,transparent)]'>
          <span
            ref={barRef}
            style={{ transform: 'scaleX(0)' }}
            className='block h-full origin-left bg-[var(--holo-primary)] shadow-[0_0_6px_var(--holo-primary)] transition-transform duration-500 motion-reduce:transition-none'
          />
        </span>
      )}
    </div>
  );
}
