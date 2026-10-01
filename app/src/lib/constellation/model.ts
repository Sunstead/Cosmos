/**
 * The constellation's data model: what is in the sky, where it sits, and how
 * focus moves through it. Pure and free of three.js, so it is tested on its
 * own; `scene.ts` turns a `Layout` into meshes.
 *
 * Every body has a key that says what it is: `node:<id>`,
 * `moon:<nodeId>:<service>` or `probe:<tailnet id>`.
 */

export type NodeState = 'online' | 'connecting' | 'offline' | 'unauthorized';
/** `down`: running, but its uptime check fails. */
export type MoonState = 'ok' | 'partial' | 'stopped' | 'down';
export type ProbeShape = 'phone' | 'computer' | 'server' | 'other';
export type BodyKind = 'node' | 'moon' | 'probe';

export interface NodeInput {
  id: string;
  name: string;
  state: NodeState;
  /** Total memory, which sizes the body; null until the first sample. */
  memBytes: number | null;
}

export interface MoonInput {
  nodeId: string;
  /** The `cosmos.service` key. */
  service: string;
  name: string;
  state: MoonState;
  url: string | null;
}

export interface ProbeInput {
  id: string;
  name: string;
  os: string;
  online: boolean;
  /** Set when a Wake-on-LAN target points at this device. */
  wol: 'waking' | 'asleep' | null;
}

/** Everything the scene shows, as plain data. */
export interface Snapshot {
  nodes: NodeInput[];
  moons: MoonInput[];
  probes: ProbeInput[];
}

export const EMPTY_SNAPSHOT: Snapshot = { nodes: [], moons: [], probes: [] };

export interface NodeBody extends NodeInput {
  key: string;
  kind: 'node';
  index: number;
  /** Orbit radius around the centre, world units. 0 for a lone node. */
  orbit: number;
  /** Starting angle, radians. Kept across reconciles; the scene moves it on from there. */
  phase: number;
  /** Radians per second. */
  speed: number;
  /** Body radius, world units. */
  radius: number;
  moonKeys: string[];
}

export interface MoonBody extends MoonInput {
  key: string;
  kind: 'moon';
  nodeKey: string;
  shell: number;
  /** Position in its shell, as a fraction of a turn. */
  slot: number;
}

export interface ProbeBody extends ProbeInput {
  key: string;
  kind: 'probe';
  shape: ProbeShape;
  /** Position on the ring, as a fraction of a turn. */
  slot: number;
}

export type Body = NodeBody | MoonBody | ProbeBody;

export interface Layout {
  nodes: NodeBody[];
  moons: MoonBody[];
  probes: ProbeBody[];
  byKey: Map<string, Body>;
  /** Radius of the device ring, world units. */
  probeRadius: number;
  /** Radius that holds everything, for framing the camera. */
  extent: number;
}

export interface Diff {
  added: string[];
  removed: string[];
  /** Same body, something about it changed. */
  changed: string[];
}

/** Golden angle: late arrivals land in the widest gap. */
const GOLDEN = 2.399963;
/** Outermost node orbit, world units. */
export const SPAN = 22;
/** Moons a shell holds before the next one starts. */
const SHELL_BASE = 8;
const SHELL_STEP = 4;

export const nodeKey = (id: string) => `node:${id}`;
export const moonKey = (nodeId: string, service: string) => `moon:${nodeId}:${service}`;
export const probeKey = (id: string) => `probe:${id}`;

export function kindOf(key: string): BodyKind {
  return key.slice(0, key.indexOf(':')) as BodyKind;
}

/** Radius in CSS px from total memory, compressed so big hosts don't dwarf small ones. */
export function bodyRadius(memBytes: number): number {
  const gb = memBytes / 1024 ** 3;
  return Math.round(14 + Math.min(Math.sqrt(gb) * 2.4, 22));
}

/** Body radius in world units: 0.9 to 2.25. */
export function worldRadius(memBytes: number | null): number {
  return bodyRadius(memBytes ?? 8 * 1024 ** 3) / 16;
}

/** Orbit radius as a fraction of the span, innermost first. */
export function orbitFraction(index: number, count: number): number {
  if (count === 1) return 0;
  return 0.38 + (index / Math.max(count - 1, 1)) * 0.52;
}

/** Which shell and slot each of `count` moons takes. Inner shells fill first. */
export function moonSlots(count: number): { shell: number; slot: number }[] {
  const out: { shell: number; slot: number }[] = [];
  let shell = 0;
  let start = 0;
  while (start < count) {
    const capacity = SHELL_BASE + shell * SHELL_STEP;
    const inShell = Math.min(capacity, count - start);
    for (let i = 0; i < inShell; i += 1) {
      // Offset alternate shells by half a slot so moons don't line up radially.
      out.push({ shell, slot: (i + (shell % 2) * 0.5) / inShell });
    }
    start += inShell;
    shell += 1;
  }
  return out;
}

/** How many shells `count` moons need. */
export function shellCount(count: number): number {
  return count === 0 ? 0 : moonSlots(count)[count - 1].shell + 1;
}

/** A device's silhouette from its OS. */
export function probeShape(os: string): ProbeShape {
  const o = os.toLowerCase();
  if (o === 'ios' || o === 'android' || o === 'ipados') return 'phone';
  if (o === 'macos' || o === 'windows') return 'computer';
  if (o === 'linux' || o === 'freebsd' || o === 'openbsd') return 'server';
  return 'other';
}

/** A service's moon state, from its containers and its uptime check. */
export function moonState(status: 'running' | 'partial' | 'stopped', checkDown: boolean): MoonState {
  if (status === 'stopped') return 'stopped';
  if (checkDown) return 'down';
  return status === 'partial' ? 'partial' : 'ok';
}

/**
 * Builds the layout for a snapshot, keeping what can be kept from the
 * previous one (a node's phase, so nothing jumps when another node comes or
 * goes), and says what changed.
 */
export function reconcile(prev: Layout | null, snap: Snapshot): { layout: Layout; diff: Diff } {
  const byKey = new Map<string, Body>();
  const count = snap.nodes.length;

  const moonsByNode = new Map<string, MoonInput[]>();
  for (const m of snap.moons) {
    const list = moonsByNode.get(m.nodeId) ?? [];
    list.push(m);
    moonsByNode.set(m.nodeId, list);
  }
  for (const list of moonsByNode.values()) list.sort((a, b) => a.name.localeCompare(b.name));

  const nodes: NodeBody[] = snap.nodes.map((n, index) => {
    const key = nodeKey(n.id);
    const old = prev?.byKey.get(key) as NodeBody | undefined;
    const mine = moonsByNode.get(n.id) ?? [];
    const body: NodeBody = {
      ...n,
      key,
      kind: 'node',
      index,
      orbit: orbitFraction(index, count) * SPAN,
      phase: old?.phase ?? index * GOLDEN + 0.6,
      // Outer orbits are slower, as in a real system.
      speed: 0.045 / (0.5 + index * 0.3),
      radius: worldRadius(n.memBytes),
      moonKeys: mine.map((m) => moonKey(n.id, m.service)),
    };
    byKey.set(key, body);
    return body;
  });

  const moons: MoonBody[] = [];
  for (const node of nodes) {
    const mine = moonsByNode.get(node.id) ?? [];
    const slots = moonSlots(mine.length);
    mine.forEach((m, i) => {
      const body: MoonBody = { ...m, key: moonKey(m.nodeId, m.service), kind: 'moon', nodeKey: node.key, ...slots[i] };
      byKey.set(body.key, body);
      moons.push(body);
    });
  }

  const sortedProbes = snap.probes.slice().sort((a, b) => a.name.localeCompare(b.name));
  const probes: ProbeBody[] = sortedProbes.map((p, i) => {
    const body: ProbeBody = {
      ...p,
      key: probeKey(p.id),
      kind: 'probe',
      shape: probeShape(p.os),
      slot: i / Math.max(sortedProbes.length, 1),
    };
    byKey.set(body.key, body);
    return body;
  });

  const biggest = nodes.reduce((r, n) => Math.max(r, n.radius), 1);
  const outerMoons = (n: NodeBody) => n.radius * 2 + shellCount(n.moonKeys.length) * 0.8;
  const reach = nodes.reduce((r, n) => Math.max(r, n.orbit + outerMoons(n)), biggest * 3);
  const probeRadius = count > 1 ? reach + 4 : Math.max(reach + 4, 9);
  const extent = probes.length ? probeRadius + 1 : reach + 1;

  const layout: Layout = { nodes, moons, probes, byKey, probeRadius, extent };
  return { layout, diff: diffLayouts(prev, layout) };
}

/** Fields whose change means a body has to be redrawn. */
function signature(b: Body): string {
  switch (b.kind) {
    case 'node':
      return `${b.name}|${b.state}|${b.radius}|${b.orbit}|${b.moonKeys.length}`;
    case 'moon':
      return `${b.name}|${b.state}|${b.url ?? ''}|${b.shell}|${b.slot}`;
    case 'probe':
      return `${b.name}|${b.online}|${b.wol ?? ''}|${b.shape}|${b.slot}`;
  }
}

export function diffLayouts(prev: Layout | null, next: Layout): Diff {
  const diff: Diff = { added: [], removed: [], changed: [] };
  for (const [key, body] of next.byKey) {
    const old = prev?.byKey.get(key);
    if (!old) diff.added.push(key);
    else if (signature(old) !== signature(body)) diff.changed.push(key);
  }
  if (prev) for (const key of prev.byKey.keys()) if (!next.byKey.has(key)) diff.removed.push(key);
  return diff;
}

/** True when nothing in the diff needs work. */
export function isEmptyDiff(d: Diff): boolean {
  return !d.added.length && !d.removed.length && !d.changed.length;
}

/**
 * The order arrow keys walk: each node, followed by its moons when it is the
 * selected one, then the devices.
 */
export function focusOrder(layout: Layout, selected: string | null): string[] {
  const out: string[] = [];
  for (const n of layout.nodes) {
    out.push(n.key);
    if (n.key === selected) out.push(...n.moonKeys);
  }
  for (const p of layout.probes) out.push(p.key);
  return out;
}

/** The next key in `order` from `current`, wrapping. Starts at an end when there is none. */
export function stepFocus(order: string[], current: string | null, delta: 1 | -1): string | null {
  if (order.length === 0) return null;
  const i = current ? order.indexOf(current) : -1;
  if (i < 0) return delta > 0 ? order[0] : order[order.length - 1];
  return order[(i + delta + order.length) % order.length];
}

export interface FocusState {
  /** The node or device the camera is on, if any. */
  selected: string | null;
}

export type Intent =
  /** Click or Enter on a body. */
  | { type: 'activate'; key: string }
  /** Escape. */
  | { type: 'back' }
  /** A click on empty space. */
  | { type: 'empty' };

export type Effect = { type: 'none' } | { type: 'fly'; to: string | null } | { type: 'open'; key: string };

/**
 * Focus, then open: the first activation of a node or a device flies to it,
 * the second opens it. Moons open at once (a moon is only big enough to aim
 * at once its node is in focus anyway). Back and empty space fly home.
 */
export function interact(state: FocusState, layout: Layout, intent: Intent): { state: FocusState; effect: Effect } {
  const none = { state, effect: { type: 'none' } as Effect };
  switch (intent.type) {
    case 'back':
    case 'empty':
      return state.selected ? { state: { selected: null }, effect: { type: 'fly', to: null } } : none;
    case 'activate': {
      const body = layout.byKey.get(intent.key);
      if (!body) return none;
      if (body.kind !== 'moon' && state.selected !== body.key) {
        return { state: { selected: body.key }, effect: { type: 'fly', to: body.key } };
      }
      return { state, effect: { type: 'open', key: body.key } };
    }
  }
}

/** A body as drawn on screen, for picking. */
export interface ScreenBody {
  key: string;
  x: number;
  y: number;
  /** Projected radius, px. */
  r: number;
  /** Distance from the camera; smaller is nearer. */
  depth: number;
}

/**
 * The body under a pointer. Small bodies get `slop` px of tolerance so a
 * moon a few pixels wide can still be tapped; when several are under the
 * pointer, the nearest to the camera wins.
 */
export function pick(bodies: ScreenBody[], x: number, y: number, slop = 8): string | null {
  let best: ScreenBody | null = null;
  for (const b of bodies) {
    const reach = Math.max(b.r, slop);
    if ((b.x - x) ** 2 + (b.y - y) ** 2 > reach * reach) continue;
    if (!best || b.depth < best.depth) best = b;
  }
  return best?.key ?? null;
}

/** A label for a body that a screen reader can use. */
export function describe(body: Body): string {
  switch (body.kind) {
    case 'node':
      return `${body.name}, ${NODE_STATE_LABEL[body.state]}`;
    case 'moon':
      return `${body.name}, ${MOON_STATE_LABEL[body.state]}`;
    case 'probe':
      return `${body.name}, ${probeStateLabel(body)}`;
  }
}

export const NODE_STATE_LABEL: Record<NodeState, string> = {
  online: 'online',
  connecting: 'connecting',
  offline: 'offline',
  unauthorized: 'sign in needed',
};

export const MOON_STATE_LABEL: Record<MoonState, string> = {
  ok: 'running',
  partial: 'degraded',
  stopped: 'stopped',
  down: 'down',
};

export function probeStateLabel(p: Pick<ProbeInput, 'online' | 'wol'>): string {
  if (p.wol === 'waking') return 'waking';
  if (p.online) return 'online';
  return p.wol ? 'asleep' : 'offline';
}
