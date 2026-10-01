import { describe, expect, it } from 'vitest';
import {
  bodyRadius,
  describe as describeBody,
  focusOrder,
  interact,
  isEmptyDiff,
  kindOf,
  moonKey,
  moonSlots,
  moonState,
  MoonInput,
  NodeBody,
  nodeKey,
  NodeInput,
  orbitFraction,
  pick,
  probeKey,
  probeShape,
  ProbeInput,
  reconcile,
  shellCount,
  Snapshot,
  stepFocus,
  worldRadius,
} from './model';

const node = (id: string, extra: Partial<NodeInput> = {}): NodeInput => ({
  id,
  name: id,
  state: 'online',
  memBytes: 16 * 1024 ** 3,
  ...extra,
});
const moon = (nodeId: string, service: string, extra: Partial<MoonInput> = {}): MoonInput => ({
  nodeId,
  service,
  name: service,
  state: 'ok',
  url: null,
  ...extra,
});
const probe = (id: string, extra: Partial<ProbeInput> = {}): ProbeInput => ({
  id,
  name: id,
  os: 'linux',
  online: true,
  wol: null,
  ...extra,
});
const snap = (partial: Partial<Snapshot>): Snapshot => ({ nodes: [], moons: [], probes: [], ...partial });

describe('geometry', () => {
  it('grows radius with memory, within bounds', () => {
    expect(bodyRadius(0)).toBe(14);
    expect(bodyRadius(16 * 1024 ** 3)).toBeGreaterThan(bodyRadius(4 * 1024 ** 3));
    expect(bodyRadius(4096 * 1024 ** 3)).toBe(36);
    expect(worldRadius(null)).toBeGreaterThan(worldRadius(0));
  });

  it('centres a single node and spreads the rest outward', () => {
    expect(orbitFraction(0, 1)).toBe(0);
    expect(orbitFraction(0, 3)).toBeCloseTo(0.38);
    expect(orbitFraction(2, 3)).toBeCloseTo(0.9);
  });

  it('fills inner moon shells first, larger shells holding more', () => {
    expect(moonSlots(0)).toEqual([]);
    const slots = moonSlots(30);
    expect(slots.filter((s) => s.shell === 0)).toHaveLength(8);
    expect(slots.filter((s) => s.shell === 1)).toHaveLength(12);
    expect(slots.filter((s) => s.shell === 2)).toHaveLength(10);
    expect(shellCount(30)).toBe(3);
    expect(shellCount(8)).toBe(1);
    // Evenly spread within a shell, no two moons in one place.
    for (const shell of [0, 1, 2]) {
      const at = slots.filter((s) => s.shell === shell).map((s) => s.slot);
      expect(new Set(at).size).toBe(at.length);
      expect(Math.max(...at)).toBeLessThan(1.01);
    }
  });
});

describe('reconcile', () => {
  it('reports additions, then nothing when the data is the same', () => {
    const s = snap({ nodes: [node('a'), node('b')], moons: [moon('a', 'web')], probes: [probe('p')] });
    const first = reconcile(null, s);
    expect(first.diff.added.sort()).toEqual([moonKey('a', 'web'), nodeKey('a'), nodeKey('b'), probeKey('p')].sort());
    const again = reconcile(first.layout, structuredClone(s));
    expect(isEmptyDiff(again.diff)).toBe(true);
  });

  it('keeps a node where it was when another one joins or leaves', () => {
    const one = reconcile(null, snap({ nodes: [node('a'), node('b')] })).layout;
    const two = reconcile(one, snap({ nodes: [node('c'), node('a'), node('b')] }));
    const phase = (l: typeof one, id: string) => (l.byKey.get(nodeKey(id)) as NodeBody).phase;
    expect(phase(two.layout, 'a')).toBe(phase(one, 'a'));
    expect(phase(two.layout, 'b')).toBe(phase(one, 'b'));
    expect(two.diff.added).toEqual([nodeKey('c')]);
    // Orbits moved, so a and b changed.
    expect(two.diff.changed).toContain(nodeKey('a'));

    const three = reconcile(two.layout, snap({ nodes: [node('a')] }));
    expect(three.diff.removed.sort()).toEqual([nodeKey('b'), nodeKey('c')]);
    expect((three.layout.byKey.get(nodeKey('a')) as NodeBody).orbit).toBe(0);
  });

  it('flags a status change as a change, not a new body', () => {
    const before = reconcile(null, snap({ nodes: [node('a')], moons: [moon('a', 'web')] })).layout;
    const after = reconcile(before, snap({ nodes: [node('a')], moons: [moon('a', 'web', { state: 'down' })] }));
    expect(after.diff).toEqual({ added: [], removed: [], changed: [moonKey('a', 'web')] });
  });

  it('sorts moons and devices by name and gives them distinct slots', () => {
    const { layout } = reconcile(
      null,
      snap({
        nodes: [node('a')],
        moons: [moon('a', 'zed'), moon('a', 'alpha')],
        probes: [probe('2', { name: 'phone' }), probe('1', { name: 'laptop' })],
      }),
    );
    expect(layout.nodes[0].moonKeys).toEqual([moonKey('a', 'alpha'), moonKey('a', 'zed')]);
    expect(layout.probes.map((p) => p.name)).toEqual(['laptop', 'phone']);
    expect(layout.probes.map((p) => p.slot)).toEqual([0, 0.5]);
  });

  it('puts the device ring outside every node and its moons', () => {
    const { layout } = reconcile(
      null,
      snap({
        nodes: [node('a'), node('b'), node('c')],
        moons: Array.from({ length: 20 }, (_, i) => moon('c', `s${i}`)),
        probes: [probe('p')],
      }),
    );
    const outer = layout.nodes[2];
    expect(layout.probeRadius).toBeGreaterThan(outer.orbit + outer.radius * 2);
    expect(layout.extent).toBeGreaterThan(layout.probeRadius);
  });

  it('frames a lone node without devices tightly', () => {
    const { layout } = reconcile(null, snap({ nodes: [node('a')] }));
    expect(layout.extent).toBeLessThan(10);
  });
});

describe('keyboard order', () => {
  const { layout } = reconcile(
    null,
    snap({
      nodes: [node('a'), node('b')],
      moons: [moon('a', 'm1'), moon('a', 'm2'), moon('b', 'm3')],
      probes: [probe('p')],
    }),
  );

  it('walks nodes, the selected node moons, then devices', () => {
    expect(focusOrder(layout, null)).toEqual([nodeKey('a'), nodeKey('b'), probeKey('p')]);
    expect(focusOrder(layout, nodeKey('a'))).toEqual([
      nodeKey('a'),
      moonKey('a', 'm1'),
      moonKey('a', 'm2'),
      nodeKey('b'),
      probeKey('p'),
    ]);
  });

  it('wraps in both directions and starts at an end', () => {
    const order = focusOrder(layout, null);
    expect(stepFocus(order, null, 1)).toBe(nodeKey('a'));
    expect(stepFocus(order, null, -1)).toBe(probeKey('p'));
    expect(stepFocus(order, probeKey('p'), 1)).toBe(nodeKey('a'));
    expect(stepFocus(order, nodeKey('a'), -1)).toBe(probeKey('p'));
    expect(stepFocus([], null, 1)).toBeNull();
    // A key that left the order starts over.
    expect(stepFocus(order, moonKey('a', 'm1'), 1)).toBe(nodeKey('a'));
  });
});

describe('interact', () => {
  const { layout } = reconcile(
    null,
    snap({ nodes: [node('a'), node('b')], moons: [moon('a', 'web')], probes: [probe('p')] }),
  );

  it('focuses a node first, then opens it', () => {
    const first = interact({ selected: null }, layout, { type: 'activate', key: nodeKey('a') });
    expect(first).toEqual({ state: { selected: nodeKey('a') }, effect: { type: 'fly', to: nodeKey('a') } });
    const second = interact(first.state, layout, { type: 'activate', key: nodeKey('a') });
    expect(second.effect).toEqual({ type: 'open', key: nodeKey('a') });
    // Another node moves the focus instead.
    const other = interact(first.state, layout, { type: 'activate', key: nodeKey('b') });
    expect(other.effect).toEqual({ type: 'fly', to: nodeKey('b') });
  });

  it('opens moons straight away', () => {
    expect(interact({ selected: null }, layout, { type: 'activate', key: moonKey('a', 'web') }).effect).toEqual({
      type: 'open',
      key: moonKey('a', 'web'),
    });
  });

  it('focuses a device first, then opens it', () => {
    const first = interact({ selected: nodeKey('a') }, layout, { type: 'activate', key: probeKey('p') });
    expect(first).toEqual({ state: { selected: probeKey('p') }, effect: { type: 'fly', to: probeKey('p') } });
    expect(interact(first.state, layout, { type: 'activate', key: probeKey('p') }).effect).toEqual({
      type: 'open',
      key: probeKey('p'),
    });
  });

  it('flies home on escape or empty space, and does nothing when already home', () => {
    const focused = { selected: nodeKey('a') };
    expect(interact(focused, layout, { type: 'back' })).toEqual({ state: { selected: null }, effect: { type: 'fly', to: null } });
    expect(interact(focused, layout, { type: 'empty' }).effect).toEqual({ type: 'fly', to: null });
    expect(interact({ selected: null }, layout, { type: 'back' }).effect).toEqual({ type: 'none' });
  });

  it('ignores keys that are gone', () => {
    expect(interact({ selected: null }, layout, { type: 'activate', key: nodeKey('zzz') }).effect.type).toBe('none');
  });
});

describe('pick', () => {
  it('takes the nearest body under the pointer, with slop for small ones', () => {
    const bodies = [
      { key: 'node:a', x: 100, y: 100, r: 30, depth: 50 },
      { key: 'moon:a:web', x: 110, y: 100, r: 2, depth: 45 },
      { key: 'probe:p', x: 300, y: 300, r: 3, depth: 60 },
    ];
    expect(pick(bodies, 111, 101)).toBe('moon:a:web');
    expect(pick(bodies, 80, 100)).toBe('node:a');
    expect(pick(bodies, 306, 300)).toBe('probe:p');
    expect(pick(bodies, 320, 300)).toBeNull();
  });
});

describe('labels and mapping', () => {
  it('names states for screen readers', () => {
    const { layout } = reconcile(
      null,
      snap({ nodes: [node('a', { state: 'unauthorized' })], probes: [probe('p', { online: false, wol: 'asleep' })] }),
    );
    expect(describeBody(layout.nodes[0])).toBe('a, sign in needed');
    expect(describeBody(layout.probes[0])).toBe('p, asleep');
  });

  it('maps OS to a device shape', () => {
    expect(probeShape('iOS')).toBe('phone');
    expect(probeShape('android')).toBe('phone');
    expect(probeShape('macOS')).toBe('computer');
    expect(probeShape('linux')).toBe('server');
    expect(probeShape('plan9')).toBe('other');
  });

  it('marks a running service whose check fails as down', () => {
    expect(moonState('running', true)).toBe('down');
    expect(moonState('stopped', true)).toBe('stopped');
    expect(moonState('partial', false)).toBe('partial');
    expect(moonState('running', false)).toBe('ok');
  });

  it('reads the kind from a key', () => {
    expect(kindOf(moonKey('a:b', 'c'))).toBe('moon');
    expect(kindOf(nodeKey('x'))).toBe('node');
  });
});
